// Copyright Nuwax. All rights reserved.
//
// EspProvisioningBridge.ets
// nuwax-esp-provisioning (HarmonyOS ArkTS 桥)
//
// 与 Android 端 EspProvisioningBridge.kt / iOS 端 EspProvisioningBridge.swift 语义对齐：
// Security 2（SRP6a + AES-GCM，不降级）、BLE 配网、device-info / 自定义 endpoint（vox-config）、
// 设备侧 Wi-Fi 扫描与凭证下发。底层为 esp/ 目录吸收的 esp-idf-provisioning-harmony 源码
// （Apache-2.0，作者 ZHeart，含 SRP6a CSPRNG 安全修复，见 esp/LICENSE）。
//
// 混编约定（同 stream-pcm-player）：index.uts 直接 import 本文件（uts 依赖 ets，ets 不引用 uts），
// 回调为普通函数类型，与 interface.uts 的 NativeEsp*Callback 按位置一一对应。
//
// 与 Android 桥的差异：
//  - 线程模型：ArkTS 单线程事件循环，无需 dispatchToMain；settled 标志天然无竞态。
//  - 连接语义：吸收库把 GATT 连接（connectBLEDevice）与安全会话（initSession = proto-ver +
//    Security 2）拆开，而 UTS 层 connect 契约要求连接后即可读 capabilities/device-info（均需
//    会话已建立），故 connect = connectBLEDevice → initSession 串联。
//  - 扫描：ESPScanDevice 只解析 128-bit 广播 UUID；固件的 0000ffff-... 可能以 16-bit 0xFFFF
//    别名广播，故 serviceUuid 缺失时宽松回退到调用方传入的 requiredServiceUuid。
//
// 安全约束（与契约一致）：PoP / username / Wi-Fi 密码仅内存持有，不写日志、不持久化。

import { ESPProvisionManager } from './esp/ESPProvisionManager'
import { ESPDevice } from './esp/ESPDevice'
import { ESPScanDevice } from './esp/ESPScanDevice'
import { ESPScanFilter } from './esp/ESPScanFilter'
import { SecurityType, ProvisionFailureReason } from './esp/ESPConstants'
import { BleScanListener } from './esp/listeners/BleScanListener'
import { SessionListener } from './esp/listeners/SessionListener'
import { ProvisionListener } from './esp/listeners/ProvisionListener'
import { WiFiScanListener } from './esp/listeners/WiFiScanListener'
import { access } from '@kit.ConnectivityKit'
import { util } from '@kit.ArkTS'

const TAG = 'EspBridge'

/** ArkTS 严格模式：JSON 序列化载荷用明确 class，避免 Record 值的 as Object 装箱转换。 */
class CapabilitiesPayload {
  appVersion: string = ''
  protocolVersion: string = ''
  securityVersion: number = -1
  capabilities: string[] = []
}

class WifiNetworkPayload {
  ssid: string = ''
  rssi: number = 0
  security: number = 0
}

export class EspProvisioningBridge {
  private manager: ESPProvisionManager = ESPProvisionManager.getInstance()
  /** 扫描结果缓存：mac → 扫描到的设备（连接时取出，不向 UTS 泄漏系统对象） */
  private peripherals: Map<string, ESPScanDevice> = new Map()
  private espDevice: ESPDevice | null = null

  /** 是否应持续扫描：scanCompleted 时据此决定是否重启扫描窗口，stopScan 置 false。 */
  private scanning: boolean = false
  /** 每次 start/stop 递增，防止上一轮监听器的迟到回调复活旧扫描（对齐 Android 桥）。 */
  private scanGeneration: number = 0
  private scanRestartTimer: number = -1
  /** 扫描窗口（ESPScanFilter.scanTimeOutMs）；窗口间冷却，避免系统扫描限流。 */
  private static readonly SCAN_WINDOW_MS: number = 10000
  private static readonly SCAN_RESTART_COOLDOWN_MS: number = 2000

  init(): void {
    this.manager.init()
  }

