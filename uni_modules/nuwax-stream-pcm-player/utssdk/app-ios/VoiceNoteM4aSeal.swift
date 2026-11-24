//
//  进程被杀掉时 AVAudioRecorder 来不及 stop()，m4a 里只有 ftyp 和 mdat，没有 moov。
//  录音参数是固定的：AAC-LC、16000 Hz、单声道、64 kbps。按这个参数把 mdat 里的 AAC 帧拆开，
//  再写成一份带 moov 的 m4a，替换原文件。原文件在新文件确认能打开之前不会被删掉。
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

    public static func sealFile(_ path: String) -> String {
        if path.isEmpty {
            return "0"
        }
        var result = "0"
        queue.sync {
            result = sealFileNow(path)
        }
        return result
    }

    private static func sealFileNow(_ path: String) -> String {
        guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)), data.count >= 16 else {
            NSLog("[voice-note] m4a seal unreadable \(path)")
            return "0"
        }
        if topLevelHasMoov(data) {
            return "1"
        }
        guard let payload = mdatPayload(data), payload.count >= minFrameBytes else {
            NSLog("[voice-note] m4a seal no mdat \(path)")
            return "0"
        }
        guard let ranges = frameRanges(payload) else {
            NSLog("[voice-note] m4a seal frames failed bytes=\(payload.count)")
            return "0"
        }
        let tmp = path + ".sealed"
        let tmpURL = URL(fileURLWithPath: tmp)
        try? FileManager.default.removeItem(at: tmpURL)
        guard writeM4a(payload: payload, ranges: ranges, to: tmpURL) else {
            try? FileManager.default.removeItem(at: tmpURL)
            NSLog("[voice-note] m4a seal write failed \(path)")
            return "0"
        }
        guard let sealed = try? Data(contentsOf: tmpURL), topLevelHasMoov(sealed), packetCount(tmpURL) == ranges.count else {
            try? FileManager.default.removeItem(at: tmpURL)
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
            NSLog("[voice-note] m4a seal replace failed \(error.localizedDescription)")
            return "0"
        }
        NSLog("[voice-note] m4a sealed frames=\(ranges.count) \(path)")
        return "1"
    }

    private static func frameRanges(_ payload: Data) -> [Range<Int>]? {
        for size in preferredPacketBytes {
            if let ranges = fixedRanges(payload, packetBytes: size) {
                return ranges
            }
        }
        return searchedRanges(payload)
    }

    /// 整段都能按固定长度解码时，直接采用这个长度。杀进程留下的半帧丢掉。
    private static func fixedRanges(_ payload: Data, packetBytes: Int) -> [Range<Int>]? {
        if packetBytes < minFrameBytes || payload.count < packetBytes {
            return nil
        }
        let count = payload.count / packetBytes
        let tail = payload.count - count * packetBytes
        if count < 1 || tail >= packetBytes {
            return nil
        }
        guard let decoder = AacDecoder() else {
            return nil
        }
        for index in 0..<count {
            let start = index * packetBytes
            if !decoder.decode(payload, start: start, length: packetBytes, reset: false) {
                return nil
            }
        }
        var ranges: [Range<Int>] = []
        ranges.reserveCapacity(count)
        for index in 0..<count {
            let start = index * packetBytes
            ranges.append(start..<(start + packetBytes))
        }
        return ranges
    }

    /// 固定长度对不上时，用解码器逐帧找出边界。只允许末尾留一个不完整帧。
    private static func searchedRanges(_ payload: Data) -> [Range<Int>]? {
        guard let decoder = AacDecoder() else {
            return nil
        }
        var ranges: [Range<Int>] = []
        var offset = 0
        while offset + minFrameBytes <= payload.count {
            guard let length = frameLength(payload, offset: offset, decoder: decoder) else {
                break
            }
            if !decoder.decode(payload, start: offset, length: length, reset: false) {
                return nil
            }
            ranges.append(offset..<(offset + length))
            offset += length
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
    private static func frameLength(_ payload: Data, offset: Int, decoder: AacDecoder) -> Int? {
        let remain = payload.count - offset
        if remain < minFrameBytes {
            return nil
        }
        var low = minFrameBytes
        var high = min(maxFrameBytes, remain)
        var found = 0
        while low <= high {
            let mid = (low + high) / 2
            if decoder.decode(payload, start: offset, length: mid, reset: true) {
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

    /// mdat 的 size 在 stop() 之前经常是 0，表示一直写到文件末尾。
    private static func mdatPayload(_ data: Data) -> Data? {
        var pos = 0
        var steps = 0
        var payload = Data()
        while pos + 8 <= data.count && steps < 64 {
            steps += 1
            let isMdat = data[pos + 4] == 0x6d && data[pos + 5] == 0x64 && data[pos + 6] == 0x61 && data[pos + 7] == 0x74
            let size32 = readU32(data, pos)
            if size32 == 0 {
                if isMdat && pos + 8 < data.count {
                    payload.append(data.subdata(in: (pos + 8)..<data.count))
                }
                break
            }
            guard let boxSize = boxByteSize(data, pos) else {
                return payload.isEmpty ? nil : payload
            }
            let end = min(pos + boxSize, data.count)
            if isMdat && pos + 8 < end {
                payload.append(data.subdata(in: (pos + 8)..<end))
            }
            if boxSize < 8 {
                return payload.isEmpty ? nil : payload
            }
            if pos + boxSize > data.count {
                break
            }
            pos += boxSize
        }
        if payload.isEmpty {
            return nil
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
    private var converter: AudioConverterRef?
    private let feed = SealFeed()
    private let output = UnsafeMutablePointer<Int16>.allocate(capacity: 4096)

    init?() {
        var source = VoiceNoteM4aSealFormat.aac
        var dest = VoiceNoteM4aSealFormat.pcm
        var created: AudioConverterRef?
        let status = AudioConverterNew(&source, &dest, &created)
        guard status == noErr, let created = created else {
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
            AudioConverterDispose(created)
            output.deallocate()
            return nil
        }
        converter = created
    }

    deinit {
        if let converter = converter {
            AudioConverterDispose(converter)
        }
        output.deallocate()
    }

    func decode(_ payload: Data, start: Int, length: Int, reset: Bool) -> Bool {
        guard let converter = converter else {
            return false
        }
        if reset {
            AudioConverterReset(converter)
        }
        let end = start + length
        if start < 0 || length < 2 || end > payload.count {
            return false
        }
        return payload.withUnsafeBytes { raw in
            guard let base = raw.baseAddress else {
                return false
            }
            feed.bytes = base.advanced(by: start)
            feed.size = UInt32(length)
            feed.fed = false
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
            return status == noErr && packets >= 1024
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
