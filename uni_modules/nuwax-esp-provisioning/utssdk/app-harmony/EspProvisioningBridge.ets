/**
 * HarmonyOS NEXT ESP BLE 配网桥。
 *
 * 业务接入层（13 个原生函数 / EspProvisioningClient）不变。
 * Security 2 / Session / Wi-Fi protobuf 改编自 Apache-2.0
 * gitcode.com/Z_Heart/esp-idf-provisioning-harmony；BLE 仍走 ConnectivityKit，不引入 FastBLE。
 */
import { ble, access } from '@kit.ConnectivityKit'
import { BusinessError } from '@kit.BasicServicesKit'
import { HarmonyBleTransport } from './vendor/esp-prov/HarmonyBleTransport'
import { Session } from './vendor/esp-prov/Session'
import { Security2 } from './vendor/esp-prov/security/Security2'
import {
  encodeWifiScanStart,
  encodeWifiScanStatus,
  encodeWifiScanResult,
  decodeWifiScanStatus,
  decodeWifiScanList,
  encodeSetWifiConfig,
  encodeApplyWifiConfig,
  encodeGetWifiStatus,
  decodeWifiStatus,
  utf8Encode,
  utf8Decode
} from './vendor/esp-prov/proto/EspProto'

const BLUETOOTH_ON = 2
const GATT_CONNECTED = 2
const GATT_DISCONNECTED = 0
const HANDLER_PROTO_VER = 'proto-ver'
const HANDLER_PROV_SCAN = 'prov-scan'
const HANDLER_PROV_CONFIG = 'prov-config'
const HANDLER_DEVICE_INFO = 'device-info'

type OkCb = (value: string) => void
type ErrCb = (code: string, message: string) => void
type FoundCb = (deviceId: string, name: string, rssi: number, serviceUuid: string) => void
type LogFn = (message: string) => void

export class EspProvisioningBridge {
  private logFn: LogFn | null = null
  private foundCb: FoundCb | null = null
  private scanning: boolean = false
  private prefix: string = ''
  private serviceUuid: string = ''
  private seenIds: string[] = []
  private scanCb: ((results: Array<ble.ScanResult>) => void) | null = null
  private gatt: ble.GattClientDevice | null = null
  private timer: number = -1
  private connCb: ((state: ble.BLEConnectionChangeState) => void) | null = null
  private transport: HarmonyBleTransport = new HarmonyBleTransport()
  private session: Session | null = null
  private versionInfo: string = ''
  private capabilities: string[] = []

  setLog(cb: LogFn): void {
    this.logFn = cb
  }

  startScan(prefix: string, serviceUuid: string, onDevice: FoundCb, fail: ErrCb): void {
    this.stopScan()
    if (!this.bluetoothOn()) {
      fail('BLUETOOTH_OFF', '请先打开系统蓝牙')
      return
    }
    this.prefix = prefix
    this.serviceUuid = this.normUuid(serviceUuid)
    this.foundCb = onDevice
    this.seenIds = []
    this.scanning = true
    this.scanCb = (results: Array<ble.ScanResult>): void => {
      this.onScan(results)
    }
    try {
      ble.on('BLEDeviceFind', this.scanCb)
      const options: ble.ScanOptions = {
        interval: 0,
        dutyMode: ble.ScanDuty.SCAN_MODE_BALANCED,
        matchMode: ble.MatchMode.MATCH_MODE_AGGRESSIVE
      }
      // HarmonyOS 6 原生层拒绝空 filters 数组（ParseScanFilterParameters: Requires array length > 0，
      // StartBLEScan napi assert failed，扫描静默不启动）——放一个全匹配的空过滤器；
      // 名称前缀 / serviceUuid 过滤仍由 onScan 客户端侧完成
      const wildcard: ble.ScanFilter = {}
      const filters: Array<ble.ScanFilter> = [wildcard]
      ble.startBLEScan(filters, options)
      this.emit('scan_start prefix=' + prefix + ' uuid=' + this.serviceUuid)
    } catch (e) {
      this.scanning = false
      const err = e as BusinessError
      fail('SCAN_FAILED', 'startBLEScan: ' + err.code + ' ' + err.message)
    }
  }

