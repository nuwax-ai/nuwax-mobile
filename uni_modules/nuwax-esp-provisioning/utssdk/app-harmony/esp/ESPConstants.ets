export enum TransportType {
  TRANSPORT_BLE = 'TRANSPORT_BLE'
}

export enum SecurityType {
  SECURITY_0 = 0,
  SECURITY_1 = 1,
  SECURITY_2 = 2
}

export enum ProvisionFailureReason {
  AUTH_FAILED = 'AUTH_FAILED',
  NETWORK_NOT_FOUND = 'NETWORK_NOT_FOUND',
  DEVICE_DISCONNECTED = 'DEVICE_DISCONNECTED',
  UNKNOWN = 'UNKNOWN'
}

export const HANDLER_PROV_SCAN = 'prov-scan'
export const HANDLER_PROTO_VER = 'proto-ver'
export const HANDLER_PROV_SESSION = 'prov-session'
export const HANDLER_PROV_CONFIG = 'prov-config'
export const HANDLER_PROV_CTRL = 'prov-ctrl'

export const EVENT_DEVICE_CONNECTED: number = 1
export const EVENT_DEVICE_CONNECTION_FAILED: number = 2
export const EVENT_DEVICE_DISCONNECTED: number = 3

export const USER_DESCRIPTION_UUID = '00002901'

export const WIFI_OPEN: number = 0
export const WIFI_WEP: number = 1
export const WIFI_WPA_PSK: number = 2
export const WIFI_WPA2_PSK: number = 3
export const WIFI_WPA_WPA2_PSK: number = 4
export const WIFI_WPA2_ENTERPRISE: number = 5
export const WIFI_WPA3_PSK: number = 6
export const WIFI_WPA2_WPA3_PSK: number = 7
