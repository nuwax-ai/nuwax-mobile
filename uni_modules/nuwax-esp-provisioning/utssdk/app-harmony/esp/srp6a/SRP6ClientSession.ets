import { SRP6CryptoParams } from './SRP6CryptoParams'
import { bigIntegerFromBytes, bigIntegerToBytes } from './BigIntegerUtils'
import {
  computeX,
  computeU,
  computePublicClientValue,
  computeSessionKey,
  computeClientEvidence,
  computeServerEvidence,
  computeHashedSessionKey,
  generateRandomPrivateValue
} from './SRP6Routines'

export class SRP6ClientCredentials {
  M1: bigint
  constructor(m1: bigint) {
    this.M1 = m1
  }
}

export class SRP6ClientSession {
  private identity: string = ''
  private password: string = ''
  private a: bigint = 0n
  private x: bigint = 0n
  A: bigint = 0n
  private B: bigint = 0n
  private S: bigint = 0n
  private M1: bigint = 0n
  private M2Expected: bigint = 0n
  K: bigint = 0n

  step1(identity: string, password: string): void {
    this.identity = identity
    this.password = password
  }

  getClientPublicKey(params: SRP6CryptoParams): bigint {
    this.a = generateRandomPrivateValue()
    this.A = computePublicClientValue(params, this.a)

    if (this.A % params.N === 0n) {
      throw new Error('Bad client credentials: A mod N == 0')
    }

    return this.A
  }

  step2ForClientEvidence(params: SRP6CryptoParams, salt: bigint, B: bigint,
    saltBytes: Uint8Array): SRP6ClientCredentials {
    this.B = B

    if (this.B % params.N === 0n) {
      throw new Error('Bad server credentials: B mod N == 0')
    }

    const u = computeU(params, this.A, this.B)
    if (u === 0n) {
      throw new Error('Bad shared value: u == 0')
    }

    this.x = computeX(params, saltBytes, this.identity, this.password)
    this.S = computeSessionKey(params, this.x, u, this.a, this.B)

    const hashedKey = computeHashedSessionKey(params, this.S)
    this.K = bigIntegerFromBytes(hashedKey)

    this.M1 = computeClientEvidence(params, this.identity, saltBytes, this.A, this.B, this.S)
    this.M2Expected = computeServerEvidence(params, this.A, this.M1, this.S)

    return new SRP6ClientCredentials(this.M1)
  }

  step3(deviceProof: bigint): void {
    if (deviceProof !== this.M2Expected) {
      throw new Error('Server evidence mismatch! Possible MITM attack.')
    }
  }
}