  stopScan(): void {
    if (!this.scanning && this.scanCb == null) {
      return
    }
    this.scanning = false
    try {
      ble.stopBLEScan()
    } catch (_e) {
      // ignore
    }
    if (this.scanCb != null) {
      try {
        ble.off('BLEDeviceFind', this.scanCb)
      } catch (_e2) {
        // ignore
      }
      this.scanCb = null
    }
    this.foundCb = null
    this.emit('scan_stop')
  }

  connect(
    deviceId: string,
    serviceUuid: string,
    username: string,
    pop: string,
    timeoutMs: number,
    ok: OkCb,
    fail: ErrCb,
  ): void {
    if (!this.bluetoothOn()) {
      fail('BLUETOOTH_OFF', '请先打开系统蓝牙')
      return
    }
    this.stopScan()
    this.closeGatt()
    this.serviceUuid = this.normUuid(serviceUuid)
    this.session = null
    this.versionInfo = ''
    this.capabilities = []
    let done = false
    let sawConnected = false
    const rejectOnce = (code: string, message: string): void => {
      if (done) {
        return
      }
      done = true
      this.clearTimer()
      fail(code, message)
    }
    const resolveOnce = (): void => {
      if (done) {
        return
      }
      done = true
      this.clearTimer()
      ok('')
    }
    try {
      const client = ble.createGattClientDevice(deviceId)
      this.gatt = client
      this.transport.attach(client)
      this.connCb = (state: ble.BLEConnectionChangeState): void => {
        const st = state.state as number
        this.emit('gatt_state id=' + this.redact(deviceId) + ' state=' + st + ' sawConnected=' + sawConnected)
        if (st == GATT_CONNECTED) {
          if (!sawConnected) {
            sawConnected = true
            this.afterConnected(client, username, pop, resolveOnce, rejectOnce)
          }
        } else if (st == GATT_DISCONNECTED) {
          // OHOS 订阅后可能先推一次 DISCONNECTED 基线事件；连接前不判死，交给超时或重连
          if (sawConnected) {
            rejectOnce('DISCONNECTED', 'BLE 连接已断开')
          } else {
            this.emit('gatt_disconnect_before_connected')
          }
        }
      }
      client.on('BLEConnectionStateChange', this.connCb)
      const wait = timeoutMs > 0 ? timeoutMs : 25000
      this.timer = setTimeout((): void => {
        rejectOnce('CONNECT_FAILED', 'GATT/Security2 连接超时')
      }, wait)
      // OHOS：刚 stopScan 立即 connect 易栈忙，稍作停顿再发起
      setTimeout((): void => {
        if (done) {
          return
        }
        try {
          client.connect()
          this.emit('gatt_connect id=' + this.redact(deviceId))
        } catch (e) {
          const err = e as BusinessError
          rejectOnce('CONNECT_FAILED', 'connect: ' + err.code + ' ' + err.message)
        }
      }, 200)
    } catch (e) {
      const err = e as BusinessError
      rejectOnce('CONNECT_FAILED', 'createGattClientDevice: ' + err.code + ' ' + err.message)
    }
  }

  getCapabilities(ok: OkCb, fail: ErrCb): void {
    if (this.session == null || !this.session.isSessionEstablished()) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    ok(this.buildCapabilitiesJson())
  }

  getDeviceInfo(ok: OkCb, fail: ErrCb): void {
    this.sendCustomData(HANDLER_DEVICE_INFO, '{}', ok, fail)
  }

