/**
 * Security 2 会话，改编自 esp-idf-provisioning-harmony Security2.ets。
 * protobuf 走本地 EspProto，避免 @hadss/turbo-trans-protobuf。
 */
import { Security } from './Security'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { SRP6ClientSession } from '../srp6a/SRP6ClientSession'
import { SRP6CryptoParams } from '../srp6a/SRP6CryptoParams'
import { bigIntegerToBytes, bigIntegerFromBytes } from '../srp6a/BigIntegerUtils'
import {
  encodeSessionCmd0,
  encodeSessionCmd1,
  decodeSessionResp0,
  decodeSessionResp1,
  utf8Encode
} from '../proto/EspProto'

const SESSION_STATE_REQUEST1 = 0
const SESSION_STATE_RESPONSE1_REQUEST2 = 1
const SESSION_STATE_RESPONSE2 = 2
const SESSION_STATE_FINISHED = 3

export class Security2 implements Security {
  private sessionState: number = SESSION_STATE_REQUEST1
  private userName: string
  private client: SRP6ClientSession
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
    const publicKeyA = bigIntegerToBytes(this.client.getClientPublicKey(params))
    return encodeSessionCmd0(utf8Encode(this.userName), publicKeyA)
  }

  private getStep1Request(): Uint8Array {
    return encodeSessionCmd1(this.clientProof)
  }

  private processStep0Response(hexData: Uint8Array): void {
    const sr0 = decodeSessionResp0(hexData)
    const salt = bigIntegerFromBytes(sr0.salt)
    const devicePublicKey = bigIntegerFromBytes(sr0.pubkey)
    const params = SRP6CryptoParams.getInstance(3072, 'SHA-512')
    const credentials = this.client.step2ForClientEvidence(params, salt, devicePublicKey, sr0.salt)
    this.clientProof = bigIntegerToBytes(credentials.M1)
  }

  private processStep1Response(hexData: Uint8Array): void {
    const sr1 = decodeSessionResp1(hexData)
    this.deviceNonce = sr1.nonce
    this.client.step3(bigIntegerFromBytes(sr1.proof))
    const sharedKey = bigIntegerToBytes(this.client.K)
    this.key = sharedKey.slice(0, 32)
    if (this.deviceNonce.length >= 12) {
      this.counter = ((this.deviceNonce[8] & 0xFF) << 24) |
        ((this.deviceNonce[9] & 0xFF) << 16) |
        ((this.deviceNonce[10] & 0xFF) << 8) |
        (this.deviceNonce[11] & 0xFF)
    }
  }

  encrypt(data: Uint8Array): Uint8Array {
    return this.doAesGcm(cryptoFramework.CryptoMode.ENCRYPT_MODE, data, this.getNonce())
  }

  decrypt(data: Uint8Array): Uint8Array {
    return this.doAesGcm(cryptoFramework.CryptoMode.DECRYPT_MODE, data, this.getNonce())
  }

  private getNonce(): Uint8Array {
    if (this.secPatchVersion == 1) {
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

  private doAesGcm(mode: cryptoFramework.CryptoMode, data: Uint8Array, nonce: Uint8Array): Uint8Array {
    const cipher = cryptoFramework.createCipher('AES256|GCM|NoPadding')
    const symKeyGen = cryptoFramework.createSymKeyGenerator('AES256')
    const symKey = symKeyGen.convertKeySync({ data: this.key })
    if (mode == cryptoFramework.CryptoMode.ENCRYPT_MODE) {
      const gcmParams: cryptoFramework.GcmParamsSpec = {
        algName: 'GcmParamsSpec',
        iv: { data: nonce },
        aad: { data: new Uint8Array(0) },
        authTag: { data: new Uint8Array(16) }
      }
      cipher.initSync(mode, symKey, gcmParams)
      const result = cipher.doFinalSync({ data: data })
      return result ? new Uint8Array(result.data) : new Uint8Array(0)
    }
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
