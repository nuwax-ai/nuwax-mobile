import { Security } from './Security'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { SRP6ClientSession } from '../srp6a/SRP6ClientSession'
import { SRP6CryptoParams } from '../srp6a/SRP6CryptoParams'
import { bigIntegerToBytes, bigIntegerFromBytes } from '../srp6a/BigIntegerUtils'
import { util, collections } from '@kit.ArkTS'
import {
  SessionData,
  SecSchemeVersion,
  S2SessionCmd0,
  S2SessionCmd1,
  Sec2Payload,
  Sec2MsgType
} from '../proto/espressif'

function toCollectionsUint8Array(arr: Uint8Array): collections.Uint8Array {
  const n = arr.length
  const c = new collections.Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const v: number = arr[i] !== undefined ? arr[i] as number : 0
    c[i] = v
  }
  return c
}

function fromCollectionsUint8Array(arr: collections.Uint8Array): Uint8Array {
  const n = arr.length
  const u = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const v = arr.at(i)
    u[i] = v !== undefined ? v : 0
  }
  return u
}

const SESSION_STATE_REQUEST1 = 0
const SESSION_STATE_RESPONSE1_REQUEST2 = 1
const SESSION_STATE_RESPONSE2 = 2
const SESSION_STATE_FINISHED = 3

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer
  }
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
}

export class Security2 implements Security {
  private sessionState: number = SESSION_STATE_REQUEST1
  private userName: string
  private client: SRP6ClientSession
  private clientPublicKey: bigint = 0n
  private clientProof: Uint8Array = new Uint8Array(0)
  private deviceNonce: Uint8Array = new Uint8Array(0)
  private key: Uint8Array = new Uint8Array(0)
  private counter: number = 0
  private secPatchVersion: number = 0

  constructor(username: string, password: string, patchVersion: number = 0) {
    this.userName = username
    this.secPatchVersion = patchVersion
    this.client = new SRP6ClientSession()
    this.client.step1(username, password)
  }

  async getNextRequestInSession(hexData: Uint8Array | null): Promise<Uint8Array | null> {
    let request: Uint8Array | null = null

    switch (this.sessionState) {
      case SESSION_STATE_REQUEST1:
        this.sessionState = SESSION_STATE_RESPONSE1_REQUEST2
        request = this.getStep0Request()
        break
      case SESSION_STATE_RESPONSE1_REQUEST2:
        this.sessionState = SESSION_STATE_RESPONSE2
        this.processStep0Response(hexData!)
        request = this.getStep1Request()
        break
      case SESSION_STATE_RESPONSE2:
        this.sessionState = SESSION_STATE_FINISHED
        this.processStep1Response(hexData!)
        break
      default:
        break
    }

    return request
  }

  private getStep0Request(): Uint8Array {
    const params = SRP6CryptoParams.getInstance(3072, 'SHA-512')
    this.clientPublicKey = this.client.getClientPublicKey(params)
    const publicKeyA = bigIntegerToBytes(this.clientPublicKey)

    const encoder = new util.TextEncoder()
    const usernameBytes = new Uint8Array(encoder.encodeInto(this.userName))

    const sessionCmd0 = new S2SessionCmd0()
    sessionCmd0.client_username = toCollectionsUint8Array(usernameBytes)
    sessionCmd0.client_pubkey = toCollectionsUint8Array(publicKeyA)
    const sec2Payload = new Sec2Payload()
    sec2Payload.sc0 = sessionCmd0
    const sessionData = new SessionData()
    sessionData.sec_ver = SecSchemeVersion.SecScheme2
    sessionData.sec2 = sec2Payload
    const ab = SessionData.encode(sessionData)
    return ab ? new Uint8Array(ab) : new Uint8Array(0)
  }

  private getStep1Request(): Uint8Array {
    const sessionCmd1 = new S2SessionCmd1()
    sessionCmd1.client_proof = toCollectionsUint8Array(this.clientProof)
    const sec2Payload = new Sec2Payload()
    sec2Payload.msg = Sec2MsgType.S2Session_Command1
    sec2Payload.sc1 = sessionCmd1
    const sessionData = new SessionData()
    sessionData.sec_ver = SecSchemeVersion.SecScheme2
    sessionData.sec2 = sec2Payload
    const ab = SessionData.encode(sessionData)
    return ab ? new Uint8Array(ab) : new Uint8Array(0)
  }

