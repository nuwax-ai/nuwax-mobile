import { Security } from './Security'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { CryptoJS } from '@ohos/crypto-js'
import { xorBytes, bytesToHex } from '../utils/HexUtil'
import { util, collections } from '@kit.ArkTS'
import {
  SessionData,
  SecSchemeVersion,
  SessionCmd0,
  SessionCmd1,
  Sec1Payload,
  Sec1MsgType
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

export class Security1 implements Security {
  private sessionState: number = SESSION_STATE_REQUEST1
  private privateKey: cryptoFramework.PriKey | null = null
  private publicKey: Uint8Array = new Uint8Array(0)
  private proofOfPossession: Uint8Array | null = null
  private clientVerify: Uint8Array = new Uint8Array(0)
  private cipher: cryptoFramework.Cipher | null = null

  constructor(pop?: string) {
    if (pop && pop.length > 0) {
      const encoder = new util.TextEncoder()
      this.proofOfPossession = new Uint8Array(encoder.encodeInto(pop))
    }
  }

  async getNextRequestInSession(hexData: Uint8Array | null): Promise<Uint8Array | null> {
    let request: Uint8Array | null = null

    switch (this.sessionState) {
      case SESSION_STATE_REQUEST1:
        this.sessionState = SESSION_STATE_RESPONSE1_REQUEST2
        request = await this.getStep0Request()
        break
      case SESSION_STATE_RESPONSE1_REQUEST2:
        this.sessionState = SESSION_STATE_RESPONSE2
        await this.processStep0Response(hexData!)
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

  private async getStep0Request(): Promise<Uint8Array> {
    await this.generateKeyPair()
    const sessionCmd0 = new SessionCmd0()
    sessionCmd0.client_pubkey = toCollectionsUint8Array(this.publicKey)
    const sec1Payload = new Sec1Payload()
    sec1Payload.sc0 = sessionCmd0
    const sessionData = new SessionData()
    sessionData.sec_ver = SecSchemeVersion.SecScheme1
    sessionData.sec1 = sec1Payload
    const ab = SessionData.encode(sessionData)
    return ab ? new Uint8Array(ab) : new Uint8Array(0)
  }

  private getStep1Request(): Uint8Array {
    const sessionCmd1 = new SessionCmd1()
    sessionCmd1.client_verify_data = toCollectionsUint8Array(this.clientVerify)
    const sec1Payload = new Sec1Payload()
    sec1Payload.msg = Sec1MsgType.Session_Command1
    sec1Payload.sc1 = sessionCmd1
    const sessionData = new SessionData()
    sessionData.sec_ver = SecSchemeVersion.SecScheme1
    sessionData.sec1 = sec1Payload
    const ab = SessionData.encode(sessionData)
    return ab ? new Uint8Array(ab) : new Uint8Array(0)
  }

  private async processStep0Response(hexData: Uint8Array): Promise<void> {
    const responseData = SessionData.decode(toArrayBuffer(hexData))
    if (!responseData || responseData.sec_ver !== SecSchemeVersion.SecScheme1) {
      throw new Error('Security version mismatch')
    }
    const sec1 = responseData.sec1!
    if (!sec1.hasSr0()) {
      throw new Error('Missing SessionResp0')
    }
    const sr0 = sec1.sr0!
    const devicePublicKey = sr0.device_pubkey !== undefined && sr0.device_pubkey.length > 0
      ? fromCollectionsUint8Array(sr0.device_pubkey) : new Uint8Array(0)
    const deviceRandom = sr0.device_random !== undefined && sr0.device_random.length > 0
      ? fromCollectionsUint8Array(sr0.device_random) : new Uint8Array(0)

    let sharedKey = await this.computeSharedKey(devicePublicKey)

    if (this.proofOfPossession && this.proofOfPossession.length > 0) {
      const popHex = bytesToHex(this.proofOfPossession)
      const digestHex = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(popHex)).toString(CryptoJS.enc.Hex)
      const digest = hexToUint8Array(digestHex)
      sharedKey = xorBytes(sharedKey, digest)
    }

    this.cipher = cryptoFramework.createCipher('AES256|CTR|NoPadding')
    const keyBlob: cryptoFramework.DataBlob = { data: sharedKey }
    const symKeyGen = cryptoFramework.createSymKeyGenerator('AES256')
    const symKey = await symKeyGen.convertKey(keyBlob)

    const ivParams: cryptoFramework.IvParamsSpec = {
      algName: 'IvParamsSpec',
      iv: { data: deviceRandom }
    }

    await this.cipher.init(cryptoFramework.CryptoMode.ENCRYPT_MODE, symKey, ivParams)

    this.clientVerify = this.encrypt(devicePublicKey)
  }

  private processStep1Response(hexData: Uint8Array): void {
    const responseData = SessionData.decode(toArrayBuffer(hexData))
    if (!responseData || responseData.sec_ver !== SecSchemeVersion.SecScheme1) {
      throw new Error('Security version mismatch')
    }
    const sec1 = responseData.sec1!
    if (!sec1.hasSr1()) {
      throw new Error('Missing SessionResp1')
    }
    const sr1 = sec1.sr1!
    const deviceVerifyData = sr1.device_verify_data !== undefined && sr1.device_verify_data.length > 0
      ? fromCollectionsUint8Array(sr1.device_verify_data) : new Uint8Array(0)
    const decrypted = this.decrypt(deviceVerifyData)

    if (!arrayEquals(this.publicKey, decrypted)) {
      throw new Error('Session establishment failed!')
    }
  }

  private async generateKeyPair(): Promise<void> {
    const keyGen = cryptoFramework.createAsyKeyGenerator('X25519')
    const keyPair = await keyGen.generateKeyPair()
    this.privateKey = keyPair.priKey

    const pubKeyBlob = keyPair.pubKey.getEncoded()
    // X25519 public key DER encoding: the raw 32-byte key is at the end
    this.publicKey = extractRawX25519Key(pubKeyBlob.data)
  }

  private async computeSharedKey(devicePubKeyRaw: Uint8Array): Promise<Uint8Array> {
    const keyAgreement = cryptoFramework.createKeyAgreement('X25519')

    const keyGen = cryptoFramework.createAsyKeyGenerator('X25519')
    const devicePubKeyBlob: cryptoFramework.DataBlob = {
      data: wrapX25519PublicKey(devicePubKeyRaw)
    }
    const devicePubKey = await keyGen.convertKey(devicePubKeyBlob, null)

    const secret = await keyAgreement.generateSecret(this.privateKey!, devicePubKey.pubKey)
    return new Uint8Array(secret.data)
  }

  encrypt(data: Uint8Array): Uint8Array {
    if (!this.cipher) {
      throw new Error('Cipher not initialized')
    }
    // AES-CTR is a stream cipher. Use updateSync to maintain counter state.
    const input: cryptoFramework.DataBlob = { data: data }
    const result = this.cipher.updateSync(input)
    return result ? new Uint8Array(result.data) : new Uint8Array(0)
  }

  decrypt(data: Uint8Array): Uint8Array {
    // AES-CTR is symmetric: encrypt === decrypt with same key/IV/counter
    return this.encrypt(data)
  }
}

function hexToUint8Array(hex: string): Uint8Array {
  const len = hex.length
  const arr = new Uint8Array(len / 2)
  for (let i = 0; i < len; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return arr
}

function arrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// X25519 raw key is 32 bytes. The DER-encoded public key has a header.
// SubjectPublicKeyInfo for X25519: 30 2a 30 05 06 03 2b 65 6e 03 21 00 <32 bytes>
const X25519_PUB_HEADER = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65,
  0x6e, 0x03, 0x21, 0x00
])

function wrapX25519PublicKey(rawKey: Uint8Array): Uint8Array {
  const result = new Uint8Array(X25519_PUB_HEADER.length + rawKey.length)
  result.set(X25519_PUB_HEADER, 0)
  result.set(rawKey, X25519_PUB_HEADER.length)
  return result
}

function extractRawX25519Key(derKey: Uint8Array): Uint8Array {
  if (derKey.length > 32) {
    return derKey.slice(derKey.length - 32)
  }
  return derKey
}
