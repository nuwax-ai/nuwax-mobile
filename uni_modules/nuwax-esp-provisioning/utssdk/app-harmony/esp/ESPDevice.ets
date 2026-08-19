import { ESPScanDevice } from './ESPScanDevice'
import { SecurityType, HANDLER_PROV_SCAN, HANDLER_PROV_CONFIG, ProvisionFailureReason } from './ESPConstants'
import { BLETransport } from './transport/BLETransport'
import { Security } from './security/Security'
import { Security0 } from './security/Security0'
import { Security1 } from './security/Security1'
import { Security2 } from './security/Security2'
import { Session } from './Session'
import { WiFiAccessPoint } from './WiFiAccessPoint'
import { WiFiScanListener } from './listeners/WiFiScanListener'
import { ProvisionListener } from './listeners/ProvisionListener'
import { SessionListener } from './listeners/SessionListener'
import {
  parseWiFiConfigStatusResponse,
  parseWiFiScanListResponse,
  parseWiFiScanStatusResponse,
  prepareApplyWiFiConfigMsg,
  prepareGetWiFiConfigStatusMsg,
  prepareGetWiFiScanListMsg,
  prepareGetWiFiScanStatusMsg,
  prepareWiFiConfigMsg,
  prepareWiFiScanStartMsg } from './utils/MessageHelper'
import { BleDevice } from '@ohos/fastble'

const TAG = 'ESPDevice'
const WIFI_SCAN_BATCH_SIZE = 4
const PROVISION_POLL_INTERVAL_MS = 5000
const PROVISION_POLL_MAX_RETRIES = 10

export class ESPDevice {
  private securityType: SecurityType
  private transport: BLETransport
  private session: Session | null = null
  private proofOfPossession: string = ''
  private userName: string = ''
  private secPatchVersion: number = 0

  deviceName: string = ''
  primaryServiceUuid: string = ''
  deviceCapabilities: string[] = []
  versionInfo: string = ''

  constructor(securityType: SecurityType) {
    this.securityType = securityType
    this.transport = new BLETransport()
  }

  setProofOfPossession(pop: string): void {
    this.proofOfPossession = pop
  }

  setUserName(userName: string): void {
    this.userName = userName
  }

  setSecurityType(securityType: SecurityType): void {
    this.securityType = securityType
  }

  /** 与 Android 对齐：从 transport 取 versionInfo（BLE 时即 proto-ver 返回值） */
  getVersionInfo(): string {
    return this.transport.versionInfo
  }

  async connectBLEDevice(device: ESPScanDevice, serviceUuid: string): Promise<void> {
    this.primaryServiceUuid = serviceUuid
    const raw: BleDevice = device.getRawDevice()
    await this.transport.connect(raw, serviceUuid)
    console.info(TAG, `Device connected: ${device.getName()}`)
  }

  /**
   * 与 Android 对齐：在 initSession 内获取 proto-ver，解析 sec_ver/no_pop/sec_patch_ver 后创建 Session 并初始化。
   */
  async initSession(listener: SessionListener): Promise<void> {
    try {
      await this.transport.fetchVersionInfo()
      this.versionInfo = this.transport.versionInfo
      this.deviceCapabilities = this.transport.deviceCapabilities
      console.info(TAG, 'Capabilities: ' + JSON.stringify(this.deviceCapabilities))

      const versionInfo = this.versionInfo
      if (!versionInfo || versionInfo.length === 0) {
        console.warn(TAG, 'Version info empty, using current security type')
        await this.createSessionAndInit(listener)
        return
      }

      const jsonObj = JSON.parse(versionInfo) as Record<string, Object>
      const provInfo = jsonObj['prov'] as Record<string, Object> | undefined
      if (!provInfo) {
        console.warn(TAG, 'Capabilities JSON not available.')
        await this.createSessionAndInit(listener)
        return
      }

      const deviceVersion = provInfo['ver'] as string | undefined
      console.info(TAG, 'Device Version: ' + (deviceVersion ?? ''))

      if (this.deviceCapabilities.includes('no_pop')) {
        this.proofOfPossession = ''
      }
      console.info(TAG, 'POP: ' + this.proofOfPossession)

      const hasSecVer = provInfo['sec_ver'] !== undefined
      if (hasSecVer) {
        const serVer = Number(provInfo['sec_ver'])
        console.info(TAG, 'Security Version: ' + serVer)
        if (serVer === 0) {
          this.securityType = SecurityType.SECURITY_0
        } else if (serVer === 1) {
          this.securityType = SecurityType.SECURITY_1
        } else {
          this.securityType = SecurityType.SECURITY_2
          if (provInfo['sec_patch_ver'] !== undefined) {
            this.secPatchVersion = Number(provInfo['sec_patch_ver'])
            console.info(TAG, 'Security Patch Version: ' + this.secPatchVersion)
          }
        }
      } else {
        console.warn(TAG, 'Older firmware as Sec version not found.')
        if (this.securityType === SecurityType.SECURITY_2) {
          this.securityType = SecurityType.SECURITY_1
        }
      }

      console.info(TAG, 'Init session with: ' + this.securityType)
      await this.createSessionAndInit(listener)
    } catch (e) {
      console.error(TAG, 'initSession failed: ' + (e as Error).message)
      listener.onSessionEstablishFailed(e as Error)
    }
  }

  private async createSessionAndInit(listener: SessionListener): Promise<void> {
    const security = this.createSecurity()
    this.session = new Session(this.transport, security)
    await this.session.init(listener)
  }