  private processStep0Response(hexData: Uint8Array): void {
    const responseData = SessionData.decode(toArrayBuffer(hexData))
    if (!responseData || responseData.sec_ver !== SecSchemeVersion.SecScheme2) {
      throw new Error('Security version mismatch')
    }
    const sec2 = responseData.sec2!
    if (!sec2.hasSr0()) {
      throw new Error('Missing S2SessionResp0')
    }
    const sr0 = sec2.sr0!
    const deviceSaltBytes = sr0.device_salt !== undefined && sr0.device_salt.length > 0
      ? fromCollectionsUint8Array(sr0.device_salt) : new Uint8Array(0)
    const devicePubKeyBytes = sr0.device_pubkey !== undefined && sr0.device_pubkey.length > 0
      ? fromCollectionsUint8Array(sr0.device_pubkey) : new Uint8Array(0)

    const salt = bigIntegerFromBytes(deviceSaltBytes)
    const devicePublicKey = bigIntegerFromBytes(devicePubKeyBytes)

    const params = SRP6CryptoParams.getInstance(3072, 'SHA-512')
    const credentials = this.client.step2ForClientEvidence(params, salt, devicePublicKey,
      deviceSaltBytes)
    this.clientProof = bigIntegerToBytes(credentials.M1)
  }

  private processStep1Response(hexData: Uint8Array): void {
    const responseData = SessionData.decode(toArrayBuffer(hexData))
    if (!responseData || responseData.sec_ver !== SecSchemeVersion.SecScheme2) {
      throw new Error('Security version mismatch')
    }
    const sec2 = responseData.sec2!
    if (!sec2.hasSr1()) {
      throw new Error('Missing S2SessionResp1')
    }
    const sr1 = sec2.sr1!
    const deviceProofBytes = sr1.device_proof !== undefined && sr1.device_proof.length > 0
      ? fromCollectionsUint8Array(sr1.device_proof) : new Uint8Array(0)
    this.deviceNonce = sr1.device_nonce !== undefined && sr1.device_nonce.length > 0
      ? fromCollectionsUint8Array(sr1.device_nonce) : new Uint8Array(0)

    this.client.step3(bigIntegerFromBytes(deviceProofBytes))

    const sharedKey = bigIntegerToBytes(this.client.K)
    this.key = sharedKey.slice(0, 32)

    this.counter = ((this.deviceNonce[8] & 0xFF) << 24) |
      ((this.deviceNonce[9] & 0xFF) << 16) |
      ((this.deviceNonce[10] & 0xFF) << 8) |
      (this.deviceNonce[11] & 0xFF)
  }

  encrypt(data: Uint8Array): Uint8Array {
    const nonce = this.getNonce()
    return this.doAesGcm(cryptoFramework.CryptoMode.ENCRYPT_MODE, data, nonce)
  }

  decrypt(data: Uint8Array): Uint8Array {
    const nonce = this.getNonce()
    return this.doAesGcm(cryptoFramework.CryptoMode.DECRYPT_MODE, data, nonce)
  }

  private getNonce(): Uint8Array {
    if (this.secPatchVersion === 1) {
      const nonce = new Uint8Array(12)
      nonce.set(this.deviceNonce.slice(0, 8), 0)
      nonce[8] = (this.counter >> 24) & 0xFF
      nonce[9] = (this.counter >> 16) & 0xFF
      nonce[10] = (this.counter >> 8) & 0xFF
      nonce[11] = this.counter & 0xFF
      this.counter++
      return nonce
    }
    return this.deviceNonce
  }

  private doAesGcm(mode: cryptoFramework.CryptoMode, data: Uint8Array,
    nonce: Uint8Array): Uint8Array {
    const cipher = cryptoFramework.createCipher('AES256|GCM|NoPadding')
    const symKeyGen = cryptoFramework.createSymKeyGenerator('AES256')
    const symKey = symKeyGen.convertKeySync({ data: this.key })

    if (mode === cryptoFramework.CryptoMode.ENCRYPT_MODE) {
      const gcmParams: cryptoFramework.GcmParamsSpec = {
        algName: 'GcmParamsSpec',
        iv: { data: nonce },
        aad: { data: new Uint8Array(0) },
        authTag: { data: new Uint8Array(16) }
      }
      cipher.initSync(mode, symKey, gcmParams)
      const result = cipher.doFinalSync({ data: data })
      // Result = ciphertext + authTag(16 bytes)
      return result ? new Uint8Array(result.data) : new Uint8Array(0)
    } else {
      // For decryption, last 16 bytes of data is authTag
      const authTag = data.slice(data.length - 16)
      const ciphertext = data.slice(0, data.length - 16)

      const gcmParams: cryptoFramework.GcmParamsSpec = {
        algName: 'GcmParamsSpec',
        iv: { data: nonce },
        aad: { data: new Uint8Array(0) },
        authTag: { data: authTag }
      }
      cipher.initSync(mode, symKey, gcmParams)
      const result = cipher.doFinalSync({ data: ciphertext })
      return result ? new Uint8Array(result.data) : new Uint8Array(0)
    }
  }
}
