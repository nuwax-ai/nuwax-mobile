import { WiFiAccessPoint } from '../WiFiAccessPoint'
import { util, collections } from '@kit.ArkTS'
import {
  CmdScanWifiStart,
  CmdScanWifiStatus,
  CmdScanWifiResult,
  NetworkScanPayload,
  NetworkScanMsgType,
  CmdSetWifiConfig,
  CmdApplyWifiConfig,
  CmdGetWifiStatus,
  NetworkConfigPayload,
  NetworkConfigMsgType,
  CmdCtrlWifiReset,
  NetworkCtrlPayload,
  NetworkCtrlMsgType,
  WiFiScanResult
} from '../proto/espressif'

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer
  }
  return (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength)
}

/** 将字符串编码为 ArkTS collections.Uint8Array，避免 Sendable/object literal 与 Uint8Array 类型限制 */
function stringToCollectionsUint8Array(s: string): collections.Uint8Array {
  const encoder = new util.TextEncoder()
  const raw = encoder.encodeInto(s)
  const n = raw.length
  const c = new collections.Uint8Array(n)
  for (let i = 0; i < n; i++) {
    c[i] = raw[i]
  }
  return c
}

/** 将 collections.Uint8Array 转为标准 Uint8Array，供 decoder.decodeToString 等使用 */
function collectionsUint8ArrayToStandard(col: collections.Uint8Array): Uint8Array {
  const n = col.length
  const u = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const v = col.at(i)
    u[i] = v !== undefined ? v : 0
  }
  return u
}

export function prepareWiFiScanStartMsg(): Uint8Array {
  const cmd = new CmdScanWifiStart()
  cmd.blocking = true
  cmd.passive = false
  cmd.group_channels = 0
  cmd.period_ms = 120
  const payload = new NetworkScanPayload()
  payload.msg = NetworkScanMsgType.TypeCmdScanWifiStart
  payload.cmd_scan_wifi_start = cmd
  const ab = NetworkScanPayload.encode(payload)
  return ab ? new Uint8Array(ab) : new Uint8Array(0)
}

export function prepareGetWiFiScanStatusMsg(): Uint8Array {
  const cmd = new CmdScanWifiStatus()
  const payload = new NetworkScanPayload()
  payload.msg = NetworkScanMsgType.TypeCmdScanWifiStatus
  payload.cmd_scan_wifi_status = cmd
  const ab = NetworkScanPayload.encode(payload)
  return ab ? new Uint8Array(ab) : new Uint8Array(0)
}

export function prepareGetWiFiScanListMsg(startIndex: number, count: number): Uint8Array {
  const cmd = new CmdScanWifiResult()
  cmd.start_index = startIndex
  cmd.count = count
  const payload = new NetworkScanPayload()
  payload.msg = NetworkScanMsgType.TypeCmdScanWifiResult
  payload.cmd_scan_wifi_result = cmd
  const ab = NetworkScanPayload.encode(payload)
  return ab ? new Uint8Array(ab) : new Uint8Array(0)
}

export function prepareWiFiConfigMsg(ssid: string, passphrase: string): Uint8Array {
  const cmd = new CmdSetWifiConfig()
  cmd.ssid = stringToCollectionsUint8Array(ssid)
  cmd.passphrase = stringToCollectionsUint8Array(passphrase)
  const payload = new NetworkConfigPayload()
  payload.msg = NetworkConfigMsgType.TypeCmdSetWifiConfig
  payload.cmd_set_wifi_config = cmd
  const ab = NetworkConfigPayload.encode(payload)
  return ab ? new Uint8Array(ab) : new Uint8Array(0)
}

export function prepareApplyWiFiConfigMsg(): Uint8Array {
  const cmd = new CmdApplyWifiConfig()
  const payload = new NetworkConfigPayload()
  payload.msg = NetworkConfigMsgType.TypeCmdApplyWifiConfig
  payload.cmd_apply_wifi_config = cmd
  const ab = NetworkConfigPayload.encode(payload)
  return ab ? new Uint8Array(ab) : new Uint8Array(0)
}

export function prepareGetWiFiConfigStatusMsg(): Uint8Array {
  const cmd = new CmdGetWifiStatus()
  const payload = new NetworkConfigPayload()
  payload.msg = NetworkConfigMsgType.TypeCmdGetWifiStatus
  payload.cmd_get_wifi_status = cmd
  const ab = NetworkConfigPayload.encode(payload)
  return ab ? new Uint8Array(ab) : new Uint8Array(0)
}

export function prepareWiFiResetMsg(): Uint8Array {
  const cmd = new CmdCtrlWifiReset()
  const payload = new NetworkCtrlPayload()
  payload.msg = NetworkCtrlMsgType.TypeCmdCtrlWifiReset
  payload.cmd_ctrl_wifi_reset = cmd
  const ab = NetworkCtrlPayload.encode(payload)
  return ab ? new Uint8Array(ab) : new Uint8Array(0)
}

export interface WiFiScanStatus {
  scanFinished: boolean
  resultCount: number
}

export function parseWiFiScanStatusResponse(data: Uint8Array): WiFiScanStatus {
  const payload = NetworkScanPayload.decode(toArrayBuffer(data))
  if (!payload || !payload.hasRespScanWifiStatus()) {
    return { scanFinished: false, resultCount: 0 }
  }
  const resp = payload.resp_scan_wifi_status!
  return {
    scanFinished: resp.scan_finished ?? false,
    resultCount: resp.result_count ?? 0
  }
}

export function parseWiFiScanListResponse(data: Uint8Array): WiFiAccessPoint[] {
  const payload = NetworkScanPayload.decode(toArrayBuffer(data))
  if (!payload || !payload.hasRespScanWifiResult()) {
    return []
  }
  const resp = payload.resp_scan_wifi_result!
  const entries = resp.entries
  const results: WiFiAccessPoint[] = []
  const decoder = util.TextDecoder.create('utf-8')
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i] as WiFiScanResult
    const ssidBytes = entry.ssid
    const ssid = (ssidBytes !== undefined && ssidBytes.length > 0)
      ? decoder.decodeToString(collectionsUint8ArrayToStandard(ssidBytes)) : ''
    const rssi = entry.rssi ?? 0
    const auth = entry.auth ?? 0
    if (ssid.length > 0) {
      results.push(new WiFiAccessPoint(ssid, rssi, auth))
    }
  }
  return results
}

export interface WiFiConfigStatus {
  state: number
  failReason: number
}

export function parseWiFiConfigStatusResponse(data: Uint8Array): WiFiConfigStatus {
  const payload = NetworkConfigPayload.decode(toArrayBuffer(data))
  if (!payload || !payload.hasRespGetWifiStatus()) {
    return { state: 2, failReason: -1 }
  }
  const resp = payload.resp_get_wifi_status!
  const state = resp.wifi_sta_state ?? 2
  const failReason = resp.wifi_fail_reason !== undefined ? resp.wifi_fail_reason : -1
  return { state, failReason }
}
