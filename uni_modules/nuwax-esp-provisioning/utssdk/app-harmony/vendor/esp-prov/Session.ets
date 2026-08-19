import { Security } from './security/Security'

const HANDLER_PROV_SESSION = 'prov-session'

export interface SessionListener {
  onSessionEstablished: () => void
  onSessionEstablishFailed: (e: Error) => void
}

export interface Transport {
  sendConfigData(path: string, data: Uint8Array): Promise<Uint8Array>
}

export class Session {
  private transport: Transport
  private security: Security
  private isEstablished: boolean = false

  constructor(transport: Transport, security: Security) {
    this.transport = transport
    this.security = security
  }

  async init(listener: SessionListener): Promise<void> {
    try {
      let response: Uint8Array | null = null
      let request = await this.security.getNextRequestInSession(null)
      while (request !== null) {
        response = await this.transport.sendConfigData(HANDLER_PROV_SESSION, request)
        request = await this.security.getNextRequestInSession(response)
      }
      this.isEstablished = true
      listener.onSessionEstablished()
    } catch (e) {
      listener.onSessionEstablishFailed(e as Error)
    }
  }

  isSessionEstablished(): boolean {
    return this.isEstablished
  }

  async sendDataToDevice(path: string, data: Uint8Array): Promise<Uint8Array> {
    if (!this.isEstablished) {
      throw new Error('Session not established')
    }
    const encryptedData = this.security.encrypt(data)
    const response = await this.transport.sendConfigData(path, encryptedData)
    return this.security.decrypt(response)
  }
}
