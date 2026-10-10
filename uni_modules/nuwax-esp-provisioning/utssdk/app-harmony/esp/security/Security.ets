export interface Security {
  getNextRequestInSession(hexData: Uint8Array | null): Promise<Uint8Array | null>

  encrypt(data: Uint8Array): Uint8Array

  decrypt(data: Uint8Array): Uint8Array
}
