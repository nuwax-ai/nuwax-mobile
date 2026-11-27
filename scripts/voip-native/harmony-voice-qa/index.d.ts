declare const rtc: {
  start(endpoint: string, token: string): number
  stop(handle: number): void
  status(handle: number, field: number): number
  mute(handle: number, muted: boolean): void
  readPcm(handle: number, data: ArrayBuffer): number
  writePcm(handle: number, data: ArrayBuffer): void
}
export default rtc
