/**
 * nuwax 重写（相对上游 esp-idf-provisioning-harmony）：
 * 上游包装 @ohos/fastble 的 BleDevice；本项目为消除 fastble 依赖（其异步 GATT 读名过滤、
 * MTU 请求值伪回调等问题见 commit 记录），改为直接包装 @ohos.bluetooth.ble 的 ScanResult。
 * 对上层暴露 name/mac/rssi/serviceUuid/scanRecord，不暴露系统类型。
 */
import { ble } from '@kit.ConnectivityKit'

/** 从广播数据解析第一个 128-bit Service UUID（AD type 0x06/0x07，little-endian） */
function parseScanRecordForServiceUuid(scanRecord: Uint8Array): string {
  if (scanRecord.length < 18) {
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
  private _mac: string
  private _name: string
  private _rssi: number
  private _serviceUuid: string
  private _scanRecord: Uint8Array

  constructor(result: ble.ScanResult) {
    this._mac = result.deviceId
    // 鸿蒙系统对广播名的解析不可靠（常为空），名字以上层从广播数据解析为准；
    // 此处保留系统值供日志/兜底。
    this._name = result.deviceName ?? ''
    this._rssi = result.rssi
    this._scanRecord = new Uint8Array(result.data)
    this._serviceUuid = parseScanRecordForServiceUuid(this._scanRecord)
  }

  /** 设备地址（鸿蒙为随机 MAC，仅作本次会话寻址，不得作为永久设备身份） */
  getMac(): string {
    return this._mac
  }

  getName(): string {
    return this._name
  }

  getRssi(): number {
    return this._rssi
  }

  /** 从广播数据解析的 128-bit Service UUID；未广播则为空串 */
  getServiceUuid(): string {
    return this._serviceUuid
  }

  /** 原始广播数据（供上层解析广播名等 AD 结构） */
  getScanRecord(): Uint8Array {
    return this._scanRecord
  }
}
