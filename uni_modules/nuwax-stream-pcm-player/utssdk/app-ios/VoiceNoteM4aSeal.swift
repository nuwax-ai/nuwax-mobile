//
//  进程被杀掉时 AVAudioRecorder 来不及 stop()，m4a 里只有 ftyp 和 mdat，没有 moov。
//  录音参数是固定的：AAC-LC、16000 Hz、单声道、64 kbps。每帧字节数不固定。
//  先用解码器确认一种固定长度，对不上就逐帧找出真实边界，再按这个长度写入。
//  解不开就不改原文件。原文件在新文件确认能打开之前不会被删掉。
//
import AudioToolbox
import Foundation

public enum VoiceNoteM4aSeal {
    private static let sampleRate: Double = 16000
    private static let channels: UInt32 = 1
    private static let framesPerPacket: UInt32 = 1024
    /// AAC-LC 单声道一帧最多约 768 字节，留出余量。
    private static let maxFrameBytes = 1536
    private static let minFrameBytes = 2
    /// 开录时优先写入的码率。64000 * 1024 / 16000 / 8 = 512。
    private static let preferredPacketBytes = [512, 1024, 256, 384, 640, 768, 320, 192]
    private static let cookie: [UInt8] = [0x14, 0x08]
    private static let queue = DispatchQueue(label: "voice-note.m4a-seal")
    /// 最近一次没封上的原因。成功时为空。页面日志会带上它。
    private static var lastDetail = ""

