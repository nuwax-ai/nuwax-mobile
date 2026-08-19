/**
 * nuwax 重写（相对上游 esp-idf-provisioning-harmony）：
 * 上游经 @ohos/fastble 做连接/读写，其 setMtu 用「请求值」立即回调（系统协商结果
 * 丢失），写 416 字节的 SRP6a 会话首包时在协商完成前被拒（2900099）。本实现直连
 * @ohos.bluetooth.ble：
 *  - MTU：setBLEMtuSize 后等待系统 BLEMtuChange 事件（真实协商值），3s 超时兜底；
 *  - 读写：writeCharacteristicValue/readCharacteristicValue 均用 Promise 形态，
 *    写固定使用 WRITE（带响应，protocomm 时序要求写确认后再读响应）；
 *  - descriptor 读不再绕 fastble，直接用本连接的 GattClientDevice。
 */
import { Transport } from './Transport'
import { ble, constant } from '@kit.ConnectivityKit'
import { BusinessError } from '@kit.BasicServicesKit'
import { USER_DESCRIPTION_UUID, HANDLER_PROTO_VER } from '../ESPConstants'
import { bytesToString, stringToBytes } from '../utils/HexUtil'
import { ESPScanDevice } from '../ESPScanDevice'

const TAG = 'BLETransport'

/** 统一 UUID 格式再比较，避免平台返回带/不带横线、大小写不一致导致匹配失败 */
function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase()
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
}

export class BLETransport implements Transport {
  private deviceId: string = ''
  private gatt: ble.GattClientDevice | null = null
  private serviceUuid: string = ''
  /** endpoint 名 → characteristic UUID（由 0x2901 descriptor 发现） */
  private uuidMap: Map<string, string> = new Map()
  /** characteristic UUID → 服务发现缓存的特征对象（写/读时取值） */
  private charMap: Map<string, ble.BLECharacteristic> = new Map()
  private sending: boolean = false

  deviceCapabilities: string[] = []
  versionInfo: string = ''

  /** 连接/MTU 协商的超时保护（毫秒） */
  private static readonly CONNECT_TIMEOUT_MS = 15000
  private static readonly MTU_EVENT_TIMEOUT_MS = 3000

  async connect(device: ESPScanDevice, primaryServiceUuid: string): Promise<void> {
    this.deviceId = device.getMac()
    this.serviceUuid = primaryServiceUuid
    this.gatt = ble.createGattClientDevice(this.deviceId)
    await this.connectDevice()
    await this.requestMtu(512)
    await this.discoverAndMapPaths()
  }

  /** 获取 proto-ver（版本信息），供 ESPDevice.initSession 内调用，与 Android 对齐 */
  async fetchVersionInfo(): Promise<void> {
    await this.delayMs(200)
    await this.doFetchVersionInfo()
  }

