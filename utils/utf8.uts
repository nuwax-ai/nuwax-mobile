// UTF-8 解码工具：将 Uint8Array 转换为字符串，兼容微信小程序无 TextDecoder 场景
export function utf8ArrayToString(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  const len = bytes.length
  while (i < len) {
    const c = bytes[i++]
    if (c < 0x80) {
      out += String.fromCharCode(c)
    } else if (c < 0xE0) {
      const c2 = bytes[i++]
      out += String.fromCharCode(((c & 0x1F) << 6) | (c2 & 0x3F))
    } else if (c < 0xF0) {
      const c2 = bytes[i++]
      const c3 = bytes[i++]
      out += String.fromCharCode(((c & 0x0F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F))
    } else {
      const c2 = bytes[i++]
      const c3 = bytes[i++]
      const c4 = bytes[i++]
      let codepoint = ((c & 0x07) << 18) | ((c2 & 0x3F) << 12) | ((c3 & 0x3F) << 6) | (c4 & 0x3F)
      codepoint -= 0x10000
      out += String.fromCharCode(0xD800 + (codepoint >> 10))
      out += String.fromCharCode(0xDC00 + (codepoint & 0x3FF))
    }
  }
  return out
}


