import { Security } from './Security'
import {
  SessionData,
  SecSchemeVersion,
  S0SessionCmd,
  Sec0Payload,
  Sec0MsgType
} from '../proto/espressif'

const SESSION_STATE_REQUEST1 = 0
const SESSION_STATE_RESPONSE1 = 1
const SESSION_STATE_FINISHED = 2

export class Security0 implements Security {
  private sessionState: number = SESSION_STATE_REQUEST1

  async getNextRequestInSession(_hexData: Uint8Array | null): Promise<Uint8Array | null> {
    let request: Uint8Array | null = null

    switch (this.sessionState) {
      case SESSION_STATE_REQUEST1:
        this.sessionState = SESSION_STATE_RESPONSE1
        request = this.getStep0Request()
        break
      case SESSION_STATE_RESPONSE1:
        this.sessionState = SESSION_STATE_FINISHED
        break
      default:
        break
    }

    return request
  }

  private getStep0Request(): Uint8Array {
    const sessionCmd = new S0SessionCmd()
    const sec0Payload = new Sec0Payload()
    sec0Payload.msg = Sec0MsgType.S0_Session_Command
    sec0Payload.sc = sessionCmd
    const sessionData = new SessionData()
    sessionData.sec_ver = SecSchemeVersion.SecScheme0
    sessionData.sec0 = sec0Payload
    const ab = SessionData.encode(sessionData)
    return ab ? new Uint8Array(ab) : new Uint8Array(0)
  }

  encrypt(data: Uint8Array): Uint8Array {
    return data
  }

  decrypt(data: Uint8Array): Uint8Array {
    return data
  }
}