    /// 单独识别只有容器头的录音。无法完整解析的布局仍走保留和修复流程。
    static func hasNoMedia(_ path: String) -> Bool {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path), options: .mappedIfSafe),
              data.count >= 16, readU32(data, 4) == 0x66747970 else { return false } // ftyp
        var offset = 0
        while offset + 8 <= data.count {
            let type = readU32(data, offset + 4)
            let size32 = readU32(data, offset)
            let header = size32 == 1 ? 16 : 8
            guard let size = boxByteSize(data, offset), size >= header, size <= data.count - offset else { return false }
            switch type {
            case 0x6d646174: // mdat
                if size > header { return false }
            case 0x66747970, 0x6d6f6f76, 0x66726565, 0x736b6970, 0x77696465: // ftyp, moov, free, skip, wide
                if size32 == 0 { return false }
            default:
                return false
            }
            offset += size
        }
        return offset == data.count
    }

    public static func sealFile(_ path: String) -> String {
        if path.isEmpty {
            return "0:path"
        }
        var result = "0:unknown"
        queue.sync {
            lastDetail = ""
            result = sealFileNow(path)
        }
        if result == "1" {
            return "1"
        }
        if lastDetail.isEmpty {
            return "0"
        }
        return "0:" + lastDetail
    }

    private static func sealFileNow(_ path: String) -> String {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)), data.count >= 16 else {
            lastDetail = "unreadable"
            NSLog("[voice-note] m4a seal unreadable \(path)")
            return "0"
        }
        if topLevelHasMoov(data) || edgeHasMoov(data) {
            return "1"
        }
        guard let payload = mdatPayload(data) else {
            lastDetail = "layout"
            NSLog("[voice-note] m4a seal layout \(path)")
            return "0"
        }
        guard payload.count >= minFrameBytes else {
            lastDetail = "nomdat"
            NSLog("[voice-note] m4a seal no mdat \(path)")
            return "0"
        }
        guard let ranges = frameRanges(payload) else {
            lastDetail = lastDetail.isEmpty ? "frames" : lastDetail
            NSLog("[voice-note] m4a seal frames failed bytes=\(payload.count) \(lastDetail)")
            return "0"
        }
        let tmp = path + ".sealed"
        let tmpURL = URL(fileURLWithPath: tmp)
        try? FileManager.default.removeItem(at: tmpURL)
        guard writeM4a(payload: payload, ranges: ranges, to: tmpURL) else {
            try? FileManager.default.removeItem(at: tmpURL)
            if lastDetail.isEmpty {
                lastDetail = "write"
            }
            NSLog("[voice-note] m4a seal write failed \(path)")
            return "0"
        }
        guard let sealed = try? Data(contentsOf: tmpURL), topLevelHasMoov(sealed), packetCount(tmpURL) == ranges.count else {
            try? FileManager.default.removeItem(at: tmpURL)
            lastDetail = "verify"
            NSLog("[voice-note] m4a seal verify failed \(path)")
            return "0"
        }
        let backup = path + ".unsealed"
        let backupURL = URL(fileURLWithPath: backup)
        try? FileManager.default.removeItem(at: backupURL)
        do {
            try FileManager.default.moveItem(atPath: path, toPath: backup)
            try FileManager.default.moveItem(atPath: tmp, toPath: path)
            try? FileManager.default.removeItem(at: backupURL)
        } catch {
            if !FileManager.default.fileExists(atPath: path), FileManager.default.fileExists(atPath: backup) {
                try? FileManager.default.moveItem(atPath: backup, toPath: path)
            }
            try? FileManager.default.removeItem(at: tmpURL)
            lastDetail = "replace"
            NSLog("[voice-note] m4a seal replace failed \(error.localizedDescription)")
            return "0"
        }
        NSLog("[voice-note] m4a sealed frames=\(ranges.count) \(path)")
        return "1"
    }

    private static func frameRanges(_ payload: Data) -> [Range<Int>]? {
        guard let decoder = AacDecoder() else {
            lastDetail = AacDecoder.lastError.isEmpty ? "decoder" : AacDecoder.lastError
            return nil
        }
        for size in preferredPacketBytes {
            if let ranges = fixedRanges(payload, packetBytes: size, decoder: decoder) {
                return ranges
            }
        }
        return searchedRanges(payload, decoder: decoder)
    }

    /// 按固定长度切帧。杀进程留下的半帧丢掉。
    private static func uniformRanges(_ payload: Data, packetBytes: Int) -> [Range<Int>]? {
        if packetBytes < minFrameBytes || payload.count < packetBytes {
            return nil
        }
        let count = payload.count / packetBytes
        if count < 1 {
            lastDetail = "short"
            return nil
        }
        var ranges: [Range<Int>] = []
        ranges.reserveCapacity(count)
        for index in 0..<count {
            let start = index * packetBytes
            ranges.append(start..<(start + packetBytes))
        }
        return ranges
    }

    /// 抽查开头、中间、结尾。有一帧能解开就采用这个长度；第一帧可能只是编码器延迟。
    private static func fixedRanges(_ payload: Data, packetBytes: Int, decoder: AacDecoder) -> [Range<Int>]? {
        guard let ranges = uniformRanges(payload, packetBytes: packetBytes) else {
            return nil
        }
        let count = ranges.count
        var indexes = [0]
        if count > 2 {
            indexes.append(count / 2)
        }
        if count > 1 {
            indexes.append(count - 1)
        }
        var decoded = 0
        for index in indexes {
            let samples = decoder.decode(payload, start: ranges[index].lowerBound, length: packetBytes, reset: true)
            if samples < 0 {
                return nil
            }
            if samples >= 1024 {
                decoded += 1
            } else if index != 0 {
                return nil
            }
        }
        if decoded == 0 {
            return nil
        }
        return ranges
    }

    /// 固定长度对不上时，用解码器逐帧找出边界。只允许末尾留一个不完整帧。
    private static func searchedRanges(_ payload: Data, decoder: AacDecoder) -> [Range<Int>]? {
        var ranges: [Range<Int>] = []
        var offset = 0
        var hint = 512
        while offset + minFrameBytes <= payload.count {
            guard let length = frameLength(payload, offset: offset, decoder: decoder, hint: hint) else {
                break
            }
            if decoder.decode(payload, start: offset, length: length, reset: false) < 1024 {
                return nil
            }
            ranges.append(offset..<(offset + length))
            offset += length
            hint = length
            if ranges.count > 200000 {
                return nil
            }
        }
        if ranges.isEmpty || payload.count - offset > maxFrameBytes {
            return nil
        }
        return ranges
    }

    /// 截断的帧解不开，长度够了才能解开。取能解开的最短长度。
    private static func frameLength(_ payload: Data, offset: Int, decoder: AacDecoder, hint: Int) -> Int? {
        let remain = payload.count - offset
        if remain < minFrameBytes {
            return nil
        }
        let cap = min(maxFrameBytes, remain)
        let guess = min(max(hint, minFrameBytes), cap)
        if decoder.decode(payload, start: offset, length: guess, reset: true) >= 1024 {
            if guess == minFrameBytes || decoder.decode(payload, start: offset, length: guess - 1, reset: true) < 1024 {
                return guess
            }
        }
        var low = minFrameBytes
        var high = cap
        var found = 0
        while low <= high {
            let mid = (low + high) / 2
            if decoder.decode(payload, start: offset, length: mid, reset: true) >= 1024 {
                found = mid
                high = mid - 1
            } else {
                low = mid + 1
            }
        }
        if found >= minFrameBytes {
            return found
        }
        return nil
    }

    private static func writeM4a(payload: Data, ranges: [Range<Int>], to url: URL) -> Bool {
        var input = aacFormat()
        var file: AudioFileID?
        let created = AudioFileCreateWithURL(url as CFURL, kAudioFileM4AType, &input, .eraseFile, &file)
        guard created == noErr, let file = file else {
            lastDetail = "create=\(created)"
            NSLog("[voice-note] m4a seal create status=\(created)")
            return false
        }
        defer {
            AudioFileClose(file)
        }
        var cookie = cookie
        let cookieStatus = AudioFileSetProperty(
            file,
            kAudioFilePropertyMagicCookieData,
            UInt32(cookie.count),
            &cookie
        )
        if cookieStatus != noErr {
            lastDetail = "cookie=\(cookieStatus)"
            NSLog("[voice-note] m4a seal cookie status=\(cookieStatus)")
            return false
        }
        var index: Int64 = 0
        for range in ranges {
            let slice = payload.subdata(in: range)
            var desc = AudioStreamPacketDescription(
                mStartOffset: 0,
                mVariableFramesInPacket: 0,
                mDataByteSize: UInt32(slice.count)
            )
            var packets: UInt32 = 1
            let status = slice.withUnsafeBytes { raw -> OSStatus in
                guard let base = raw.baseAddress else {
                    return kAudioFileUnspecifiedError
                }
                return AudioFileWritePackets(file, false, UInt32(slice.count), &desc, index, &packets, base)
            }
            if status != noErr || packets != 1 {
                lastDetail = "packet=\(status)"
                NSLog("[voice-note] m4a seal packet status=\(status)")
                return false
            }
            index += 1
        }
        return index > 0
    }

    private static func packetCount(_ url: URL) -> Int {
        var file: AudioFileID?
        let opened = AudioFileOpenURL(url as CFURL, .readPermission, kAudioFileM4AType, &file)
        guard opened == noErr, let file = file else {
            return 0
        }
        defer {
            AudioFileClose(file)
        }
        var count: UInt64 = 0
        var size = UInt32(MemoryLayout<UInt64>.size)
        let status = AudioFileGetProperty(file, kAudioFilePropertyAudioDataPacketCount, &size, &count)
        if status != noErr {
            return 0
        }
        return Int(count)
    }

    private static func aacFormat() -> AudioStreamBasicDescription {
        return AudioStreamBasicDescription(
            mSampleRate: sampleRate,
            mFormatID: kAudioFormatMPEG4AAC,
            mFormatFlags: 0,
            mBytesPerPacket: 0,
            mFramesPerPacket: framesPerPacket,
            mBytesPerFrame: 0,
            mChannelsPerFrame: channels,
            mBitsPerChannel: 0,
            mReserved: 0
        )
    }

    private static func topLevelHasMoov(_ data: Data) -> Bool {
        var pos = 0
        var steps = 0
        while pos + 8 <= data.count && steps < 64 {
            steps += 1
            if data[pos + 4] == 0x6d && data[pos + 5] == 0x6f && data[pos + 6] == 0x6f && data[pos + 7] == 0x76 {
                return true
            }
            guard let boxSize = boxByteSize(data, pos) else {
                return false
            }
            if boxSize < 8 || pos + boxSize > data.count {
                return false
            }
            pos += boxSize
        }
        return false
    }

    /// 文件头尾有没有 moov。mdat 的长度写过头时，线性扫描到不了末尾的 moov，不能因此当成没封口。
    private static func edgeHasMoov(_ data: Data) -> Bool {
        if scanMoov(data, from: 0, limit: 65536) {
            return true
        }
        let tail = data.count > 4 * 1024 * 1024 ? data.count - 4 * 1024 * 1024 : 0
        return scanMoov(data, from: tail, limit: data.count - tail)
    }

    private static func scanMoov(_ data: Data, from: Int, limit: Int) -> Bool {
        var pos = from
        if pos < 0 {
            pos = 0
        }
        let end = min(data.count, pos + limit)
        while pos + 20 <= end {
            if data[pos + 4] == 0x6d && data[pos + 5] == 0x6f && data[pos + 6] == 0x6f && data[pos + 7] == 0x76 {
                let size = readU32(data, pos)
                let header = size == 1 ? 16 : 8
                let typeAt = pos + header + 4
                if typeAt + 4 <= data.count &&
                    data[typeAt] == 0x6d && data[typeAt + 1] == 0x76 &&
                    data[typeAt + 2] == 0x68 && data[typeAt + 3] == 0x64 {
                    return true
                }
            }
            pos += 4
        }
        return false
    }

    /// 走完盒子仍没有 mdat 时返回空数据，调用方记 nomdat。
    /// 尺寸读断、还没走到 mdat 时返回 nil，调用方记 layout，不能当成没有音频。
    /// mdat 的 size 在 stop() 之前经常是 0 或比文件大，音频算到文件末尾。
    private static func mdatPayload(_ data: Data) -> Data? {
        var pos = 0
        var steps = 0
        var payload = Data()
        var broke = false
        while pos + 8 <= data.count && steps < 64 {
            steps += 1
            let isMdat = data[pos + 4] == 0x6d && data[pos + 5] == 0x64 && data[pos + 6] == 0x61 && data[pos + 7] == 0x74
            let size32 = readU32(data, pos)
            if size32 == 0 || size32 == 0xffffffff {
                if isMdat && pos + 8 < data.count {
                    payload.append(data.subdata(in: (pos + 8)..<data.count))
                } else if !isMdat {
                    broke = true
                }
                break
            }
            guard let boxSize = boxByteSize(data, pos) else {
                if isMdat && pos + 8 < data.count {
                    payload.append(data.subdata(in: (pos + 8)..<data.count))
                } else {
                    broke = true
                }
                break
            }
            let end = min(pos + boxSize, data.count)
            if isMdat && pos + 8 < end {
                payload.append(data.subdata(in: (pos + 8)..<end))
                break
            }
            if boxSize < 8 || pos + boxSize > data.count {
                broke = true
                break
            }
            pos += boxSize
        }
        if payload.isEmpty {
            return broke ? nil : Data()
        }
        return payload
    }

    private static func boxByteSize(_ data: Data, _ pos: Int) -> Int? {
        let size32 = readU32(data, pos)
        if size32 == 0 {
            return data.count - pos
        }
        if size32 == 1 {
            if pos + 16 > data.count {
                return nil
            }
            let high = readU32(data, pos + 8)
            let low = readU32(data, pos + 12)
            if high != 0 {
                return nil
            }
            return Int(low)
        }
        return Int(size32)
    }

    private static func readU32(_ data: Data, _ offset: Int) -> UInt64 {
        return (UInt64(data[offset]) << 24)
            | (UInt64(data[offset + 1]) << 16)
            | (UInt64(data[offset + 2]) << 8)
            | UInt64(data[offset + 3])
    }
}

