/**
 * nuwax 修复（相对上游 esp-idf-provisioning-harmony）：
 * bigIntegerToBytes 原实现沿用 Java BigInteger.toByteArray() 语义——顶字节 ≥ 0x80 时
 * 插入一个伪造的 0x00 前导字节「保持无符号」。这与固件（esp_srp.c / mbedtls
 * esp_mpi_to_bin）的字节宽语义系统性不兼容：
 *  - N 恒以 0xFF 开头 → computeK 哈希 385 字节的 N → k 恒错 → S/K/M1 全错；
 *  - A（≈N 量级，顶字节 ≥ 0x80 概率极高）→ 固件 calculate_padded_hash 按收到的
 *    385 字节原样哈希 → u 与客户端不一致；
 *  - M1（顶字节 ≥ 0x80 概率 1/2）→ 65 字节被固件长度校验拒绝。
 * 固件侧所有 SRP 字段都是「自然字节宽」（最小十六进制表示，无无符号前导零），
 * 定宽补齐由调用方 padLeftTo 负责（Security2.ets：A→384、M1→64）。
 */
export function bigIntegerToBytes(value: bigint): Uint8Array {
  if (value === 0n) {
    return new Uint8Array(1)
  }

  let hex = value.toString(16)
  if (hex.length % 2 !== 0) {
    hex = '0' + hex
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
