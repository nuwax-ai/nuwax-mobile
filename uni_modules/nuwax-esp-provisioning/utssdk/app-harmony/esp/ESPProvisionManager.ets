import { BleDevice, BleManager, BleScanCallback, BleScanRuleConfig } from '@ohos/fastble'
import { BleScanListener } from './listeners/BleScanListener'
import { ESPDevice } from './ESPDevice'
import { SecurityType } from './ESPConstants'
import { ESPScanFilter } from './ESPScanFilter'
import { ESPScanDevice } from './ESPScanDevice'

const TAG = 'ESPProvisionManager'

function toBleScanRuleConfig(filter: ESPScanFilter): BleScanRuleConfig {
  return BleScanRuleConfig.Builder
    .setDeviceName(filter.fuzzy, filter.deviceNames)
    .setDeviceMac(filter.deviceMac)
    .setScanTimeOut(filter.scanTimeOutMs)
    .setServiceUuids(filter.serviceUuids)
    .build()
}

export class ESPProvisionManager {
  private static instance: ESPProvisionManager | null = null
  private espDevice: ESPDevice | null = null
  private scanning: boolean = false

  private constructor() {}

  static getInstance(): ESPProvisionManager {
    if (!ESPProvisionManager.instance) {
      ESPProvisionManager.instance = new ESPProvisionManager()
    }
    return ESPProvisionManager.instance
  }

  init(): void {
    BleManager.getInstance().init()
  }

  createESPDevice(securityType: SecurityType): ESPDevice {
    this.espDevice = new ESPDevice(securityType)
    return this.espDevice
  }

  getEspDevice(): ESPDevice | null {
    return this.espDevice
  }

  /**
   * 按过滤条件扫描 BLE ESP 设备。
   * @param filter 扫描过滤条件（ESPScanFilter）
   */
  searchBleEspDevices(filter: ESPScanFilter, listener: BleScanListener): void {
    if (this.scanning) {
      console.warn(TAG, 'Already scanning')
      return
    }

    const scanRuleConfig = toBleScanRuleConfig(filter)
    BleManager.getInstance().initScanRule(scanRuleConfig)

    const callback: BleScanCallback = new ESPBleScanCallback(this, listener)

    try {
      BleManager.getInstance().scan(callback)
    } catch (e) {
      this.scanning = false
      listener.onFailure(new Error('BLE scan failed: ' + JSON.stringify(e)))
    }
  }

  stopBleScan(): void {
    if (this.scanning) {
      BleManager.getInstance().cancelScan()
      this.scanning = false
    }
  }

  isScanning(): boolean {
    return this.scanning
  }

  /** 供内部 BleScanCallback 更新扫描状态 */
  setScanning(value: boolean): void {
    this.scanning = value
  }
}

class ESPBleScanCallback extends BleScanCallback {
  private manager: ESPProvisionManager
  private listener: BleScanListener

  constructor(manager: ESPProvisionManager, listener: BleScanListener) {
    super()
    this.manager = manager
    this.listener = listener
  }

  onScanStarted(success: boolean): void {
    if (success) {
      this.manager.setScanning(true)
      console.info(TAG, 'BLE scan started')
    } else {
      this.listener.scanStartFailed()
    }
  }

  onLeScan(device: BleDevice): void {
    // nuwax 修改（相对上游 esp-idf-provisioning-harmony）：
    // 原实现 onLeScan 为空、onScanning 按 device.getName() 过滤——而 fastble 的名字来自
    // 异步 GATT getDeviceName()（handleResult 里 onLeScan 先触发、checkDevice 在异步回调里），
    // 鸿蒙对 ESP32 广播名的解析常为空/失败，导致 PROV_ 设备被静默丢弃。
    // 改为在同步的 onLeScan 直接转发：广播数据完整（getScanRecord），名字由上层桥
    // 从广播 AD 结构自行解析。
    this.listener.onPeripheralFound(new ESPScanDevice(device))
  }

  onScanning(_device: BleDevice): void {
    // onLeScan 已转发，此处不再重复回调（避免同名设备 double-report）
  }

  onScanFinished(_scanResultList: BleDevice[]): void {
    this.manager.setScanning(false)
    console.info(TAG, 'BLE scan completed')
    this.listener.scanCompleted()
  }
}