  sendCustomData(endpoint: string, payload: string, ok: OkCb, fail: ErrCb): void {
    const session = this.session
    if (session == null || !session.isSessionEstablished()) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    session.sendDataToDevice(endpoint, this.stringBytes(payload)).then((resp: Uint8Array) => {
      ok(this.bytesString(resp))
    }).catch((e: Error) => {
      fail(this.mapSessionError(e.message), e.message)
    })
  }

  scanNetworks(ok: OkCb, fail: ErrCb): void {
    const session = this.session
    if (session == null || !session.isSessionEstablished()) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    this.runWifiScan(session).then((json: string) => {
      ok(json)
    }).catch((e: Error) => {
      fail('UNKNOWN', e.message)
    })
  }

  provision(
    ssid: string,
    password: string,
    timeoutMs: number,
    progress: (stage: string) => void,
    ok: OkCb,
    fail: ErrCb,
  ): void {
    const session = this.session
    if (session == null || !session.isSessionEstablished()) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    this.runProvision(session, ssid, password, timeoutMs, progress).then(() => {
      ok('')
    }).catch((e: Error) => {
      fail(this.mapProvisionError(e.message), e.message)
    })
  }

  disconnect(): void {
    this.closeGatt()
  }

  dispose(): void {
    this.stopScan()
    this.closeGatt()
    this.logFn = null
    this.emit('dispose')
  }

  private async afterConnected(
    client: ble.GattClientDevice,
    username: string,
    pop: string,
    resolveOnce: () => void,
    rejectOnce: (code: string, message: string) => void,
  ): Promise<void> {
    try {
      // CONNECTED 事件后服务发现可能未完成，稍等并对空列表重试
      await this.delay(200)
      let services: Array<ble.GattService> = []
      for (let attempt = 0; attempt < 5; attempt++) {
        services = await client.getServices()
        if (services != null && services.length > 0) {
          break
        }
        this.emit('gatt_services_empty retry=' + (attempt + 1))
        await this.delay(300)
      }
      if (services == null || services.length == 0) {
        rejectOnce('SERVICE_MISMATCH', 'GATT service discovery returned empty')
        return
      }
      await this.transport.requestMtu(512)
      await this.transport.ingestServices(services, this.serviceUuid)
      this.emit('gatt_discovered endpoints=' + this.transport.pathNames())
      await this.fetchVersionInfo()
      const secVer = this.parseSecVer()
      if (secVer != 2) {
        rejectOnce('SECURITY_MISMATCH', 'firmware sec_ver=' + secVer + ', require 2')
        return
      }
      const patch = this.parseSecPatch()
      const security = new Security2(username, pop, patch)
      const session = new Session(this.transport, security)
      await new Promise<void>((resolve: () => void, reject: (e: Error) => void) => {
        session.init({
          onSessionEstablished: () => {
            resolve()
          },
          onSessionEstablishFailed: (e: Error) => {
            reject(e)
          }
        })
      })
      this.session = session
      this.emit('sec2_established')
      resolveOnce()
    } catch (e) {
      const err = e as Error
      rejectOnce(this.mapSessionError(err.message), err.message)
    }
  }

  private async fetchVersionInfo(): Promise<void> {
    if (!this.transport.hasPath(HANDLER_PROTO_VER)) {
      throw new Error('proto-ver endpoint missing')
    }
    const resp = await this.transport.sendConfigData(HANDLER_PROTO_VER, this.stringBytes('ESP'))
    this.versionInfo = this.bytesString(resp)
    this.emit('proto_ver_len=' + this.versionInfo.length)
    try {
      const obj = JSON.parse(this.versionInfo) as Record<string, Object>
      const prov = obj['prov'] as Record<string, Object>
      if (prov != null) {
        const caps = prov['cap']
        if (Array.isArray(caps)) {
          this.capabilities = []
          for (let i = 0; i < (caps as Object[]).length; i++) {
            this.capabilities.push(`${(caps as Object[])[i]}`)
          }
        }
      }
    } catch (_e) {
      this.emit('proto_ver_json_parse_failed')
    }
  }

