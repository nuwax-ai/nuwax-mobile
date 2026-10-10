export interface SessionListener {
  onSessionEstablished: () => void
  onSessionEstablishFailed: (e: Error) => void
}
