import { util } from '@kit.ArkTS'

const HEX_CHARS:string = '0123456789abcdef'

export function bytesToHex(bytes: Uint8Array): string {
  const result: string[] = []
  for (let i = 0; i < bytes.length; i++) {
    result.push(HEX_CHARS[(bytes[i] >> 4) & 0x0F])
    result.push(HEX_CHARS[bytes[i] & 0x0F])
  }
  return result.join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const len = hex.length
  const data = new Uint8Array(len / 2)
  for (let i = 0; i < len; i += 2) {
    data[i / 2] = (parseInt(hex[i], 16) << 4) + parseInt(hex[i + 1], 16)
  }
  return data
}

export function xorBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const length = Math.min(a.length, b.length)
  const result = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    result[i] = a[i] ^ b[i]
  }
  return result
}

export function stringToBytes(str: string): Uint8Array {
  const encoder = new util.TextEncoder()
  return new Uint8Array(encoder.encodeInto(str))
}

export function bytesToString(bytes: Uint8Array): string {
  const decoder = util.TextDecoder.create('utf-8')
  return decoder.decodeToString(bytes)
}