private final class AacDecoder {
    static var lastError = ""
    private var converter: AudioConverterRef?
    private let feed = SealFeed()
    private let output = UnsafeMutablePointer<Int16>.allocate(capacity: 4096)

    init?() {
        var source = VoiceNoteM4aSealFormat.aac
        var dest = VoiceNoteM4aSealFormat.pcm
        var created: AudioConverterRef?
        let status = AudioConverterNew(&source, &dest, &created)
        guard status == noErr, let created = created else {
            AacDecoder.lastError = "decoder=\(status)"
            output.deallocate()
            return nil
        }
        var cookie: [UInt8] = [0x14, 0x08]
        let cookieStatus = AudioConverterSetProperty(
            created,
            kAudioConverterDecompressionMagicCookie,
            UInt32(cookie.count),
            &cookie
        )
        if cookieStatus != noErr {
            // 没有 cookie 也继续试。封口不能因为这一项直接放弃整段录音。
            AacDecoder.lastError = "cookie=\(cookieStatus)"
            NSLog("[voice-note] m4a seal cookie status=\(cookieStatus)")
        } else {
            AacDecoder.lastError = ""
        }
        converter = created
    }

    deinit {
        if let converter = converter {
            AudioConverterDispose(converter)
        }
        output.deallocate()
    }