  startScan(prefix: string, requiredServiceUuid: string,
    onDevice: (deviceId: string, name: string, rssi: number, serviceUuid: string) => void,
    onFail: (code: string, message: string) => void): void {
    this.stopScanInternal()
    this.peripherals.clear()
    const generation = this.scanGeneration + 1
    this.scanGeneration = generation
    this.scanning = true

    // 系统层不过滤：鸿蒙对 ESP32 广播名的解析常为空/失败，名字/UUID 过滤
    // 在下方 onPeripheralFound 内从原始广播数据解析完成（同步、可靠）。
    const filter = ESPScanFilter.builder()
      .setScanTimeOutMs(EspProvisioningBridge.SCAN_WINDOW_MS)
      .build()

    const listener: BleScanListener = {
      scanStartFailed: () => {
        if (!this.isCurrentScan(generation)) return
        this.scanning = false
        const bluetoothEnabled = access.getState() === access.BluetoothState.STATE_ON
        console.error(`[${TAG}] scanStartFailed bluetoothEnabled=${bluetoothEnabled}`)
        if (bluetoothEnabled) {
          onFail('SCAN_FAILED', 'Bluetooth scanner could not start; retry after cooldown')
        } else {
          onFail('BLUETOOTH_OFF', 'Bluetooth is disabled')
        }
      },
      onPeripheralFound: (device: ESPScanDevice) => {
        if (!this.isCurrentScan(generation)) return
        const mac = device.getMac()
        // 鸿蒙系统对广播名的解析不可靠：名字直接从原始广播数据解析
        const record = device.getScanRecord()
        const parsedName = parseAdvertisedName(record)
        const advertisedUuid = device.getServiceUuid()
        const firstSeen = !this.peripherals.has(mac)
        if (firstSeen) {
          // 每台候选设备只打一次诊断日志（广播名解析失败时也可见 mac/uuid，便于定位固件广播问题）
          console.info(`[${TAG}] scanCandidate mac=${mac} name="${parsedName}" uuid=${advertisedUuid} rssi=${device.getRssi()}`)
        }
        // 过滤：广播名匹配前缀，或广播 UUID 匹配目标服务（名字解析失败时兜底）
        const nameOk = parsedName !== '' && parsedName.startsWith(prefix)
        const uuidOk = advertisedUuid !== '' &&
          advertisedUuid.toLowerCase() === requiredServiceUuid.toLowerCase()
        if (!nameOk && !uuidOk) return
        const matchedUuid = advertisedUuid !== '' ? advertisedUuid : requiredServiceUuid
        this.peripherals.set(mac, device)
        if (firstSeen) {
          console.info(`[${TAG}] onDevice mac=${mac} name=${parsedName} rssi=${device.getRssi()}`)
        }
        onDevice(mac, parsedName, device.getRssi(), matchedUuid)
      },
      scanCompleted: () => {
        // 单个扫描窗口结束（约 10s）；广播间隔长的设备需多窗口才能发现。
        // 迟到的旧监听器不得复活；窗口间冷却后重启（对齐 Android 桥的反限流策略）。
        if (!this.isCurrentScan(generation)) return
        if (this.scanRestartTimer !== -1) {
          clearTimeout(this.scanRestartTimer)
        }
        this.scanRestartTimer = setTimeout(() => {
          this.scanRestartTimer = -1
          if (!this.isCurrentScan(generation)) return
          this.manager.searchBleEspDevices(filter, listener)
        }, EspProvisioningBridge.SCAN_RESTART_COOLDOWN_MS)
      },
      onFailure: (e: Error) => {
        if (!this.isCurrentScan(generation)) return
        this.scanning = false
        console.error(`[${TAG}] scanFailure: ${safeMessage(e)}`)
        onFail('SCAN_FAILED', safeMessage(e))
      },
    }
    try {
      this.manager.searchBleEspDevices(filter, listener)
    } catch (e) {
      console.error(`[${TAG}] startScan sync error: ${safeMessage(e as Error)}`)
      this.scanning = false
      onFail('SCAN_FAILED', safeMessage(e as Error))
    }
  }

  stopScan(): void {
    this.stopScanInternal()
  }

  private stopScanInternal(): void {
    this.scanning = false
    this.scanGeneration += 1
    if (this.scanRestartTimer !== -1) {
      clearTimeout(this.scanRestartTimer)
      this.scanRestartTimer = -1
    }
    this.manager.stopBleScan()
  }

