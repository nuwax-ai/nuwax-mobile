import { WiFiAccessPoint } from '../WiFiAccessPoint'

export interface WiFiScanListener {
  onWifiListReceived: (wifiList: WiFiAccessPoint[]) => void
  onWiFiScanFailed: (e: Error) => void
}