  private connectDevice(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const gatt = this.gatt
      if (gatt === null) {
        reject(new Error('No device to connect'))
        return
      }
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        gatt.off('BLEConnectionStateChange', handler)
        reject(new Error('Connect timed out'))
      }, BLETransport.CONNECT_TIMEOUT_MS)
      const handler = (data: ble.BLEConnectionChangeState): void => {
        if (data.deviceId !== this.deviceId) return
        if (data.state === constant.ProfileConnectionState.STATE_CONNECTED) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          gatt.off('BLEConnectionStateChange', handler)
          console.info(TAG, 'Connected successfully')
          resolve()
        } else if (data.state === constant.ProfileConnectionState.STATE_DISCONNECTED) {
          if (settled) return
          settled = true
          clearTimeout(timer)
          gatt.off('BLEConnectionStateChange', handler)
          reject(new Error('Connect failed: device disconnected'))
        }
      }
      gatt.on('BLEConnectionStateChange', handler)
      console.info(TAG, 'Connecting...')
      try {
        gatt.connect()
      } catch (e) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        gatt.off('BLEConnectionStateChange', handler)
        reject(new Error('Connect failed: ' + (e as Error).message))
      }
    })
  }

  /** 请求 MTU 并等待系统 BLEMtuChange 事件（真实协商值）；事件超时则继续（小包仍可用）。 */
  private requestMtu(mtu: number): Promise<void> {
    return new Promise<void>((resolve, _reject) => {
      const gatt = this.gatt
      if (gatt === null) {
        resolve()
        return
      }
      let settled = false
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        gatt.off('BLEMtuChange', handler)
        console.warn(TAG, 'MTU negotiation event timeout, continuing with default MTU')
        resolve()
      }, BLETransport.MTU_EVENT_TIMEOUT_MS)
      const handler = (negotiatedMtu: number): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        gatt.off('BLEMtuChange', handler)
        console.info(TAG, `MTU negotiated to ${negotiatedMtu}`)
        resolve()
      }
      gatt.on('BLEMtuChange', handler)
      try {
        gatt.setBLEMtuSize(mtu)
      } catch (e) {
        if (settled) return
        settled = true
        clearTimeout(timer)
        gatt.off('BLEMtuChange', handler)
        console.warn(TAG, 'setBLEMtuSize failed, continuing: ' + (e as Error).message)
        resolve()
      }
    })
  }

  private async discoverAndMapPaths(): Promise<void> {
    const gatt = this.gatt
    if (gatt === null) {
      throw new Error('Device not connected')
    }
    const services = await gatt.getServices()
    const wanted = normalizeUuid(this.serviceUuid)
    const targetService = services.find((s: ble.GattService) => normalizeUuid(s.serviceUuid) === wanted)
    if (!targetService) {
      const available = services.map((s: ble.GattService) => s.serviceUuid).join(', ')
      console.warn(TAG, 'Available service UUIDs: ' + available)
      throw new Error('Primary service not found: ' + this.serviceUuid)
    }
    // 使用 discovery 返回的原始 UUID 字符串（后续按特征对象寻址，不再拼字符串匹配）
    this.serviceUuid = targetService.serviceUuid

    for (const characteristic of targetService.characteristics) {
      const charUuid = characteristic.characteristicUuid
      this.charMap.set(charUuid, characteristic)
      for (const descriptor of characteristic.descriptors) {
        if (descriptor.descriptorUuid.toUpperCase().startsWith(USER_DESCRIPTION_UUID.toUpperCase())) {
          if (descriptor.descriptorValue.byteLength > 0) {
            const pathName = bytesToString(new Uint8Array(descriptor.descriptorValue))
            this.uuidMap.set(pathName, charUuid)
            console.info(TAG, `Path mapping: ${pathName} -> ${charUuid}`)
          }
        }
      }
    }

    if (this.uuidMap.size === 0) {
      console.warn(TAG, 'No path mappings from discovery (descriptorValue empty), reading descriptors manually')
      await this.readDescriptorsManually(targetService)
    }
  }

  /** 延迟 ms 毫秒，用于避免 BLE 设备 busy（如 2900011） */
  private delayMs(ms: number): Promise<void> {
    return new Promise<void>(r => setTimeout(r, ms))
  }

  /**
   * 用本连接的 GATT 客户端读 User Description 描述符。
   * discovery 刚结束立即读会报 2900011（设备忙），需在开始读前和每次读之间加短延迟。
   */
  private async readDescriptorsManually(service: ble.GattService): Promise<void> {
    const gatt = this.gatt
    if (gatt === null) {
      throw new Error('Device not connected')
    }

    // discovery 刚结束立刻读 descriptor 容易 2900011，先等栈稳定
    await this.delayMs(200)

    for (const characteristic of service.characteristics) {
      const charUuid = characteristic.characteristicUuid
      for (const descriptor of characteristic.descriptors) {
        if (descriptor.descriptorUuid.toUpperCase().startsWith(USER_DESCRIPTION_UUID.toUpperCase())) {
          const readOnce = (): Promise<ble.BLEDescriptor> => {
            return gatt.readDescriptorValue(descriptor)
          }
          try {
            let readResult = await readOnce()
            if (readResult.descriptorValue.byteLength > 0) {
              const pathName = bytesToString(new Uint8Array(readResult.descriptorValue))
              this.uuidMap.set(pathName, charUuid)
              console.info(TAG, `Path mapping (read): ${pathName} -> ${charUuid}`)
            }
          } catch (e) {
            const err = e as BusinessError
            if (err.code === 2900011) {
              await this.delayMs(350)
              try {
                const readResult = await readOnce()
                if (readResult.descriptorValue.byteLength > 0) {
                  const pathName = bytesToString(new Uint8Array(readResult.descriptorValue))
                  this.uuidMap.set(pathName, charUuid)
                  console.info(TAG, `Path mapping (read retry): ${pathName} -> ${charUuid}`)
                }
              } catch (e2) {
                const err2 = e2 as BusinessError
                console.warn(TAG, `Failed to read descriptor for ${charUuid} (retry): code=${err2.code} ${err2.message}`)
              }
            } else {
              console.warn(TAG, `Failed to read descriptor for ${charUuid}: code=${err.code} ${err.message}`)
            }
          }
          await this.delayMs(100)
        }
      }
    }
  }

  private async doFetchVersionInfo(): Promise<void> {
    const protoVerUuid = this.uuidMap.get(HANDLER_PROTO_VER)
    if (!protoVerUuid) {
      console.warn(TAG, 'proto-ver characteristic not found')
      return
    }

    try {
      const sendData = stringToBytes('ESP')
      const response = await this.sendConfigData(HANDLER_PROTO_VER, sendData)
      const data = bytesToString(response)
      console.info(TAG, 'Value : ' + data)
      this.versionInfo = data

      try {
        const jsonObj = JSON.parse(data) as Record<string, Object>
        const provInfo = jsonObj['prov'] as Record<string, Object>
        if (provInfo) {
          const deviceVersion = provInfo['ver'] as string | undefined
          console.info(TAG, 'Device Version : ' + (deviceVersion ?? ''))

          const caps = provInfo['cap']
          if (Array.isArray(caps)) {
            this.deviceCapabilities = []
            for (let i = 0; i < caps.length; i++) {
              const cap = caps[i] as string
              this.deviceCapabilities.push(cap)
            }
          }
          console.info(TAG, 'Capabilities : ' + JSON.stringify(this.deviceCapabilities))
        }
      } catch (_e) {
        console.warn(TAG, 'Capabilities JSON not available.')
      }
    } catch (e) {
      console.warn(TAG, `Failed to fetch version info: ${(e as Error).message}`)
    }
  }

  async sendConfigData(path: string, data: Uint8Array): Promise<Uint8Array> {
    const charUuid = this.uuidMap.get(path)
    if (!charUuid) {
      throw new Error(`No characteristic found for path: ${path}`)
    }
    if (this.gatt === null) {
      throw new Error('Device not connected')
    }

    while (this.sending) {
      await new Promise<void>(r => setTimeout(r, 50))
    }
    this.sending = true

    try {
      await this.writeCharacteristic(charUuid, data)
      return await this.readCharacteristic(charUuid)
    } finally {
      this.sending = false
    }
  }

  /**
   * 单包写入（protocomm 协议要求「一次写请求 = 一个完整 protobuf 消息」，
   * 不可应用层分包）。数据长度必须 ≤ MTU-3；SRP6a 会话首包 416 字节要求协商 MTU ≥ 419，
   * 固件侧需将 ATT MTU 配置为 512（见 docs/ble handoff 契约）。
   */
  private async writeCharacteristic(charUuid: string, data: Uint8Array): Promise<void> {
    const gatt = this.gatt
    const characteristic = this.charMap.get(charUuid)
    if (gatt === null || characteristic === undefined) {
      throw new Error('Device not connected or characteristic missing')
    }
    if (data.length > 509) {
      throw new Error(`Data length ${data.length} exceeds single-write limit (MTU 512)`);
    }
    characteristic.characteristicValue = toArrayBuffer(data)
    // 固定用 WRITE（带响应）：protocomm 依赖「写确认 → 设备处理 → 读响应」的时序，
    // WRITE_NO_RESPONSE 会导致读响应过早、取不到结果。
    await gatt.writeCharacteristicValue(characteristic, ble.GattWriteType.WRITE)
  }

  private async readCharacteristic(charUuid: string): Promise<Uint8Array> {
    const gatt = this.gatt
    const characteristic = this.charMap.get(charUuid)
    if (gatt === null || characteristic === undefined) {
      throw new Error('Device not connected or characteristic missing')
    }
    const result = await gatt.readCharacteristicValue(characteristic)
    return new Uint8Array(result.characteristicValue)
  }

  disconnect(): void {
    if (this.gatt !== null) {
      try {
        this.gatt.close()
      } catch (e) {
        console.warn(TAG, `close error: ${(e as Error).message}`)
      }
      this.gatt = null
    }
    this.deviceId = ''
    this.uuidMap.clear()
    this.charMap.clear()
    this.deviceCapabilities = []
    this.versionInfo = ''
  }
}