  private parseSecVer(): number {
    try {
      const obj = JSON.parse(this.versionInfo) as Record<string, Object>
      const prov = obj['prov'] as Record<string, Object>
      if (prov != null && prov['sec_ver'] != null) {
        return Number(prov['sec_ver'])
      }
    } catch (_e) {
      // ignore
    }
    return -1
  }

  private parseSecPatch(): number {
    try {
      const obj = JSON.parse(this.versionInfo) as Record<string, Object>
      const prov = obj['prov'] as Record<string, Object>
      if (prov != null && prov['sec_patch_ver'] != null) {
        return Number(prov['sec_patch_ver'])
      }
    } catch (_e) {
      // ignore
    }
    return 0
  }

  private buildCapabilitiesJson(): string {
    try {
      const obj = JSON.parse(this.versionInfo) as Record<string, Object>
      const prov = obj['prov'] as Record<string, Object>
      const nuwax = obj['nuwax'] as Record<string, Object>
      const appVersion = nuwax != null && nuwax['ver'] != null ? `${nuwax['ver']}` : ''
      const protocolVersion = prov != null && prov['ver'] != null ? `${prov['ver']}` : ''
      const securityVersion = this.parseSecVer()
      const escapedCaps: string[] = []
      for (let i = 0; i < this.capabilities.length; i++) {
        escapedCaps.push('"' + this.escapeJson(this.capabilities[i]) + '"')
      }
      return '{"appVersion":"' + this.escapeJson(appVersion) +
        '","protocolVersion":"' + this.escapeJson(protocolVersion) +
        '","securityVersion":' + securityVersion +
        ',"capabilities":[' + escapedCaps.join(',') + ']}'
    } catch (_e) {
      return '{"appVersion":"","protocolVersion":"","securityVersion":2,"capabilities":[]}'
    }
  }

  private async runWifiScan(session: Session): Promise<string> {
    await session.sendDataToDevice(HANDLER_PROV_SCAN, encodeWifiScanStart())
    let finished = false
    let count = 0
    for (let i = 0; i < 15 && !finished; i++) {
      await this.delay(1500)
      const statusRaw = await session.sendDataToDevice(HANDLER_PROV_SCAN, encodeWifiScanStatus())
      const status = decodeWifiScanStatus(statusRaw)
      finished = status.scanFinished
      count = status.resultCount
    }
    const aps = [] as string[]
    let start = 0
    while (start < count) {
      const batch = count - start > 4 ? 4 : count - start
      const listRaw = await session.sendDataToDevice(HANDLER_PROV_SCAN, encodeWifiScanResult(start, batch))
      const list = decodeWifiScanList(listRaw)
      for (let i = 0; i < list.length; i++) {
        aps.push('{"ssid":"' + this.escapeJson(list[i].ssid) + '","rssi":' + list[i].rssi +
          ',"security":' + list[i].security + '}')
      }
      start += batch
    }
    return '[' + aps.join(',') + ']'
  }

  private async runProvision(
    session: Session,
    ssid: string,
    password: string,
    timeoutMs: number,
    progress: (stage: string) => void,
  ): Promise<void> {
    try {
      await session.sendDataToDevice(HANDLER_PROV_CONFIG, encodeSetWifiConfig(ssid, password))
    } catch (e) {
      throw new Error('SEND_CONFIG_FAILED: ' + (e as Error).message)
    }
    progress('SENDING_CREDENTIALS')
    try {
      await session.sendDataToDevice(HANDLER_PROV_CONFIG, encodeApplyWifiConfig())
    } catch (e) {
      throw new Error('APPLY_CONFIG_FAILED: ' + (e as Error).message)
    }
    progress('APPLYING_CONFIG')
    progress('CHECKING_STATUS')
    const deadline = Date.now() + (timeoutMs > 0 ? timeoutMs : 35000)
    while (Date.now() < deadline) {
      await this.delay(2000)
      const raw = await session.sendDataToDevice(HANDLER_PROV_CONFIG, encodeGetWifiStatus())
      const status = decodeWifiStatus(raw)
      if (status.state == 0) {
        progress('SUCCESS')
        return
      }
      if (status.state == 3) {
        if (status.failReason == 0) {
          throw new Error('WIFI_AUTH_FAILED')
        }
        if (status.failReason == 1) {
          throw new Error('NETWORK_NOT_FOUND')
        }
        throw new Error('UNKNOWN')
      }
    }
    throw new Error('STATUS_TIMEOUT')
  }

