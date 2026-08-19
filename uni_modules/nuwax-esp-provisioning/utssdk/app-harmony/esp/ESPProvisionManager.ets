/**
 * nuwax 重写（相对上游 esp-idf-provisioning-harmony）：
 * 上游经 @ohos/fastble 扫描（其过滤链依赖异步 GATT 读名，鸿蒙上对 ESP32 广播名
 * 解析常为空导致设备被静默丢弃）。本实现直连 @ohos.bluetooth.ble：
 *  - 扫描不过滤（系统层全量回调），由上层桥从广播数据自行过滤名字/UUID；
 *  - 扫描窗口时长由 ESPScanFilter.scanTimeOutMs 驱动，到点触发 scanCompleted（上层负责重启窗口）；
 *  - BLEDeviceFind 每次回调可能携带多台设备，逐台转 ESPScanDevice 上报。
 */
import { ble } from '@kit.ConnectivityKit'
import { BleScanListener } from './listeners/BleScanListener'
import { ESPDevice } from './ESPDevice'
import { SecurityType } from './ESPConstants'
import { ESPScanFilter } from './ESPScanFilter'
import { ESPScanDevice } from './ESPScanDevice'

const TAG = 'ESPProvisionManager'

export class ESPProvisionManager {
  private static instance: ESPProvisionManager | null = null
  private espDevice: ESPDevice | null = null
  private scanning: boolean = false
  private scanListener: BleScanListener | null = null
  private scanTimer: number = -1
  private findHandler: (results: Array<ble.ScanResult>) => void = (_results) => {}

  private constructor() {}

  static getInstance(): ESPProvisionManager {
    if (!ESPProvisionManager.instance) {
      ESPProvisionManager.instance = new ESPProvisionManager()
    }
    return ESPProvisionManager.instance
  }

  /** ble 模块无需显式初始化；保留接口以对齐上游调用方。 */
  init(): void {}

  createESPDevice(securityType: SecurityType): ESPDevice {
    this.espDevice = new ESPDevice(securityType)
    return this.espDevice
  }

  getEspDevice(): ESPDevice | null {
    return this.espDevice
  }

  /**
   * 扫描 BLE 设备（系统层不过滤，全量回调；过滤由上层完成）。
   * 扫描窗口为 filter.scanTimeOutMs，到点自动停止并回调 scanCompleted，
   * 上层（EspProvisioningBridge）负责冷却后重启下一窗口。
   */
  searchBleEspDevices(filter: ESPScanFilter, listener: BleScanListener): void {
    if (this.scanning) {
      console.warn(TAG, 'Already scanning')
      return
    }
    this.scanning = true
    this.scanListener = listener
    this.findHandler = (results: Array<ble.ScanResult>): void => {
      for (const result of results) {
        listener.onPeripheralFound(new ESPScanDevice(result))
      }
    }
    ble.on('BLEDeviceFind', this.findHandler)
    try {
      // 不设系统层 ScanFilter（鸿蒙对 deviceName/serviceUuid 的系统过滤解析不可靠），
      // 全量接收由上层过滤。低功耗模式扫描间隔更省电，发现速度满足配网场景。
      ble.startBLEScan([], { interval: 0, dutyMode: ble.ScanDuty.SCAN_MODE_LOW_POWER })
      console.info(TAG, 'BLE scan started')
    } catch (e) {
      ble.off('BLEDeviceFind', this.findHandler)
      this.scanning = false
      this.scanListener = null
      listener.scanStartFailed()
      return
    }
    if (this.scanTimer !== -1) {
      clearTimeout(this.scanTimer)
    }
    this.scanTimer = setTimeout(() => {
      this.scanTimer = -1
      this.finishScan()
    }, filter.scanTimeOutMs)
  }

  stopBleScan(): void {
    if (this.scanTimer !== -1) {
      clearTimeout(this.scanTimer)
      this.scanTimer = -1
    }
    if (this.scanning) {
      this.scanning = false
      ble.off('BLEDeviceFind', this.findHandler)
      try {
        ble.stopBLEScan()
      } catch (e) {
        console.warn(TAG, `stopBLEScan error: ${JSON.stringify(e)}`)
      }
      this.scanListener = null
    }
  }

  isScanning(): boolean {
    return this.scanning
  }

  private finishScan(): void {
    if (!this.scanning) return
    this.scanning = false
    ble.off('BLEDeviceFind', this.findHandler)
    try {
      ble.stopBLEScan()
    } catch (e) {
      console.warn(TAG, `stopBLEScan error: ${JSON.stringify(e)}`)
    }
    console.info(TAG, 'BLE scan completed')
    const listener = this.scanListener
    this.scanListener = null
    if (listener !== null) {
      listener.scanCompleted()
    }
  }
}
