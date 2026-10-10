/**
 * BLE 扫描过滤条件，对应 FastBLE BleScanRuleConfig 的常用能力。
 * 通过 Builder 构建，传入 ESPProvisionManager.searchBleEspDevices(filter, listener)。
 */
export class ESPScanFilter {
  /** 设备名称列表，与 fuzzy 配合：fuzzy 为 true 时名称包含任一项即通过，否则需精确匹配 */
  deviceNames: string[] = []
  /** 设备 MAC，非空时仅扫描该 MAC */
  deviceMac: string = ''
  /** 仅扫描广播中包含这些 Service UUID 的设备；空表示不过滤 UUID */
  serviceUuids: string[] = []
  /** 名称匹配是否模糊：true = 包含即匹配（常用于前缀），false = 精确匹配 */
  fuzzy: boolean = true
  /** 扫描超时（毫秒） */
  scanTimeOutMs: number = 10000

  static builder(): ESPScanFilterBuilder {
    return new ESPScanFilterBuilder()
  }
}

export class ESPScanFilterBuilder {
  private filter: ESPScanFilter = new ESPScanFilter()

  /** 按设备名称前缀过滤（模糊匹配，等价于 setDeviceNames(true, [prefix])） */
  setDeviceNamePrefix(prefix: string): ESPScanFilterBuilder {
    this.filter.deviceNames = prefix.length > 0 ? [prefix] : []
    this.filter.fuzzy = true
    return this
  }

  /** 按设备名称列表过滤；fuzzy 为 true 时名称包含任一项即通过，否则精确匹配 */
  setDeviceNames(fuzzy: boolean, names: string[]): ESPScanFilterBuilder {
    this.filter.fuzzy = fuzzy
    this.filter.deviceNames = names ?? []
    return this
  }

  /** 仅扫描指定 MAC 的设备 */
  setDeviceMac(mac: string): ESPScanFilterBuilder {
    this.filter.deviceMac = mac ?? ''
    return this
  }

  /** 仅扫描广播中包含指定 Service UUID 的设备 */
  setServiceUuids(uuids: string[]): ESPScanFilterBuilder {
    this.filter.serviceUuids = uuids ?? []
    return this
  }

  /** 扫描超时（毫秒） */
  setScanTimeOutMs(ms: number): ESPScanFilterBuilder {
    this.filter.scanTimeOutMs = ms > 0 ? ms : 10000
    return this
  }

  build(): ESPScanFilter {
    return this.filter
  }
}