  private onScan(results: Array<ble.ScanResult>): void {
    if (!this.scanning || this.foundCb == null) {
      return
    }
    const cb = this.foundCb as FoundCb
    for (let i = 0; i < results.length; i++) {
      const item = results[i]
      const name = this.advName(item)
      const uuids = this.advUuids(item.data)
      const hitName = this.prefix.length == 0 || name.indexOf(this.prefix) == 0
      const hitUuid = this.serviceUuid.length == 0 || this.hasUuid(uuids, this.serviceUuid)
      if (!hitName && !hitUuid) {
        continue
      }
      if (this.seenIds.indexOf(item.deviceId) >= 0) {
        continue
      }
      this.seenIds.push(item.deviceId)
      const uuid = uuids.length > 0 ? uuids[0] : this.serviceUuid
      this.emit('scan_hit name=' + name + ' id=' + this.redact(item.deviceId) + ' rssi=' + item.rssi)
      cb(item.deviceId, name.length > 0 ? name : item.deviceId, item.rssi, uuid)
    }
  }

  private advName(item: ble.ScanResult): string {
    return this.parseName(item.data)
  }

  private parseName(data: ArrayBuffer): string {
    if (data == null || data.byteLength == 0) {
      return ''
    }
    const bytes = new Uint8Array(data)
    let offset = 0
    while (offset < bytes.length) {
      const len = bytes[offset]
      if (len == 0) {
        break
      }
      if (offset + len >= bytes.length) {
        break
      }
      const type = bytes[offset + 1]
      if (type == 0x08 || type == 0x09) {
        return this.ascii(bytes, offset + 2, offset + 1 + len)
      }
      offset += len + 1
    }
    return ''
  }

  private advUuids(data: ArrayBuffer): string[] {
    const uuids: string[] = []
    if (data == null || data.byteLength == 0) {
      return uuids
    }
    const bytes = new Uint8Array(data)
    let offset = 0
    while (offset < bytes.length) {
      const len = bytes[offset]
      if (len == 0) {
        break
      }
      if (offset + len >= bytes.length) {
        break
      }
      const type = bytes[offset + 1]
      const start = offset + 2
      const end = offset + 1 + len
      if (type == 0x02 || type == 0x03) {
        let p = start
        while (p + 1 < end) {
          const n = bytes[p] | (bytes[p + 1] << 8)
          uuids.push(this.normUuid('0000' + this.hex4(n) + '-0000-1000-8000-00805f9b34fb'))
          p += 2
        }
      }
      offset += len + 1
    }
    return uuids
  }

  private hasUuid(uuids: string[], target: string): boolean {
    for (let i = 0; i < uuids.length; i++) {
      if (this.sameUuid(uuids[i], target)) {
        return true
      }
    }
    return false
  }

  private sameUuid(a: string, b: string): boolean {
    const na = this.normUuid(a)
    const nb = this.normUuid(b)
    if (na == nb) {
      return true
    }
    const sa = this.uuid16(na)
    const sb = this.uuid16(nb)
    return sa.length > 0 && sa == sb
  }

  private uuid16(uuid: string): string {
    const n = this.normUuid(uuid)
    if (n.length == 4) {
      return n
    }
    if (n.indexOf('0000') == 0 && n.indexOf('-0000-1000-8000-00805f9b34fb') > 0) {
      return n.substring(4, 8)
    }
    return ''
  }

