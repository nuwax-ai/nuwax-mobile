import { ESPScanDevice } from '../ESPScanDevice'

export interface BleScanListener {
  scanStartFailed: () => void
  onPeripheralFound: (device: ESPScanDevice) => void
  scanCompleted: () => void
  onFailure: (e: Error) => void
}
