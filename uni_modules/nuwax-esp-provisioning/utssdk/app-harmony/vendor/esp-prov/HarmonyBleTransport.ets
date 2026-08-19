/**
 * ConnectivityKit GATT 运输层，替换库里的 FastBLE BLETransport。
 * 协议仍按 endpoint 名（0x2901 User Description）寻址。
 * 写方向按协商 MTU-3 分片（对齐官方 Android SplitWriter 行为，固件按序拼装）；
 * notify 响应做累积重组（protobuf 帧完整判定 + 静默兜底），低 MTU 下 Security 2 大包不截断。
 */
import { ble } from '@kit.ConnectivityKit'
import { Transport } from './Session'
import { protobufFrameComplete } from './proto/EspProto'

const DESC_USER_UUID = '00002901-0000-1000-8000-00805f9b34fb'
const NOTIFY_QUIET_MS = 250

function concatUtf8(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i++) {
    out += String.fromCharCode(bytes[i])
  }
  return out
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

class PendingNotify {
  resolve: (data: Uint8Array) => void = (_data: Uint8Array) => {}
  reject: (e: Error) => void = (_e: Error) => {}
  timer: number = -1
  quietTimer: number = -1
  buffer: Uint8Array = new Uint8Array(0)
}

export class HarmonyBleTransport implements Transport {
  private gatt: ble.GattClientDevice | null = null
  private chars: Map<string, ble.BLECharacteristic> = new Map()
  private sending: boolean = false
  private pending: Map<string, PendingNotify> = new Map()
  private notifyCb: ((ch: ble.BLECharacteristic) => void) | null = null
  private mtu: number = 23
  private mtuCb: ((mtu: number) => void) | null = null

  attach(gatt: ble.GattClientDevice): void {
    this.gatt = gatt
    this.mtu = 23
    this.listenNotify()
    this.listenMtu()
  }

  mapCharacteristic(name: string, ch: ble.BLECharacteristic): void {
    const trimmed = name.replace(/\0/g, '').trim()
    if (trimmed.length > 0) {
      this.chars.set(trimmed, ch)
    }
  }

  hasPath(path: string): boolean {
    return this.chars.has(path)
  }

  pathNames(): string {
    const names: string[] = []
    this.chars.forEach((_ch: ble.BLECharacteristic, name: string) => {
      names.push(name)
    })
    return names.join(',')
  }

  async ingestServices(services: Array<ble.GattService>, serviceUuid: string): Promise<void> {
    const want = serviceUuid.toLowerCase()
    for (let s = 0; s < services.length; s++) {
      const svc = services[s]
      const su = svc.serviceUuid.toLowerCase()
      if (want.length > 0 && su != want && !this.sameUuid(su, want)) {
        continue
      }
      const list = svc.characteristics
      if (list == null) {
        continue
      }
      for (let c = 0; c < list.length; c++) {
        const ch = list[c]
        let name = this.userDescFromCache(ch)
        if (name.length == 0 && this.gatt != null) {
          name = await this.userDescFromRead(ch)
        }
        if (name.length > 0) {
          this.mapCharacteristic(name, ch)
          await this.enableNotify(ch)
        }
      }
    }
  }

  async requestMtu(mtu: number): Promise<void> {
    const gatt = this.gatt
    if (gatt == null) {
      return
    }
    try {
      await gatt.setBLEMtuSize(mtu)
      // 协商结果经 BLEMtuChange 事件回报；稍等事件落地，未回报则保持保守值
      await this.delay(300)
    } catch (_e) {
      // 部分机型协商失败仍可走默认 23，继续配网
    }
  }

