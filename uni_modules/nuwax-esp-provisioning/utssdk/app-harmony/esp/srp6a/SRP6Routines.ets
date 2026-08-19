import { CryptoJS } from '@ohos/crypto-js'
import { cryptoFramework } from '@kit.CryptoArchitectureKit'
import { bigIntegerFromBytes, bigIntegerToBytes, modPow } from './BigIntegerUtils'
import { SRP6CryptoParams } from './SRP6CryptoParams'

function hashToBytes(algorithm: string, ...inputs: Uint8Array[]): Uint8Array {
  let wordArray = CryptoJS.lib.WordArray.create()
  for (const input of inputs) {
    const hex = Array.from(input).map(b => b.toString(16).padStart(2, '0')).join('')
    wordArray = wordArray.concat(CryptoJS.enc.Hex.parse(hex))
  }

  let hash: CryptoJS.lib.WordArray
  if (algorithm === 'SHA-512') {
    hash = CryptoJS.SHA512(wordArray)
  } else {
    hash = CryptoJS.SHA256(wordArray)
  }

  const hashHex: string = hash.toString(CryptoJS.enc.Hex)
  const bytes = new Uint8Array(hashHex.length / 2)
  for (let i = 0; i < hashHex.length; i += 2) {
    bytes[i / 2] = parseInt(hashHex.substring(i, i + 2), 16)
  }
  return bytes
}

function padTo(value: Uint8Array, targetLength: number): Uint8Array {
  if (value.length >= targetLength) {
    return value
  }
  const padded = new Uint8Array(targetLength)
  padded.set(value, targetLength - value.length)
  return padded
}

// H(N) XOR H(g)
function computeK(params: SRP6CryptoParams): bigint {
  const nBytes = bigIntegerToBytes(params.N)
  const gBytes = bigIntegerToBytes(params.g)
  const paddedG = padTo(gBytes, nBytes.length)
  const hashBytes = hashToBytes(params.H, nBytes, paddedG)
  return bigIntegerFromBytes(hashBytes)
}

// x = H(salt | H(identity | ":" | password))
export function computeX(params: SRP6CryptoParams, salt: Uint8Array, identity: string,
  password: string): bigint {
  const encoder = new TextEncoder()
  const identityPasswordBytes = encoder.encode(identity + ':' + password)
  const innerHash = hashToBytes(params.H, identityPasswordBytes)
  const xHash = hashToBytes(params.H, salt, innerHash)
  return bigIntegerFromBytes(xHash)
}

// u = H(A | B)
export function computeU(params: SRP6CryptoParams, A: bigint, B: bigint): bigint {
  const nLen = bigIntegerToBytes(params.N).length
  const aBytes = padTo(bigIntegerToBytes(A), nLen)
  const bBytes = padTo(bigIntegerToBytes(B), nLen)
  const uHash = hashToBytes(params.H, aBytes, bBytes)
  return bigIntegerFromBytes(uHash)
}

// v = g^x mod N
export function computeVerifier(params: SRP6CryptoParams, x: bigint): bigint {
  return modPow(params.g, x, params.N)
}

// A = g^a mod N
export function computePublicClientValue(params: SRP6CryptoParams, a: bigint): bigint {
  return modPow(params.g, a, params.N)
}

// k = H(N | pad(g))
export function computeSessionKey(params: SRP6CryptoParams, x: bigint, u: bigint, a: bigint,
  B: bigint): bigint {
  const k = computeK(params)
  // S = (B - k * g^x) ^ (a + u * x) mod N
  const gx = modPow(params.g, x, params.N)
  const kgx = (k * gx) % params.N
  let base = B - kgx
  if (base < 0n) {
    base = base + params.N
  }
  base = ((base % params.N) + params.N) % params.N
  const exponent = (a + u * x) % (params.N - 1n)
  const S = modPow(base, exponent, params.N)
  return S
}

// M1 = H(H(N) XOR H(g) | H(I) | s | A | B | K)
export function computeClientEvidence(params: SRP6CryptoParams, identity: string, salt: Uint8Array,
  A: bigint, B: bigint, S: bigint): bigint {
  const encoder = new TextEncoder()
  const nBytes = bigIntegerToBytes(params.N)
  const gBytes = bigIntegerToBytes(params.g)
  const paddedG = padTo(gBytes, nBytes.length)

  const hN = hashToBytes(params.H, nBytes)
  const hg = hashToBytes(params.H, paddedG)
  const hNxorHg = new Uint8Array(hN.length)
  for (let i = 0; i < hN.length; i++) {
    hNxorHg[i] = hN[i] ^ hg[i]
  }

  const hI = hashToBytes(params.H, encoder.encode(identity))

  const nLen = nBytes.length
  const aBytes = padTo(bigIntegerToBytes(A), nLen)
  const bBytes = padTo(bigIntegerToBytes(B), nLen)

  const sessionKey = hashToBytes(params.H, padTo(bigIntegerToBytes(S), nLen))

  const m1Hash = hashToBytes(params.H, hNxorHg, hI, salt, aBytes, bBytes, sessionKey)
  return bigIntegerFromBytes(m1Hash)
}

// M2 = H(A | M1 | K)
export function computeServerEvidence(params: SRP6CryptoParams, A: bigint, M1: bigint,
  S: bigint): bigint {
  const nLen = bigIntegerToBytes(params.N).length
  const aBytes = padTo(bigIntegerToBytes(A), nLen)
  const m1Bytes = bigIntegerToBytes(M1)
  const sessionKey = hashToBytes(params.H, padTo(bigIntegerToBytes(S), nLen))

  const m2Hash = hashToBytes(params.H, aBytes, m1Bytes, sessionKey)
  return bigIntegerFromBytes(m2Hash)
}

// Session key K = H(S)
export function computeHashedSessionKey(params: SRP6CryptoParams, S: bigint): Uint8Array {
  const nLen = bigIntegerToBytes(params.N).length
  return hashToBytes(params.H, padTo(bigIntegerToBytes(S), nLen))
}

// Generate random private value 'a' (256 bits)
// SECURITY FIX (nuwax): 上游用 Math.random()（可预测，会泄露 SRP 会话密钥），
// 改为 cryptoFramework CSPRNG。SRP6a 私钥 a 必须不可预测。
export function generateRandomPrivateValue(): bigint {
  const rand = cryptoFramework.createRandom()
  const blob: cryptoFramework.DataBlob = rand.generateRandomSync(32)
  return bigIntegerFromBytes(new Uint8Array(blob.data))
}

class TextEncoder {
  encode(str: string): Uint8Array {
    const arr: number[] = []
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i)
      if (code < 0x80) {
        arr.push(code)
      } else if (code < 0x800) {
        arr.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
      } else {
        arr.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
      }
    }
    return new Uint8Array(arr)
  }
}