    /// 喂一帧并把它吐完。返回 PCM 采样数；输入本身无效返回 -1。0 表示解码器接受了这一帧但还没吐出采样。
    func decode(_ payload: Data, start: Int, length: Int, reset: Bool) -> Int {
        guard let converter = converter else {
            return -1
        }
        if reset {
            AudioConverterReset(converter)
        }
        let end = start + length
        if start < 0 || length < 2 || end > payload.count {
            return -1
        }
        return payload.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else {
                return -1
            }
            feed.bytes = base.advanced(by: start)
            feed.size = UInt32(length)
            feed.fed = false
            var total = 0
            for _ in 0..<4 {
                var list = AudioBufferList(
                    mNumberBuffers: 1,
                    mBuffers: AudioBuffer(
                        mNumberChannels: 1,
                        mDataByteSize: UInt32(4096 * MemoryLayout<Int16>.size),
                        mData: output
                    )
                )
                var packets: UInt32 = 4096
                let status = AudioConverterFillComplexBuffer(
                    converter,
                    sealInputProc,
                    Unmanaged.passUnretained(feed).toOpaque(),
                    &packets,
                    &list,
                    nil
                )
                if status != noErr {
                    return total >= 1024 ? total : -1
                }
                total += Int(packets)
                if total >= 1024 || packets == 0 {
                    break
                }
            }
            return total
        }
    }
}

