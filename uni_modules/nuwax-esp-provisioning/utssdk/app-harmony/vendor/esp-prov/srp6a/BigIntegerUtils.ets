export function bigIntegerToBytes(value: bigint): Uint8Array {
  if (value === 0n) {
    return new Uint8Array([0])
  }

  let hex = value.toString(16)
  if (hex.length % 2 !== 0) {
    hex = '0' + hex
  }

  // Add leading zero byte if high bit set (to keep unsigned)
  if (parseInt(hex[0], 16) >= 8) {
    hex = '00' + hex
  }

  const bytes = new Uint8Array(hex.length / 2)
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16)
  }
  return bytes
}

export function bigIntegerFromBytes(bytes: Uint8Array): bigint {
  if (bytes.length === 0) {
    return 0n
  }
  let hex = ''
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0')
  }
  return BigInt('0x' + hex)
}

export function modPow(base: bigint, exponent: bigint, modulus: bigint): bigint {
  if (modulus === 1n) return 0n
  let result = 1n
  base = ((base % modulus) + modulus) % modulus
  while (exponent > 0n) {
    if (exponent % 2n === 1n) {
      result = (result * base) % modulus
    }
    exponent = exponent >> 1n
    base = (base * base) % modulus
  }
  return result
}