  private closeGatt(): void {
    this.clearTimer()
    this.session = null
    this.transport.clear()
    const client = this.gatt
    if (client != null) {
      if (this.connCb != null) {
        try {
          client.off('BLEConnectionStateChange', this.connCb)
        } catch (_e) {
          // ignore
        }
        this.connCb = null
      }
      try {
        client.close()
      } catch (_e2) {
        try {
          client.disconnect()
        } catch (_e3) {
          // ignore
        }
      }
    }
    this.gatt = null
  }

  private clearTimer(): void {
    if (this.timer >= 0) {
      clearTimeout(this.timer)
      this.timer = -1
    }
  }

  private bluetoothOn(): boolean {
    try {
      return access.getState() == BLUETOOTH_ON
    } catch (_e) {
      return true
    }
  }

  private mapSessionError(message: string): string {
    const m = message.toLowerCase()
    if (m.indexOf('mismatch') >= 0 || m.indexOf('proof') >= 0 || m.indexOf('mitm') >= 0 ||
      m.indexOf('session') >= 0 || m.indexOf('credential') >= 0 || m.indexOf('auth') >= 0) {
      return 'SECURITY_AUTH_FAILED'
    }
    if (m.indexOf('sec_ver') >= 0) {
      return 'SECURITY_MISMATCH'
    }
    return 'SESSION_FAILED'
  }

  private mapProvisionError(message: string): string {
    const passthrough: string[] = ['WIFI_AUTH_FAILED', 'NETWORK_NOT_FOUND', 'STATUS_TIMEOUT',
      'SEND_CONFIG_FAILED', 'APPLY_CONFIG_FAILED']
    for (let i = 0; i < passthrough.length; i++) {
      if (message == passthrough[i] || message.indexOf(passthrough[i] + ':') == 0) {
        return passthrough[i]
      }
    }
    return 'UNKNOWN'
  }

  private stringBytes(s: string): Uint8Array {
    return utf8Encode(s)
  }

  private bytesString(bytes: Uint8Array): string {
    return utf8Decode(bytes)
  }

  private escapeJson(s: string): string {
    let out = ''
    for (let i = 0; i < s.length; i++) {
      const code = s.charCodeAt(i)
      if (code == 0x5C) {
        out += '\\\\'
      } else if (code == 0x22) {
        out += '\\"'
      } else if (code == 0x0A) {
        out += '\\n'
      } else if (code == 0x0D) {
        out += '\\r'
      } else if (code == 0x09) {
        out += '\\t'
      } else if (code < 0x20) {
        out += '\\u' + this.hex4(code)
      } else {
        out += s[i]
      }
    }
    return out
  }

  private delay(ms: number): Promise<void> {
    return new Promise<void>((resolve: () => void) => {
      setTimeout(() => {
        resolve()
      }, ms)
    })
  }

  private normUuid(uuid: string): string {
    return uuid.toLowerCase()
  }

  private hex4(n: number): string {
    let s = n.toString(16)
    while (s.length < 4) {
      s = '0' + s
    }
    return s
  }

  private ascii(bytes: Uint8Array, start: number, end: number): string {
    let out = ''
    for (let i = start; i < end; i++) {
      out += String.fromCharCode(bytes[i])
    }
    return out
  }

  private redact(deviceId: string): string {
    if (deviceId.length <= 5) {
      return '***'
    }
    return '***' + deviceId.substring(deviceId.length - 5)
  }

  private emit(message: string): void {
    const line = '[EspBridge][harmony] ' + message
    const cb = this.logFn
    if (cb != null) {
      cb(line)
    }
  }
}

let shared: EspProvisioningBridge | null = null

export function getEspProvisioningBridge(): EspProvisioningBridge {
  if (shared == null) {
    shared = new EspProvisioningBridge()
  }
  return shared as EspProvisioningBridge
}
