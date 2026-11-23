//
//  伙伴页录音。一次会话只用一个 AVAudioEngine，分段只换 AVAssetWriter 写出的 m4a。
//  不使用 AVAudioRecorder，也不走聊天页的 StreamPcmRecorder。
//  segmentKey 格式：localId|index。单字符串跨桥，避免多参数转换失败。
//
import AVFoundation
import CoreMedia
import Foundation

public class VoiceNoteM4aBridge {
    private let queue = DispatchQueue(label: "voice-note-m4a")
    private var engine: AVAudioEngine?
    private var converter: AVAudioConverter?
    private var sourceFormat: AVAudioFormat?
    private var writer: AVAssetWriter?
    private var writerInput: AVAssetWriterInput?
    private var paused = false
    private var running = false
    private var segmentFrames: Int64 = 0
    private var lastClosedDurationMs: Int = 0
    private var currentPath = ""
    private let targetFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 16000, channels: 1, interleaved: true)
    private var interruptObserver: NSObjectProtocol?
    private var interruptHold = false
    private var pendingEvent = ""
    private var ignoreBeganUntil = Date()

    public init() {
        let center = NotificationCenter.default
        interruptObserver = center.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] notification in
            self?.handleInterruption(notification)
        }
    }

    deinit {
        if let observer = interruptObserver {
            NotificationCenter.default.removeObserver(observer)
        }
    }

    public func startSegment(_ segmentKey: String) -> String {
        guard let targetFormat = targetFormat else {
            return ""
        }
        guard let path = preparePath(segmentKey) else {
            return ""
        }
        if !ensureEngine() {
            return ""
        }
        var opened = ""
        queue.sync {
            self.paused = false
            self.running = true
            self.interruptHold = false
            self.ignoreBeganUntil = Date().addingTimeInterval(1.5)
            if self.openWriter(path, format: targetFormat) {
                opened = path
            }
        }
        return opened
    }

    /// 封上当前 m4a，立刻打开下一段。AVAudioEngine 不停、不释放。
    public func rotateSegment(_ segmentKey: String) -> String {
        guard let targetFormat = targetFormat else {
            return ""
        }
        guard engine != nil, let path = preparePath(segmentKey) else {
            return ""
        }
        var opened = ""
        queue.sync {
            self.closeWriter()
            if self.openWriter(path, format: targetFormat) {
                opened = path
            }
        }
        return opened
    }

    public func pauseSegment() -> String {
        var ok = "0"
        queue.sync {
            if self.engine == nil {
                return
            }
            self.paused = true
            ok = "1"
        }
        return ok
    }

    public func resumeSegment() -> String {
        var ok = "0"
        var shouldStart = false
        queue.sync {
            if self.engine == nil || self.writerInput == nil {
                return
            }
            self.paused = false
            self.running = true
            self.interruptHold = false
            shouldStart = self.engine?.isRunning != true
            ok = "1"
        }
        if shouldStart {
            try? engine?.start()
        }
        return ok
    }

    public func stopSegment() -> String {
        queue.sync {
            self.running = false
            self.paused = false
            self.interruptHold = false
            self.pendingEvent = ""
            self.closeWriter()
        }
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        converter = nil
        sourceFormat = nil
        return "1"
    }

    public func takeClosedDurationMs() -> String {
        var duration = "0"
        queue.sync {
            duration = String(self.lastClosedDurationMs)
            self.lastClosedDurationMs = 0
        }
        return duration
    }

    /// 来电、微信语音、飞书语音等抢走音频会话。返回一次 "began" 或 "ended"，读完即清。
    public func takeInterruption() -> String {
        var event = ""
        queue.sync {
            event = self.pendingEvent
            self.pendingEvent = ""
        }
        return event
    }

    private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else {
            return
        }
        if type == .began {
            if Date() < ignoreBeganUntil {
                return
            }
            queue.sync {
                if !self.running || self.paused {
                    return
                }
                self.paused = true
                self.interruptHold = true
                self.pendingEvent = "began"
            }
            return
        }
        queue.sync {
            if !self.interruptHold {
                return
            }
            self.pendingEvent = "ended"
        }
    }

    private func ensureEngine() -> Bool {
        if engine != nil {
            return true
        }
        let session = AVAudioSession.sharedInstance()
        if !(session.category == .playAndRecord && session.isInputAvailable) {
            do {
                try session.setCategory(
                    .playAndRecord,
                    mode: .default,
                    options: [.defaultToSpeaker, .mixWithOthers]
                )
                try session.setActive(true)
            } catch {
                NSLog("[voice-note] m4a session failed \(error.localizedDescription)")
                return false
            }
        }
        let created = AVAudioEngine()
        let input = created.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
            self?.enqueue(buffer)
        }
        do {
            try created.start()
        } catch {
            NSLog("[voice-note] m4a engine failed \(error.localizedDescription)")
            input.removeTap(onBus: 0)
            return false
        }
        engine = created
        return true
    }

    private func enqueue(_ buffer: AVAudioPCMBuffer) {
        guard let copy = AVAudioPCMBuffer(pcmFormat: buffer.format, frameCapacity: buffer.frameLength) else {
            return
        }
        copy.frameLength = buffer.frameLength
        let frames = Int(buffer.frameLength)
        let channels = Int(buffer.format.channelCount)
        if let src = buffer.floatChannelData, let dst = copy.floatChannelData {
            for channel in 0..<channels {
                dst[channel].update(from: src[channel], count: frames)
            }
        } else if let src = buffer.int16ChannelData, let dst = copy.int16ChannelData {
            for channel in 0..<channels {
                dst[channel].update(from: src[channel], count: frames)
            }
        } else {
            return
        }
        queue.async { [weak self] in
            self?.consume(copy)
        }
    }

    private func consume(_ buffer: AVAudioPCMBuffer) {
        if !running || paused || writerInput == nil {
            return
        }
        guard let targetFormat = targetFormat else {
            return
        }
        if converter == nil || sourceFormat?.sampleRate != buffer.format.sampleRate {
            sourceFormat = buffer.format
            converter = AVAudioConverter(from: buffer.format, to: targetFormat)
        }
        guard let converter = converter else {
            return
        }
        let ratio = targetFormat.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 32)
        guard let converted = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: max(capacity, 1)) else {
            return
        }
        var supplied = false
        var error: NSError?
        converter.convert(to: converted, error: &error) { _, status in
            if supplied {
                status.pointee = .noDataNow
                return nil
            }
            supplied = true
            status.pointee = .haveData
            return buffer
        }
        if error != nil || converted.frameLength == 0 {
            return
        }
        append(converted)
    }

    private func append(_ buffer: AVAudioPCMBuffer) {
        guard let input = writerInput, input.isReadyForMoreMediaData else {
            return
        }
        guard writer?.status == .writing else {
            return
        }
        let frames = Int64(buffer.frameLength)
        let pts = CMTime(value: segmentFrames, timescale: 16000)
        segmentFrames += frames
        guard let sample = makeSampleBuffer(buffer, pts: pts) else {
            segmentFrames -= frames
            return
        }
        if !input.append(sample) {
            segmentFrames -= frames
        }
    }

    private func makeSampleBuffer(_ buffer: AVAudioPCMBuffer, pts: CMTime) -> CMSampleBuffer? {
        var asbd = buffer.format.streamDescription.pointee
        var formatDesc: CMAudioFormatDescription?
        let created = CMAudioFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            asbd: &asbd,
            layoutSize: 0,
            layout: nil,
            magicCookieSize: 0,
            magicCookie: nil,
            extensions: nil,
            formatDescriptionOut: &formatDesc
        )
        guard created == noErr, let formatDesc = formatDesc else {
            return nil
        }
        var timing = CMSampleTimingInfo(
            duration: CMTime(value: CMTimeValue(buffer.frameLength), timescale: 16000),
            presentationTimeStamp: pts,
            decodeTimeStamp: .invalid
        )
        var sample: CMSampleBuffer?
        let made = CMSampleBufferCreate(
            allocator: kCFAllocatorDefault,
            dataBuffer: nil,
            dataReady: false,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: formatDesc,
            sampleCount: CMItemCount(buffer.frameLength),
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 0,
            sampleSizeArray: nil,
            sampleBufferOut: &sample
        )
        guard made == noErr, let sample = sample else {
            return nil
        }
        let filled = CMSampleBufferSetDataBufferFromAudioBufferList(
            sample,
            blockBufferAllocator: kCFAllocatorDefault,
            blockBufferMemoryAllocator: kCFAllocatorDefault,
            flags: 0,
            bufferList: buffer.audioBufferList
        )
        if filled != noErr {
            return nil
        }
        return sample
    }

    private func openWriter(_ path: String, format: AVAudioFormat) -> Bool {
        closeWriter()
        let url = URL(fileURLWithPath: path)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000
        ]
        do {
            let created = try AVAssetWriter(outputURL: url, fileType: .m4a)
            let input = AVAssetWriterInput(mediaType: .audio, outputSettings: settings)
            input.expectsMediaDataInRealTime = true
            if !created.canAdd(input) {
                return false
            }
            created.add(input)
            if !created.startWriting() {
                return false
            }
            created.startSession(atSourceTime: .zero)
            writer = created
            writerInput = input
            segmentFrames = 0
            currentPath = path
            _ = format
            return true
        } catch {
            NSLog("[voice-note] m4a writer failed \(error.localizedDescription)")
            return false
        }
    }

    private func closeWriter() {
        guard let created = writer else {
            return
        }
        writerInput?.markAsFinished()
        let group = DispatchGroup()
        group.enter()
        created.finishWriting {
            group.leave()
        }
        group.wait()
        lastClosedDurationMs = Int(segmentFrames * 1000 / 16000)
        writer = nil
        writerInput = nil
        segmentFrames = 0
        currentPath = ""
    }

    private func preparePath(_ segmentKey: String) -> String? {
        let parts = segmentKey.split(separator: "|", maxSplits: 1).map { String($0) }
        guard parts.count == 2 else {
            return nil
        }
        let localId = sanitize(parts[0])
        let indexName = sanitize(parts[1])
        guard !localId.isEmpty, !indexName.isEmpty else {
            return nil
        }
        let docs = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first
            ?? NSTemporaryDirectory()
        let dir = (docs as NSString).appendingPathComponent("voice-notes/\(localId)")
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        } catch {
            return nil
        }
        let path = (dir as NSString).appendingPathComponent("\(indexName).m4a")
        if FileManager.default.fileExists(atPath: path) {
            try? FileManager.default.removeItem(atPath: path)
        }
        return path
    }

    private func sanitize(_ raw: String) -> String {
        return raw.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "..", with: "_")
    }
}
