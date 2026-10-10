export interface ResponseListener {
  onSuccess: (data: Uint8Array) => void

  onFailure: (e: Error) => void
}
