export class WiFiAccessPoint {
  ssid: string = ''
  rssi: number = 0
  security: number = 0
  password: string = ''

  constructor(ssid: string, rssi: number, security: number) {
    this.ssid = ssid
    this.rssi = rssi
    this.security = security
  }
}
