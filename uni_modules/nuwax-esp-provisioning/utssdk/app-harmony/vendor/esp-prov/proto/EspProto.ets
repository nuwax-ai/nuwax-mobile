/**
 * 精简 protobuf 编解码，覆盖 ESP network_provisioning / protocomm Security 2 用到的字段。
 * 字段号对齐 gitcode.com/Z_Heart/esp-idf-provisioning-harmony 的 protofile/espressif.proto。
 */

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0
  for (let i = 0; i < chunks.length; i++) {
    total += chunks[i].length
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (let i = 0; i < chunks.length; i++) {
    out.set(chunks[i], offset)
    offset += chunks[i].length
  }
  return out
}

function encodeVarint(value: number): Uint8Array {
  let n = value >>> 0
  const bytes: number[] = []
  while (n > 0x7F) {
    bytes.push((n & 0x7F) | 0x80)
    n = n >>> 7
  }
  bytes.push(n)
  return new Uint8Array(bytes)
}

function encodeKey(field: number, wire: number): Uint8Array {
  return encodeVarint((field << 3) | wire)
}

export function encodeBytesField(field: number, data: Uint8Array): Uint8Array {
  return concatBytes([encodeKey(field, 2), encodeVarint(data.length), data])
}

export function encodeVarintField(field: number, value: number): Uint8Array {
  return concatBytes([encodeKey(field, 0), encodeVarint(value)])
}

export function encodeBoolField(field: number, value: boolean): Uint8Array {
  return encodeVarintField(field, value ? 1 : 0)
}

export function encodeMessageField(field: number, inner: Uint8Array): Uint8Array {
  return encodeBytesField(field, inner)
}

class ProtoReader {
  private data: Uint8Array
  private offset: number = 0

  constructor(data: Uint8Array) {
    this.data = data
  }

  remaining(): boolean {
    return this.offset < this.data.length
  }

  readVarint(): number {
    let result = 0
    let shift = 0
    while (this.offset < this.data.length) {
      const b = this.data[this.offset]
      this.offset++
      result |= (b & 0x7F) << shift
      if ((b & 0x80) == 0) {
        return result >>> 0
      }
      shift += 7
      if (shift > 35) {
        throw new Error('varint too long')
      }
    }
    throw new Error('truncated varint')
  }

  readLengthBytes(): Uint8Array {
    const len = this.readVarint()
    const start = this.offset
    const end = start + len
    if (end > this.data.length) {
      throw new Error('truncated bytes')
    }
    this.offset = end
    return this.data.slice(start, end)
  }

  nextField(): [number, number] {
    const key = this.readVarint()
    return [key >>> 3, key & 7]
  }

  skip(wire: number): void {
    if (wire == 0) {
      this.readVarint()
    } else if (wire == 1) {
      this.offset += 8
    } else if (wire == 2) {
      this.readLengthBytes()
    } else if (wire == 5) {
      this.offset += 4
    } else {
      throw new Error('unknown wire ' + wire)
    }
    if (this.offset > this.data.length) {
      throw new Error('truncated fixed')
    }
  }
}

/**
 * 判断一段字节是否已是完整 protobuf 消息（全部字段恰好消费完）。
 * 供 BLE notify 分片重组：帧未收齐返回 false 继续等。
 * 非 protobuf 响应（如 proto-ver 的 JSON）恒返回 false，由调用方静默超时兜底。
 */
export function protobufFrameComplete(data: Uint8Array): boolean {
  if (data.length == 0) {
    return false
  }
  try {
    const r = new ProtoReader(data)
    while (r.remaining()) {
      const pair = r.nextField()
      if (pair[1] == 2) {
        r.readLengthBytes()
      } else {
        r.skip(pair[1])
      }
    }
    return true
  } catch (_e) {
    return false
  }
}

export class S2Cmd0 {
  username: Uint8Array = new Uint8Array(0)
  pubkey: Uint8Array = new Uint8Array(0)
}

export class S2Resp0 {
  pubkey: Uint8Array = new Uint8Array(0)
  salt: Uint8Array = new Uint8Array(0)
}

export class S2Resp1 {
  proof: Uint8Array = new Uint8Array(0)
  nonce: Uint8Array = new Uint8Array(0)
}

export function encodeSessionCmd0(username: Uint8Array, pubkey: Uint8Array): Uint8Array {
  const cmd0 = concatBytes([
    encodeBytesField(1, username),
    encodeBytesField(2, pubkey)
  ])
  const sec2 = concatBytes([
    encodeVarintField(1, 0),
    encodeMessageField(20, cmd0)
  ])
  return concatBytes([
    encodeVarintField(2, 2),
    encodeMessageField(12, sec2)
  ])
}

