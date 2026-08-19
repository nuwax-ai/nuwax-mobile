import { Transport } from './Transport'
import {
  BleDevice,
  BleException,
  BleGattCallback,
  BleManager,
  BleMtuChangedCallback,
  BleReadCallback,
  BleWriteCallback
} from '@ohos/fastble'
import { ble } from '@kit.ConnectivityKit'
import { BusinessError } from '@kit.BasicServicesKit'
import { USER_DESCRIPTION_UUID, HANDLER_PROTO_VER } from '../ESPConstants'
import { bytesToString, stringToBytes } from '../utils/HexUtil'

const TAG = 'BLETransport'

/** 统一 UUID 格式再比较，避免平台返回带/不带横线、大小写不一致导致匹配失败 */
function normalizeUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase()
}

class ConnectGattCallback extends BleGattCallback {
  private resolve: () => void
  private reject: (e: Error) => void

  constructor(resolve: () => void, reject: (e: Error) => void) {
    super()
    this.resolve = resolve
    this.reject = reject
  }

  override onStartConnect(): void {
    console.info(TAG, 'Connecting...')
  }

  override onConnectFail(_device: BleDevice, exception: BleException): void {
    this.reject(new Error('Connect failed: ' + exception.getDescription()))
  }

  override onConnectSuccess(_device: BleDevice, _gatt: ble.GattClientDevice, _status: number): void {
    console.info(TAG, 'Connected successfully')
    this.resolve()
  }

  override onDisConnected(_isActive: boolean, _device: BleDevice, _gatt: ble.GattClientDevice, _status: number): void {
    console.info(TAG, 'Disconnected')
  }
}

class MtuChangedCallback extends BleMtuChangedCallback {
  private resolve: () => void
  private resolved: boolean = false

  constructor(resolve: () => void) {
    super()
    this.resolve = resolve
  }

  override onMtuChanged(_mtu: number): void {
    // nuwax 修改（相对上游）：fastble 的 setMtu 会先用「请求值」立即回调一次，
    // 系统真实协商结果随后以 BLEMtuChange 事件再回调一次（相同签名，无法区分来源）。
    // 第一次回调（请求值 512）不能当作协商完成——写 SRP6a 会话首包（416 字节）时
    // 若协商未完成/实际值更小（固件契约 Preferred MTU 256），系统将拒绝写入（2900099）。
    // 因此延迟 500ms 等系统协商事件落地后再继续服务发现。
    console.info(TAG, `MTU changed to ${_mtu}`)
    if (this.resolved) return
    this.resolved = true
    setTimeout(() => {
      this.resolve()
    }, 500)
  }

  override onSetMTUFailure(_exception: BleException): void {
    console.warn(TAG, 'MTU change failed, continuing anyway')
    if (this.resolved) return
    this.resolved = true
    this.resolve()
  }
}

class WriteResultCallback extends BleWriteCallback {
  private resolve: () => void
  private reject: (e: Error) => void

  constructor(resolve: () => void, reject: (e: Error) => void) {
    super()
    this.resolve = resolve
    this.reject = reject
  }

  override onWriteSuccess(_current: number, _total: number, _justWrite: Uint8Array): void {
    this.resolve()
  }

  override onWriteFailure(exception: BleException): void {
     this.reject(new Error('Write failed: ' + exception.getDescription()))
  }
}

class ReadResultCallback extends BleReadCallback {
  private resolve: (data: Uint8Array) => void
  private reject: (e: Error) => void

  constructor(resolve: (data: Uint8Array) => void, reject: (e: Error) => void) {
    super()
    this.resolve = resolve
    this.reject = reject
  }

  override onReadSuccess(data: Uint8Array): void {
    this.resolve(data)
  }

  override onReadFailure(exception: BleException): void {
    this.reject(new Error('Read failed: ' + exception.getDescription()))
  }
}

export class BLETransport implements Transport {
  private bleDevice: BleDevice | null = null
  private serviceUuid: string = ''
  private uuidMap: Map<string, string> = new Map()
  private sending: boolean = false

  deviceCapabilities: string[] = []
  versionInfo: string = ''

  /** 与 Android 不同：Harmony 侧 write 需等待系统回调，系统层可能延迟（如 ConvertBLEDescriptorToJS），默认 5s 易超时，故提高 operate 超时 */
  private static readonly PROVISION_OPERATE_TIMEOUT_MS = 20000