  async sendConfigData(path: string, data: Uint8Array): Promise<Uint8Array> {
    const gatt = this.gatt
    const ch = this.chars.get(path)
    if (gatt == null || ch == null) {
      throw new Error('No characteristic for path: ' + path)
    }
    while (this.sending) {
      await this.delay(40)
    }
    this.sending = true
    try {
      const uuid = ch.characteristicUuid.toLowerCase()
      const waitNotify = this.waitNotify(ch.characteristicUuid, 8000)
      try {
        await this.writeChunked(gatt, ch, data)
        try {
          return await waitNotify
        } catch (_timeout) {
          const readBack = await gatt.readCharacteristicValue(this.toCharacteristic(ch, data.subarray(0, 0)))
          const value = readBack.characteristicValue
          return value != null ? new Uint8Array(value) : new Uint8Array(0)
        }
      } catch (e) {
        this.cancelPending(uuid)
        throw e as Error
      }
    } finally {
      this.sending = false
    }
  }

  private toCharacteristic(ch: ble.BLECharacteristic, data: Uint8Array): ble.BLECharacteristic {
    const copy: ble.BLECharacteristic = {
      serviceUuid: ch.serviceUuid,
      characteristicUuid: ch.characteristicUuid,
      characteristicValue: this.toBuffer(data),
      descriptors: ch.descriptors
    }
    return copy
  }

  /** 按 MTU-3 分片顺序写（官方 Android SplitWriter 同构，固件按序拼装请求）。 */
  private async writeChunked(gatt: ble.GattClientDevice, ch: ble.BLECharacteristic, data: Uint8Array): Promise<void> {
    const chunkSize = this.mtu > 23 ? this.mtu - 3 : 20
    let offset = 0
    while (offset < data.length) {
      const end = offset + chunkSize > data.length ? data.length : offset + chunkSize
      await gatt.writeCharacteristicValue(this.toCharacteristic(ch, data.subarray(offset, end)), ble.GattWriteType.WRITE)
      offset = end
      if (offset < data.length) {
        await this.delay(20)
      }
    }
    if (data.length == 0) {
      await gatt.writeCharacteristicValue(this.toCharacteristic(ch, data), ble.GattWriteType.WRITE)
    }
  }

  clear(): void {
    const gatt = this.gatt
    if (gatt != null && this.notifyCb != null) {
      try {
        gatt.off('BLECharacteristicChange', this.notifyCb)
      } catch (_e) {
        // ignore
      }
    }
    if (gatt != null && this.mtuCb != null) {
      try {
        gatt.off('BLEMtuChange', this.mtuCb)
      } catch (_e4) {
        // ignore
      }
    }
    this.notifyCb = null
    this.mtuCb = null
    this.pending.forEach((item: PendingNotify) => {
      this.cancelTimers(item)
    })
    this.pending.clear()
    this.gatt = null
    this.chars.clear()
    this.sending = false
    this.mtu = 23
  }

  private listenMtu(): void {
    const gatt = this.gatt
    if (gatt == null) {
      return
    }
    this.mtuCb = (mtu: number): void => {
      if (mtu > 0) {
        this.mtu = mtu
      }
    }
    gatt.on('BLEMtuChange', this.mtuCb)
  }

  private listenNotify(): void {
    const gatt = this.gatt
    if (gatt == null) {
      return
    }
    this.notifyCb = (ch: ble.BLECharacteristic): void => {
      const uuid = ch.characteristicUuid.toLowerCase()
      const item = this.pending.get(uuid)
      if (item == null) {
        return
      }
      const value = ch.characteristicValue
      if (value != null) {
        item.buffer = concatBytes(item.buffer, new Uint8Array(value))
      }
      if (protobufFrameComplete(item.buffer)) {
        this.finishPending(uuid, item, item.buffer)
        return
      }
      // 帧未收齐：重置静默窗口，窗口内无新分片则按现状交付（兼容 proto-ver 的 JSON 等非 protobuf 响应）
      if (item.quietTimer >= 0) {
        clearTimeout(item.quietTimer)
      }
      item.quietTimer = setTimeout((): void => {
        this.finishPending(uuid, item, item.buffer)
      }, NOTIFY_QUIET_MS)
    }
    gatt.on('BLECharacteristicChange', this.notifyCb)
  }