  private createSecurity(): Security {
    switch (this.securityType) {
      case SecurityType.SECURITY_0:
        return new Security0()
      case SecurityType.SECURITY_1:
        return new Security1(this.proofOfPossession)
      case SecurityType.SECURITY_2:
        return new Security2(this.userName, this.proofOfPossession, this.secPatchVersion)
      default:
        return new Security0()
    }
  }

  async scanNetworks(listener: WiFiScanListener): Promise<void> {
    if (!this.session || !this.session.isSessionEstablished()) {
      listener.onWiFiScanFailed(new Error('Session not established'))
      return
    }

    try {
      // Step 1: Start WiFi scan
      const scanStartMsg = prepareWiFiScanStartMsg()
      await this.session.sendDataToDevice(HANDLER_PROV_SCAN, scanStartMsg)

      // // Step 2: Poll for scan status
      let scanFinished = false
      let totalResults = 0

      while (!scanFinished) {
        await sleep(2000)
        const statusMsg = prepareGetWiFiScanStatusMsg()
        const statusResponse = await this.session.sendDataToDevice(HANDLER_PROV_SCAN, statusMsg)
        const status = parseWiFiScanStatusResponse(statusResponse)
        scanFinished = status.scanFinished
        totalResults = status.resultCount
        console.info(TAG, `WiFi scan status: finished=${scanFinished}, count=${totalResults}`)
      }

      // Step 3: Fetch results in batches
      const allResults: WiFiAccessPoint[] = []
      let startIndex = 0

      while (startIndex < totalResults) {
        const count = Math.min(WIFI_SCAN_BATCH_SIZE, totalResults - startIndex)
        const listMsg = prepareGetWiFiScanListMsg(startIndex, count)
        const listResponse = await this.session.sendDataToDevice(HANDLER_PROV_SCAN, listMsg)
        const results = parseWiFiScanListResponse(listResponse)
        allResults.push(...results)
        startIndex += count
      }

      console.info(TAG, `WiFi scan complete, found ${allResults.length} networks`)
      listener.onWifiListReceived(allResults)
    } catch (e) {
      console.error(TAG, `WiFi scan failed: ${(e as Error).message}`)
      listener.onWiFiScanFailed(e as Error)
    }
  }

  async provision(ssid: string, passphrase: string, listener: ProvisionListener): Promise<void> {
    if (!this.session || !this.session.isSessionEstablished()) {
      listener.createSessionFailed()
      return
    }

    try {
    //   // Step 1: Set WiFi config
      const configMsg = prepareWiFiConfigMsg(ssid, passphrase)
      await this.session.sendDataToDevice(HANDLER_PROV_CONFIG, configMsg)
      listener.wifiConfigSent()
    } catch (e) {
      console.error(TAG, `WiFi config send failed: ${(e as Error).message}`)
      listener.wifiConfigFailed(e as Error)
      return
    }

    try {
    //   // Step 2: Apply WiFi config
      const applyMsg = prepareApplyWiFiConfigMsg()
      await this.session.sendDataToDevice(HANDLER_PROV_CONFIG, applyMsg)
      listener.wifiConfigApplied()
    } catch (e) {
      console.error(TAG, `WiFi config apply failed: ${(e as Error).message}`)
      listener.wifiConfigApplyFailed(e as Error)
      return
    }

    // Step 3: Poll for connection status
    this.pollForWifiConnectionStatus(listener)
  }

  private async pollForWifiConnectionStatus(listener: ProvisionListener): Promise<void> {
    for (let retry = 0; retry < PROVISION_POLL_MAX_RETRIES; retry++) {
      await sleep(PROVISION_POLL_INTERVAL_MS)

      try {
        const statusMsg = prepareGetWiFiConfigStatusMsg()
        const response = await this.session!.sendDataToDevice(HANDLER_PROV_CONFIG, statusMsg)
        const status = parseWiFiConfigStatusResponse(response)

        console.info(TAG, `WiFi status: state=${status.state}, failReason=${status.failReason}`)

        switch (status.state) {
          case 0: // Connected
            console.info(TAG, 'Provisioning successful!')
            listener.deviceProvisioningSuccess()
            return
          case 1: // Connecting
            console.info(TAG, 'Still connecting...')
            break
          case 3: // ConnectionFailed
            if (status.failReason === 0) { // AuthError
              listener.provisioningFailedFromDevice(ProvisionFailureReason.AUTH_FAILED)
            } else if (status.failReason === 1) { // NetworkNotFound
              listener.provisioningFailedFromDevice(ProvisionFailureReason.NETWORK_NOT_FOUND)
            } else {
              listener.provisioningFailedFromDevice(ProvisionFailureReason.UNKNOWN)
            }
            return
          case 2: // Disconnected
          default:
            break
        }
      } catch (e) {
        console.error(TAG, `Status poll error: ${(e as Error).message}`)
        if (retry === PROVISION_POLL_MAX_RETRIES - 1) {
          listener.onProvisioningFailed(e as Error)
          return
        }
      }
    }

    listener.onProvisioningFailed(new Error('Provisioning timed out'))
  }

  async resetWifiConfig(): Promise<void> {
    // if (this.session && this.session.isSessionEstablished()) {
    //   const resetMsg = prepareWiFiResetMsg()
    //   await this.session.sendDataToDevice(HANDLER_PROV_CTRL, resetMsg)
    // }
  }

  async sendDataToCustomEndPoint(path: string, data: Uint8Array): Promise<Uint8Array> {
    if (!this.session || !this.session.isSessionEstablished()) {
      throw new Error('Session not established')
    }
    return this.session.sendDataToDevice(path, data)
  }

  disconnect(): void {
    this.transport.disconnect()
    this.session = null
  }

  getTransport(): BLETransport {
    return this.transport
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}
