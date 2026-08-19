import { ProvisionFailureReason } from '../ESPConstants'

export interface ProvisionListener {
  createSessionFailed: () => void
  wifiConfigSent: () => void
  wifiConfigFailed: (e: Error) => void
  wifiConfigApplied: () => void
  wifiConfigApplyFailed: (e: Error) => void
  provisioningFailedFromDevice: (reason: ProvisionFailureReason) => void
  deviceProvisioningSuccess: () => void
  onProvisioningFailed: (e: Error) => void
}
