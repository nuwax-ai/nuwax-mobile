import { Transport } from './transport/Transport'
import { Security } from './security/Security'
import { HANDLER_PROV_SESSION } from './ESPConstants'
import { SessionListener } from './listeners/SessionListener'

const TAG = 'Session'

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
        console.info(TAG, `Sending session request (${request.length} bytes)`)
        response = await this.transport.sendConfigData(HANDLER_PROV_SESSION, request)
        console.info(TAG, `Received session response (${response.length} bytes)`)
        request = await this.security.getNextRequestInSession(response)
      }

      this.isEstablished = true
      console.info(TAG, 'Session established successfully')
      listener.onSessionEstablished()
    } catch (e) {
      console.error(TAG, `Session establishment failed: ${(e as Error).message}`)
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

  getSecurity(): Security {
    return this.security
  }

  getTransport(): Transport {
    return this.transport
  }
}