  private finishPending(uuid: string, item: PendingNotify, data: Uint8Array): void {
    if (this.pending.get(uuid) !== item) {
      return
    }
    this.pending.delete(uuid)
    this.cancelTimers(item)
    item.resolve(data)
  }

  private cancelTimers(item: PendingNotify): void {
    if (item.timer >= 0) {
      clearTimeout(item.timer)
      item.timer = -1
    }
    if (item.quietTimer >= 0) {
      clearTimeout(item.quietTimer)
      item.quietTimer = -1
    }
  }

  private cancelPending(uuid: string): void {
    const item = this.pending.get(uuid)
    if (item == null) {
      return
    }
    this.pending.delete(uuid)
    this.cancelTimers(item)
  }

  private waitNotify(characteristicUuid: string, timeoutMs: number): Promise<Uint8Array> {
    const uuid = characteristicUuid.toLowerCase()
    return new Promise<Uint8Array>((resolve: (data: Uint8Array) => void, reject: (e: Error) => void) => {
      const item = new PendingNotify()
      item.resolve = resolve
      item.reject = reject
      item.timer = setTimeout((): void => {
        this.pending.delete(uuid)
        this.cancelTimers(item)
        reject(new Error('notify timeout'))
      }, timeoutMs)
      this.pending.set(uuid, item)
    })
  }

  private async enableNotify(ch: ble.BLECharacteristic): Promise<void> {
    const gatt = this.gatt
    if (gatt == null) {
      return
    }
    try {
      await gatt.setCharacteristicChangeNotification(ch, true)
    } catch (_e) {
      // 无 notify 属性的特征（如部分只读）忽略
    }
  }

  private userDescFromCache(ch: ble.BLECharacteristic): string {
    const descs = ch.descriptors
    if (descs == null) {
      return ''
    }
    for (let i = 0; i < descs.length; i++) {
      const d = descs[i]
      if (d.descriptorUuid.toLowerCase().indexOf('2901') < 0) {
        continue
      }
      if (d.descriptorValue != null && d.descriptorValue.byteLength > 0) {
        return concatUtf8(new Uint8Array(d.descriptorValue)).replace(/\0/g, '').trim()
      }
    }
    return ''
  }

  private async userDescFromRead(ch: ble.BLECharacteristic): Promise<string> {
    const gatt = this.gatt
    const descs = ch.descriptors
    if (gatt == null || descs == null) {
      return ''
    }
    for (let i = 0; i < descs.length; i++) {
      const d = descs[i]
      if (d.descriptorUuid.toLowerCase().indexOf('2901') < 0) {
        continue
      }
      try {
        await this.delay(80)
        const got = await gatt.readDescriptorValue(d)
        if (got.descriptorValue != null && got.descriptorValue.byteLength > 0) {
          return concatUtf8(new Uint8Array(got.descriptorValue)).replace(/\0/g, '').trim()
        }
      } catch (_e) {
        // 描述符可能不可读，跳过
      }
    }
    return ''
  }

  private sameUuid(a: string, b: string): boolean {
    if (a == b) {
      return true
    }
    const sa = this.shortUuid(a)
    const sb = this.shortUuid(b)
    return sa.length > 0 && sa == sb
  }

  private shortUuid(uuid: string): string {
    const n = uuid.toLowerCase()
    if (n.length == 4) {
      return n
    }
    if (n.indexOf('0000') == 0 && n.indexOf('-0000-1000-8000-00805f9b34fb') > 0) {
      return n.substring(4, 8)
    }
    return ''
  }

  private toBuffer(data: Uint8Array): ArrayBuffer {
    if (data.byteOffset == 0 && data.byteLength == data.buffer.byteLength) {
      return data.buffer as ArrayBuffer
    }
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  }
}
