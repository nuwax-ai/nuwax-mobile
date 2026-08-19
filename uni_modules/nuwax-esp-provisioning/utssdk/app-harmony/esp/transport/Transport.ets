export interface Transport {
  sendConfigData(path: string, data: Uint8Array): Promise<Uint8Array>

  disconnect(): void
}