private final class SealFeed {
    var bytes: UnsafeRawPointer?
    var size: UInt32 = 0
    var fed = false
    let desc = UnsafeMutablePointer<AudioStreamPacketDescription>.allocate(capacity: 1)

    init() {
        desc.initialize(to: AudioStreamPacketDescription(mStartOffset: 0, mVariableFramesInPacket: 0, mDataByteSize: 0))
    }

    deinit {
        desc.deinitialize(count: 1)
        desc.deallocate()
    }
}

private let sealInputProc: AudioConverterComplexInputDataProc = { _, ioNumberDataPackets, ioData, outDataPacketDescription, inUserData in
    guard let inUserData = inUserData else {
        return kAudioConverterErr_UnspecifiedError
    }
    let feed = Unmanaged<SealFeed>.fromOpaque(inUserData).takeUnretainedValue()
    if feed.fed || feed.bytes == nil {
        ioNumberDataPackets.pointee = 0
        return noErr
    }
    feed.fed = true
    ioNumberDataPackets.pointee = 1
    guard let bytes = feed.bytes else {
        ioNumberDataPackets.pointee = 0
        return noErr
    }
    ioData.pointee.mNumberBuffers = 1
    ioData.pointee.mBuffers.mNumberChannels = 1
    ioData.pointee.mBuffers.mDataByteSize = feed.size
    ioData.pointee.mBuffers.mData = UnsafeMutableRawPointer(mutating: bytes)
    feed.desc.pointee.mStartOffset = 0
    feed.desc.pointee.mVariableFramesInPacket = 0
    feed.desc.pointee.mDataByteSize = feed.size
    if let outDataPacketDescription = outDataPacketDescription {
        outDataPacketDescription.pointee = feed.desc
    }
    return noErr
}

/// 解码器要单独拿格式描述，避免和写文件的可变副本缠在一起。
private enum VoiceNoteM4aSealFormat {
    static var aac: AudioStreamBasicDescription {
        return AudioStreamBasicDescription(
            mSampleRate: 16000,
            mFormatID: kAudioFormatMPEG4AAC,
            mFormatFlags: 0,
            mBytesPerPacket: 0,
            mFramesPerPacket: 1024,
            mBytesPerFrame: 0,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 0,
            mReserved: 0
        )
    }

    static var pcm: AudioStreamBasicDescription {
        return AudioStreamBasicDescription(
            mSampleRate: 16000,
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kLinearPCMFormatFlagIsSignedInteger | kLinearPCMFormatFlagIsPacked,
            mBytesPerPacket: 2,
            mFramesPerPacket: 1,
            mBytesPerFrame: 2,
            mChannelsPerFrame: 1,
            mBitsPerChannel: 16,
            mReserved: 0
        )
    }
}