  async connect(device: BleDevice, primaryServiceUuid: string): Promise<void> {
    this.bleDevice = device
    this.serviceUuid = primaryServiceUuid

    BleManager.getInstance().setOperateTimeout(BLETransport.PROVISION_OPERATE_TIMEOUT_MS)
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
      if (!this.bleDevice) {
        reject(new Error('No device to connect'))
        return
      }

      const callback = new ConnectGattCallback(resolve, reject)
      BleManager.getInstance().connect(this.bleDevice, callback)
    })
  }

  private requestMtu(mtu: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.bleDevice) {
        reject(new Error('Device not connected'))
        return
      }

      const callback = new MtuChangedCallback(resolve)
      BleManager.getInstance().setMtu(this.bleDevice, mtu, callback)
    })
  }

  private discoverAndMapPaths(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (!this.bleDevice) {
        reject(new Error('Device not connected'))
        return
      }

          BleManager.getInstance().getBluetoothGattServices(this.bleDevice,
        (err: Object, services: ble.GattService[]) => {
          if (err) {
            reject(new Error('Failed to get services: ' + JSON.stringify(err)))
            return
          }

          const wanted = normalizeUuid(this.serviceUuid)
          const targetService = services.find(s => normalizeUuid(s.serviceUuid) === wanted)

          if (!targetService) {
            const available = services.map((s: ble.GattService) => s.serviceUuid).join(', ')
            console.warn(TAG, 'Available service UUIDs: ' + available)
            reject(new Error('Primary service not found: ' + this.serviceUuid))
            return
          }

          // FastBLE 的 BleConnector 用严格相等匹配 serviceUuid/characteristicUuid，必须使用 discovery 返回的原始字符串
          this.serviceUuid = targetService.serviceUuid

          for (const characteristic of targetService.characteristics) {
            const charUuid = characteristic.characteristicUuid
            for (const descriptor of characteristic.descriptors) {
              if (descriptor.descriptorUuid.toUpperCase().startsWith(USER_DESCRIPTION_UUID.toUpperCase())) {
                if (descriptor.descriptorValue && descriptor.descriptorValue.byteLength > 0) {
                  const pathName = bytesToString(new Uint8Array(descriptor.descriptorValue))
                  this.uuidMap.set(pathName, charUuid)
                  console.info(TAG, `Path mapping: ${pathName} -> ${charUuid}`)
                }
              }
            }
          }

          if (this.uuidMap.size === 0) {
            console.warn(TAG, 'No path mappings from discovery (descriptorValue empty), reading via connected GATT client')
            this.readDescriptorsManually(targetService).then(resolve).catch(reject)
          } else {
            resolve()
          }
        })
    })
  }

  /** 延迟 ms 毫秒，用于避免 BLE 设备 busy（如 2900011） */
  private delayMs(ms: number): Promise<void> {
    return new Promise<void>(r => setTimeout(r, ms))
  }

  /**
   * 用已连接的 GATT 客户端读 User Description 描述符。
   * 必须使用 FastBLE 里连接并发现服务的那一个 GattClientDevice；且 discovery 刚结束立即读会报 2900011（设备忙），
   * 需在开始读前和每次读之间加短延迟。
   */
  private async readDescriptorsManually(service: ble.GattService): Promise<void> {
    if (!this.bleDevice) {
      throw new Error('Device not connected')
    }

    const gattClient = BleManager.getInstance().getBleBluetooth(this.bleDevice)?.getBluetoothGatt() ?? null
    if (!gattClient) {
      throw new Error('Connected GATT client not found; cannot read descriptors')
    }

    // discovery 刚结束立刻读 descriptor 容易 2900011，先等栈稳定
    await this.delayMs(200)

    for (const characteristic of service.characteristics) {
      const charUuid = characteristic.characteristicUuid
      for (const descriptor of characteristic.descriptors) {
        if (descriptor.descriptorUuid.toUpperCase().startsWith(USER_DESCRIPTION_UUID.toUpperCase())) {
          const readOnce = (): Promise<ble.BLEDescriptor> => {
            return gattClient.readDescriptorValue(descriptor)
          }
          try {
            let readResult = await readOnce()
            if (readResult.descriptorValue && readResult.descriptorValue.byteLength > 0) {
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
                if (readResult.descriptorValue && readResult.descriptorValue.byteLength > 0) {
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

    if (!this.bleDevice) {
      throw new Error('Device not connected')
    }

    while (this.sending) {
      await new Promise<void>(r => setTimeout(r, 50))
    }
    this.sending = true

    try {
      await this.writeCharacteristic(this.bleDevice, this.serviceUuid, charUuid, data)
      const response = await this.readCharacteristic(this.bleDevice, this.serviceUuid, charUuid)
      return response
    } finally {
      this.sending = false
    }
  }

  /**
   * 始终单包写入（useSplit false），避免 SplitWriter 触发 2900099。MTU 已请求 512，单次在 MTU-3 内可发送。
   */
  private writeCharacteristic(device: BleDevice, serviceUuid: string, charUuid: string,
    data: Uint8Array): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const callback = new WriteResultCallback(resolve, reject)
      BleManager.getInstance().write(device, serviceUuid, charUuid, data,
        false, true, 0, callback)
    })
  }

  private readCharacteristic(device: BleDevice, serviceUuid: string,
    charUuid: string): Promise<Uint8Array> {
    return new Promise<Uint8Array>((resolve, reject) => {
      const callback = new ReadResultCallback(resolve, reject)
      BleManager.getInstance().read(device, serviceUuid, charUuid, callback)
    })
  }

  disconnect(): void {
    if (this.bleDevice) {
      BleManager.getInstance().disconnect(this.bleDevice)
      this.bleDevice = null
    }
    BleManager.getInstance().setOperateTimeout(5000)
    this.uuidMap.clear()
    this.deviceCapabilities = []
    this.versionInfo = ''
  }
}
