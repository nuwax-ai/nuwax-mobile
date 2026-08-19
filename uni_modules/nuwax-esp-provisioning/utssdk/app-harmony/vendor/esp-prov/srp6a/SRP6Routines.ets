/**
 * SRP6a 例程，改编自 esp-idf-provisioning-harmony。
 * SHA-512 改为 @kit.CryptoArchitectureKit，去掉 @ohos/crypto-js。
 */
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { bigIntegerFromBytes, bigIntegerToBytes, modPow } from './BigIntegerUtils'
import { SRP6CryptoParams } from './SRP6CryptoParams'
import { utf8Encode } from '../proto/EspProto'

function hashToBytes(_algorithm: string, ...inputs: Uint8Array[]): Uint8Array {
  const md = cryptoFramework.createMd('SHA512')
  for (let i = 0; i < inputs.length; i++) {
    md.updateSync({ data: inputs[i] })
  }
  const digest = md.digestSync()
  return new Uint8Array(digest.data)
}

function padTo(value: Uint8Array, targetLength: number): Uint8Array {
  if (value.length >= targetLength) {
    return value
  }
  const padded = new Uint8Array(targetLength)
  padded.set(value, targetLength - value.length)
  return padded
}

function computeK(params: SRP6CryptoParams): bigint {
  const nBytes = bigIntegerToBytes(params.N)
  const gBytes = bigIntegerToBytes(params.g)
  const paddedG = padTo(gBytes, nBytes.length)
  return bigIntegerFromBytes(hashToBytes(params.H, nBytes, paddedG))
}

export function computeX(params: SRP6CryptoParams, salt: Uint8Array, identity: string,
  password: string): bigint {
  const identityPasswordBytes = utf8Encode(identity + ':' + password)
  const innerHash = hashToBytes(params.H, identityPasswordBytes)
  return bigIntegerFromBytes(hashToBytes(params.H, salt, innerHash))
}

export function computeU(params: SRP6CryptoParams, A: bigint, B: bigint): bigint {
  const nLen = bigIntegerToBytes(params.N).length
  const aBytes = padTo(bigIntegerToBytes(A), nLen)
  const bBytes = padTo(bigIntegerToBytes(B), nLen)
  return bigIntegerFromBytes(hashToBytes(params.H, aBytes, bBytes))
}

export function computePublicClientValue(params: SRP6CryptoParams, a: bigint): bigint {
  return modPow(params.g, a, params.N)
}

export function computeSessionKey(params: SRP6CryptoParams, x: bigint, u: bigint, a: bigint,
  B: bigint): bigint {
  const k = computeK(params)
  const gx = modPow(params.g, x, params.N)
  const kgx = (k * gx) % params.N
  let base = B - kgx
  if (base < 0n) {
    base = base + params.N
  }
  base = ((base % params.N) + params.N) % params.N
  const exponent = (a + u * x) % (params.N - 1n)
  return modPow(base, exponent, params.N)
}

export function computeClientEvidence(params: SRP6CryptoParams, identity: string, salt: Uint8Array,
  A: bigint, B: bigint, S: bigint): bigint {
  const nBytes = bigIntegerToBytes(params.N)
  const gBytes = bigIntegerToBytes(params.g)
  const paddedG = padTo(gBytes, nBytes.length)
  const hN = hashToBytes(params.H, nBytes)
  const hg = hashToBytes(params.H, paddedG)
  const hNxorHg = new Uint8Array(hN.length)
  for (let i = 0; i < hN.length; i++) {
    hNxorHg[i] = hN[i] ^ hg[i]
  }
  const hI = hashToBytes(params.H, utf8Encode(identity))
  const nLen = nBytes.length
  const aBytes = padTo(bigIntegerToBytes(A), nLen)
  const bBytes = padTo(bigIntegerToBytes(B), nLen)
  const sessionKey = hashToBytes(params.H, padTo(bigIntegerToBytes(S), nLen))
  return bigIntegerFromBytes(hashToBytes(params.H, hNxorHg, hI, salt, aBytes, bBytes, sessionKey))
}

export function computeServerEvidence(params: SRP6CryptoParams, A: bigint, M1: bigint,
  S: bigint): bigint {
  const nLen = bigIntegerToBytes(params.N).length
  const aBytes = padTo(bigIntegerToBytes(A), nLen)
  const m1Bytes = bigIntegerToBytes(M1)
  const sessionKey = hashToBytes(params.H, padTo(bigIntegerToBytes(S), nLen))
  return bigIntegerFromBytes(hashToBytes(params.H, aBytes, m1Bytes, sessionKey))
}

export function computeHashedSessionKey(params: SRP6CryptoParams, S: bigint): Uint8Array {
  const nLen = bigIntegerToBytes(params.N).length
  return hashToBytes(params.H, padTo(bigIntegerToBytes(S), nLen))
}

export function generateRandomPrivateValue(): bigint {
  const bytes = new Uint8Array(cryptoFramework.createRandom().generateRandomSync(32).data)
  return bigIntegerFromBytes(bytes)
}