export function encodeSessionCmd1(proof: Uint8Array): Uint8Array {
  const cmd1 = encodeBytesField(1, proof)
  const sec2 = concatBytes([
    encodeVarintField(1, 2),
    encodeMessageField(22, cmd1)
  ])
  return concatBytes([
    encodeVarintField(2, 2),
    encodeMessageField(12, sec2)
  ])
}

function parseS2Resp0(data: Uint8Array): S2Resp0 {
  const out = new S2Resp0()
  const r = new ProtoReader(data)
  while (r.remaining()) {
    const pair = r.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 2 && wire == 2) {
      out.pubkey = r.readLengthBytes()
    } else if (field == 3 && wire == 2) {
      out.salt = r.readLengthBytes()
    } else {
      r.skip(wire)
    }
  }
  return out
}

function parseS2Resp1(data: Uint8Array): S2Resp1 {
  const out = new S2Resp1()
  const r = new ProtoReader(data)
  while (r.remaining()) {
    const pair = r.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 2 && wire == 2) {
      out.proof = r.readLengthBytes()
    } else if (field == 3 && wire == 2) {
      out.nonce = r.readLengthBytes()
    } else {
      r.skip(wire)
    }
  }
  return out
}

export function decodeSessionResp0(data: Uint8Array): S2Resp0 {
  const r = new ProtoReader(data)
  let sec2 = new Uint8Array(0)
  let secVer = -1
  while (r.remaining()) {
    const pair = r.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 2 && wire == 0) {
      secVer = r.readVarint()
    } else if (field == 12 && wire == 2) {
      sec2 = r.readLengthBytes()
    } else {
      r.skip(wire)
    }
  }
  if (secVer != 2) {
    throw new Error('sec_ver mismatch: ' + secVer)
  }
  const inner = new ProtoReader(sec2)
  while (inner.remaining()) {
    const pair = inner.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 21 && wire == 2) {
      return parseS2Resp0(inner.readLengthBytes())
    }
    inner.skip(wire)
  }
  throw new Error('missing S2SessionResp0')
}

export function decodeSessionResp1(data: Uint8Array): S2Resp1 {
  const r = new ProtoReader(data)
  let sec2 = new Uint8Array(0)
  let secVer = -1
  while (r.remaining()) {
    const pair = r.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 2 && wire == 0) {
      secVer = r.readVarint()
    } else if (field == 12 && wire == 2) {
      sec2 = r.readLengthBytes()
    } else {
      r.skip(wire)
    }
  }
  if (secVer != 2) {
    throw new Error('sec_ver mismatch: ' + secVer)
  }
  const inner = new ProtoReader(sec2)
  while (inner.remaining()) {
    const pair = inner.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 23 && wire == 2) {
      return parseS2Resp1(inner.readLengthBytes())
    }
    inner.skip(wire)
  }
  throw new Error('missing S2SessionResp1')
}

export function encodeWifiScanStart(): Uint8Array {
  const cmd = concatBytes([
    encodeBoolField(1, true),
    encodeBoolField(2, false),
    encodeVarintField(3, 0),
    encodeVarintField(4, 120)
  ])
  return concatBytes([
    encodeVarintField(1, 0),
    encodeMessageField(10, cmd)
  ])
}

export function encodeWifiScanStatus(): Uint8Array {
  return encodeVarintField(1, 2)
}

export function encodeWifiScanResult(startIndex: number, count: number): Uint8Array {
  const cmd = concatBytes([
    encodeVarintField(1, startIndex),
    encodeVarintField(2, count)
  ])
  return concatBytes([
    encodeVarintField(1, 4),
    encodeMessageField(14, cmd)
  ])
}

export class WifiScanStatus {
  scanFinished: boolean = false
  resultCount: number = 0
}

export function decodeWifiScanStatus(data: Uint8Array): WifiScanStatus {
  const out = new WifiScanStatus()
  const r = new ProtoReader(data)
  while (r.remaining()) {
    const pair = r.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 13 && wire == 2) {
      const inner = new ProtoReader(r.readLengthBytes())
      while (inner.remaining()) {
        const ip = inner.nextField()
        if (ip[0] == 1 && ip[1] == 0) {
          out.scanFinished = inner.readVarint() != 0
        } else if (ip[0] == 2 && ip[1] == 0) {
          out.resultCount = inner.readVarint()
        } else {
          inner.skip(ip[1])
        }
      }
    } else {
      r.skip(wire)
    }
  }
  return out
}

export class WifiAp {
  ssid: string = ''
  rssi: number = 0
  security: number = 0
}

function decodeInt32(v: number): number {
  return v > 0x7FFFFFFF ? v - 0x100000000 : v
}

