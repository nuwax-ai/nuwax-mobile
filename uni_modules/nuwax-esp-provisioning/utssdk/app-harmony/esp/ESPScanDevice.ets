/**
 * 封装 BLE 设备信息，对上层仅暴露 name/mac/rssi/serviceUuid，不暴露 FastBLE 的 BleDevice，
 * 使 entry 等模块无需依赖 @ohos/fastble。
 * 库内部在连接时通过 getRawDevice() 取得原始 BleDevice。
 */
import { BleDevice } from '@ohos/fastble'

/** 从广播数据解析第一个 128-bit Service UUID */
function parseScanRecordForServiceUuid(scanRecord: Uint8Array): string {
  if (!scanRecord || scanRecord.length < 18) {
    return ''
  }
  let i = 0
  while (i + 2 <= scanRecord.length) {
    const len = scanRecord[i]
    const type = scanRecord[i + 1]
    if (len <= 0 || i + 1 + len > scanRecord.length) {
      break
    }
    if ((type === 0x06 || type === 0x07) && len >= 17) {
      const uuidBytes = scanRecord.subarray(i + 2, i + 18)
      return formatUuid128(uuidBytes)
    }
    i += 1 + len
  }
  return ''
}

function formatUuid128(b: Uint8Array): string {
  const hex = (idx: number): string => (b[idx] & 0xff).toString(16).padStart(2, '0')
  return `${hex(15)}${hex(14)}${hex(13)}${hex(12)}-${hex(11)}${hex(10)}-${hex(9)}${hex(8)}-${hex(7)}${hex(6)}-${hex(5)}${hex(4)}${hex(3)}${hex(2)}${hex(1)}${hex(0)}`
}

export class ESPScanDevice {
  private rawDevice: BleDevice
  private _name: string
  private _mac: string
  private _rssi: number
  private _serviceUuid: string

  constructor(raw: BleDevice) {
    this.rawDevice = raw
    this._name = raw.getName() ?? 'Unknown'
    this._mac = raw.getMac()
    this._rssi = raw.getRssi()
    const scanRecord = raw.getScanRecord()
    this._serviceUuid = (scanRecord && scanRecord.length >= 18)
      ? parseScanRecordForServiceUuid(scanRecord)
      : ''
  }

  getName(): string {
    return this._name
  }

  getMac(): string {
    return this._mac
  }

  getRssi(): number {
    return this._rssi
  }

  /** 从广播解析的 primary service UUID，空则需调用方使用默认值 */
  getServiceUuid(): string {
    return this._serviceUuid
  }

  /**
   * 库内部使用，用于连接时传入 BLETransport。
   * 上层业务不要依赖此方法。
   */
  getRawDevice(): BleDevice {
    return this.rawDevice
  }
}