  private isCurrentScan(generation: number): boolean {
    return this.scanning && generation === this.scanGeneration
  }

  connect(deviceId: string, serviceUuid: string, username: string, proofOfPossession: string,
    timeoutMs: number,
    success: (value: string) => void,
    fail: (code: string, message: string) => void): void {
    const scanDevice = this.peripherals.get(deviceId)
    if (scanDevice === undefined) {
      fail('DEVICE_NOT_FOUND', 'BLE scan result is no longer available')
      return
    }
    this.stopScanInternal()
    const device = this.manager.createESPDevice(SecurityType.SECURITY_2)
    device.setUserName(username)
    device.setProofOfPossession(proofOfPossession)
    device.deviceName = scanDevice.getName()
    this.espDevice = device

    let settled = false
    // 预算覆盖 GATT 连接 + MTU + 服务发现 + proto-ver + SRP6a 握手全流程
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      device.disconnect()
      fail('CONNECT_FAILED', 'BLE connection timed out')
    }, timeoutMs)

    device.connectBLEDevice(scanDevice, serviceUuid)
      .then(() => {
        const sessionListener: SessionListener = {
          onSessionEstablished: () => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            console.info(`[${TAG}] Security 2 session established`)
            success('')
          },
          onSessionEstablishFailed: (e: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timer)
            fail(mapSessionError(e), safeMessage(e))
          },
        }
        device.initSession(sessionListener)
      })
      .catch((e: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fail('CONNECT_FAILED', safeMessage(e))
      })
  }

  getCapabilities(success: (value: string) => void, fail: (code: string, message: string) => void): void {
    const device = this.espDevice
    if (device === null) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    try {
      const root = JSON.parse(device.versionInfo !== '' ? device.versionInfo : '{}') as Record<string, Object>
      const prov = (root['prov'] ?? {}) as Record<string, Object>
      const nuwax = (root['nuwax'] ?? {}) as Record<string, Object>
      const payload = new CapabilitiesPayload()
      payload.appVersion = asString(nuwax['ver'])
      payload.protocolVersion = asString(prov['ver'])
      payload.securityVersion = prov['sec_ver'] !== undefined ? Number(prov['sec_ver']) : -1
      payload.capabilities = device.deviceCapabilities.slice()
      success(JSON.stringify(payload))
    } catch (e) {
      fail('SERVICE_MISMATCH', safeMessage(e as Error))
    }
  }

  getDeviceInfo(success: (value: string) => void, fail: (code: string, message: string) => void): void {
    const device = this.espDevice
    if (device === null) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    const encoder = new util.TextEncoder()
    device.sendDataToCustomEndPoint('device-info', new Uint8Array(encoder.encodeInto('{}')))
      .then((data: Uint8Array) => {
        success(bytesToUtf8(data))
      })
      .catch((e: Error) => {
        fail(mapSessionError(e), safeMessage(e))
      })
  }

  /** 向固件自定义 protocomm endpoint 写数据（如 vox-config 下发 deviceSecret），走已加密的 Security 2 会话 */
  sendCustomData(endpoint: string, payload: string,
    success: (value: string) => void,
    fail: (code: string, message: string) => void): void {
    const device = this.espDevice
    if (device === null) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    const encoder = new util.TextEncoder()
    device.sendDataToCustomEndPoint(endpoint, new Uint8Array(encoder.encodeInto(payload)))
      .then((data: Uint8Array) => {
        success(bytesToUtf8(data))
      })
      .catch((e: Error) => {
        console.error(`[${TAG}] sendCustomData FAIL endpoint=${endpoint} code=${mapSessionError(e)}`)
        fail(mapSessionError(e), safeMessage(e))
      })
  }

  scanNetworks(success: (value: string) => void, fail: (code: string, message: string) => void): void {
    const device = this.espDevice
    if (device === null) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    const listener: WiFiScanListener = {
      onWifiListReceived: (wifiList) => {
        const result: WifiNetworkPayload[] = []
        for (const network of wifiList) {
          const item = new WifiNetworkPayload()
          item.ssid = network.ssid
          item.rssi = network.rssi
          item.security = network.security
          result.push(item)
        }
        success(JSON.stringify(result))
      },
      onWiFiScanFailed: (e: Error) => {
        fail('UNKNOWN', safeMessage(e))
      },
    }
    device.scanNetworks(listener)
  }

  provision(ssid: string, password: string, timeoutMs: number,
    progress: (stage: string) => void,
    success: (value: string) => void,
    fail: (code: string, message: string) => void): void {
    const device = this.espDevice
    if (device === null) {
      fail('DISCONNECTED', 'Device is not connected')
      return
    }
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      fail('STATUS_TIMEOUT', 'Provisioning status timed out')
    }, timeoutMs)

    const finishSuccess = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      success('')
    }
    const finishFailure = (code: string, message: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fail(code, message)
    }

    const listener: ProvisionListener = {
      createSessionFailed: () => {
        finishFailure('SECURITY_AUTH_FAILED', 'Security 2 session could not be created')
      },
      wifiConfigSent: () => {
        progress('SENDING_CREDENTIALS')
      },
      wifiConfigFailed: (e: Error) => {
        finishFailure('SEND_CONFIG_FAILED', safeMessage(e))
      },
      wifiConfigApplied: () => {
        progress('APPLYING_CONFIG')
        progress('CHECKING_STATUS')
      },
      wifiConfigApplyFailed: (e: Error) => {
        finishFailure('APPLY_CONFIG_FAILED', safeMessage(e))
      },
      provisioningFailedFromDevice: (reason: ProvisionFailureReason) => {
        if (reason === ProvisionFailureReason.AUTH_FAILED) {
          finishFailure('WIFI_AUTH_FAILED', 'Wi-Fi authentication failed')
        } else if (reason === ProvisionFailureReason.NETWORK_NOT_FOUND) {
          finishFailure('NETWORK_NOT_FOUND', 'Wi-Fi network not found')
        } else if (reason === ProvisionFailureReason.DEVICE_DISCONNECTED) {
          finishFailure('DISCONNECTED', 'Device disconnected while provisioning')
        } else {
          finishFailure('UNKNOWN', 'Unknown provisioning failure')
        }
      },
      deviceProvisioningSuccess: () => {
        progress('SUCCESS')
        finishSuccess()
      },
      onProvisioningFailed: (e: Error) => {
        finishFailure('UNKNOWN', safeMessage(e))
      },
    }
    device.provision(ssid, password, listener)
  }

  disconnect(): void {
    if (this.espDevice !== null) {
      this.espDevice.disconnect()
      this.espDevice = null
    }
  }

  dispose(): void {
    try {
      this.stopScanInternal()
    } catch (e) {
      console.warn(`[${TAG}] dispose stopScan error: ${safeMessage(e as Error)}`)
    }
    this.disconnect()
    this.peripherals.clear()
  }
}