/** 标准 UTF-8 解码（2/3/4 字节 + 代理对），SSID 等含中文时不乱码；非法序列按单字节兜底。 */
export function utf8Decode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i++
    } else if (b >= 0xC2 && b < 0xE0 && i + 1 < bytes.length) {
      out += String.fromCharCode(((b & 0x1F) << 6) | (bytes[i + 1] & 0x3F))
      i += 2
    } else if (b >= 0xE0 && b < 0xF0 && i + 2 < bytes.length) {
      out += String.fromCharCode(((b & 0x0F) << 12) | ((bytes[i + 1] & 0x3F) << 6) | (bytes[i + 2] & 0x3F))
      i += 3
    } else if (b >= 0xF0 && i + 3 < bytes.length) {
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3F) << 12) | ((bytes[i + 2] & 0x3F) << 6) | (bytes[i + 3] & 0x3F)
      out += String.fromCharCode(0xD800 + ((cp - 0x10000) >> 10), 0xDC00 + ((cp - 0x10000) & 0x3FF))
      i += 4
    } else {
      out += String.fromCharCode(b)
      i++
    }
  }
  return out
}

export function decodeWifiScanList(data: Uint8Array): WifiAp[] {
  const list: WifiAp[] = []
  const r = new ProtoReader(data)
  while (r.remaining()) {
    const pair = r.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 15 && wire == 2) {
      const inner = new ProtoReader(r.readLengthBytes())
      while (inner.remaining()) {
        const ip = inner.nextField()
        if (ip[0] == 1 && ip[1] == 2) {
          const entry = new ProtoReader(inner.readLengthBytes())
          const ap = new WifiAp()
          while (entry.remaining()) {
            const ep = entry.nextField()
            if (ep[0] == 1 && ep[1] == 2) {
              ap.ssid = utf8Decode(entry.readLengthBytes())
            } else if (ep[0] == 3 && ep[1] == 0) {
              ap.rssi = decodeInt32(entry.readVarint())
            } else if (ep[0] == 5 && ep[1] == 0) {
              ap.security = entry.readVarint()
            } else {
              entry.skip(ep[1])
            }
          }
          if (ap.ssid.length > 0) {
            list.push(ap)
          }
        } else {
          inner.skip(ip[1])
        }
      }
    } else {
      r.skip(wire)
    }
  }
  return list
}

export function encodeSetWifiConfig(ssid: string, password: string): Uint8Array {
  const ssidBytes = utf8Encode(ssid)
  const passBytes = utf8Encode(password)
  const cmd = concatBytes([
    encodeBytesField(1, ssidBytes),
    encodeBytesField(2, passBytes)
  ])
  return concatBytes([
    encodeVarintField(1, 2),
    encodeMessageField(12, cmd)
  ])
}

export function encodeApplyWifiConfig(): Uint8Array {
  return encodeVarintField(1, 4)
}

export function encodeGetWifiStatus(): Uint8Array {
  return encodeVarintField(1, 0)
}

export class WifiStatus {
  state: number = 2
  failReason: number = -1
}

export function decodeWifiStatus(data: Uint8Array): WifiStatus {
  const out = new WifiStatus()
  const r = new ProtoReader(data)
  while (r.remaining()) {
    const pair = r.nextField()
    const field = pair[0]
    const wire = pair[1]
    if (field == 11 && wire == 2) {
      const inner = new ProtoReader(r.readLengthBytes())
      while (inner.remaining()) {
        const ip = inner.nextField()
        if (ip[0] == 2 && ip[1] == 0) {
          out.state = inner.readVarint()
        } else if (ip[0] == 10 && ip[1] == 0) {
          out.failReason = inner.readVarint()
        } else {
          inner.skip(ip[1])
        }
      }
    } else {
      r.skip(wire)
    }
  }
  return out
}

/** 标准 UTF-8 编码（含 4 字节代理对），Wi-Fi SSID/密码可含中文与 emoji。 */
export function utf8Encode(s: string): Uint8Array {
  const arr: number[] = []
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i)
    if (code >= 0xD800 && code <= 0xDBFF && i + 1 < s.length) {
      const lo = s.charCodeAt(i + 1)
      if (lo >= 0xDC00 && lo <= 0xDFFF) {
        code = 0x10000 + ((code - 0xD800) << 10) + (lo - 0xDC00)
        i++
      }
    }
    if (code < 0x80) {
      arr.push(code)
    } else if (code < 0x800) {
      arr.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F))
    } else if (code < 0x10000) {
      arr.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
    } else {
      arr.push(0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F))
    }
  }
  return new Uint8Array(arr)
}