function mapSessionError(e: Error): string {
  const message = safeMessage(e).toLowerCase()
  if (message.includes('session') ||
    message.includes('credential') ||
    message.includes('auth') ||
    message.includes('proof')) {
    return 'SECURITY_AUTH_FAILED'
  }
  return 'SESSION_FAILED'
}

function safeMessage(e: Error | null | undefined): string {
  if (e === null || e === undefined) {
    return 'Unknown error'
  }
  const message = e.message !== undefined && e.message !== '' ? e.message : e.toString()
  return message.substring(0, 256)
}

function bytesToUtf8(data: Uint8Array): string {
  const decoder = util.TextDecoder.create('utf-8')
  return decoder.decodeToString(data)
}

/** 从 BLE 广播数据解析 Complete/Shortened Local Name（AD type 0x08/0x09）。 */
function parseAdvertisedName(record: Uint8Array | null | undefined): string {
  if (record === null || record === undefined || record.length < 2) {
    return ''
  }
  let offset = 0
  while (offset + 1 < record.length) {
    const len = record[offset]
    if (len === 0) break
    if (offset + 1 + len > record.length) break
    const type = record[offset + 1]
    if (type === 0x08 || type === 0x09) {
      const bytes = record.slice(offset + 2, offset + 1 + len)
      return bytesToUtf8(bytes)
    }
    offset += 1 + len
  }
  return ''
}

function asString(value: Object | undefined): string {
  return value !== undefined ? `${value}` : ''
}
