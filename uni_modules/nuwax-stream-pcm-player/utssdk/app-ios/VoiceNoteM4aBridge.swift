//
//  伙伴页录音。一次会话只用一个 AVAudioEngine，分段只换 AVAudioFile 写出的 m4a。
//  不使用 AVAudioRecorder，也不走聊天页的 StreamPcmRecorder。
//  AVAssetWriter 需要手搓 CMSampleBuffer，非交错 PCM 在 iOS 上会被拒绝，封口后文件仍是 0 字节。
//  segmentKey 格式：localId|index。单字符串跨桥，避免多参数转换失败。
//
import AVFoundation
import Foundation

public class VoiceNoteM4aBridge {
    private let queue = DispatchQueue(label: "voice-note-m4a")
    private var engine: AVAudioEngine?
    private var audioFile: AVAudioFile?
    private var paused = false
    private var running = false
    private var segmentFrames: Int64 = 0
    private var lastClosedDurationMs: Int = 0
    private var currentPath = ""
    private var loggedWrite = false
    private var interruptObserver: NSObjectProtocol?
    private var interruptHold = false
    private var pendingEvent = ""
    private var inputLevel = 0
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
            if self.openFile(path) {
                opened = path
            }
        }
        return opened
    }

    /// 封上当前 m4a，立刻打开下一段。AVAudioEngine 不停、不释放。
    public func rotateSegment(_ segmentKey: String) -> String {
        guard engine != nil, let path = preparePath(segmentKey) else {
            return ""
        }
        var opened = ""
        queue.sync {
            self.closeFile()
            if self.openFile(path) {
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
            if self.engine == nil || self.audioFile == nil {
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
        var sealed = "1"
        queue.sync {
            self.running = false
            self.paused = false
            self.interruptHold = false
            self.pendingEvent = ""
            sealed = self.closeFile()
        }
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        return sealed
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

    /// 最近一小段输入的音量，0 到 100。面板用来画左侧音波。
    public func takeLevel() -> String {
        return String(inputLevel)
    }

    private func noteLevel(_ buffer: AVAudioPCMBuffer) {
        let frames = Int(buffer.frameLength)
        if frames <= 0 {
            return
        }
        var sum: Float = 0
        var count = 0
        if let src = buffer.floatChannelData {
            let data = src[0]
            var i = 0
            while i < frames {
                let value = data[i]
                sum += value * value
                count += 1
                i += 16
            }
        } else if let src = buffer.int16ChannelData {
            let data = src[0]
            var i = 0
            while i < frames {
                let value = Float(data[i]) / 32768
                sum += value * value
                count += 1
                i += 16
            }
        }
        if count == 0 {
            return
        }
        let rms = sqrt(sum / Float(count))
        var level = Int(rms / 0.08 * 100)
        if level < 0 {
            level = 0
        }
        if level > 100 {
            level = 100
        }
        inputLevel = level
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
        created.prepare()
        // 引擎真正 start 之前，inputFormat 经常是 0 Hz。这时不能判失败。
        // 优先用已经有采样率的输出格式；没有就让 tap 使用节点自己的格式。
        let output = input.outputFormat(forBus: 0)
        let hardware = input.inputFormat(forBus: 0)
        let format: AVAudioFormat? = output.sampleRate > 0 ? output : (hardware.sampleRate > 0 ? hardware : nil)
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
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
        noteLevel(buffer)
        queue.async { [weak self] in
            self?.consume(copy)
        }
    }

    private func consume(_ buffer: AVAudioPCMBuffer) {
        if !running || paused {
            return
        }
        guard let file = audioFile else {
            return
        }
        guard let converted = resample(buffer, to: file.processingFormat) else {
            if !loggedWrite {
                loggedWrite = true
                NSLog("[voice-note] m4a resample failed \(buffer.format)")
            }
            return
        }
        write(converted, to: file)
    }

    /// 混成单声道再重采样到文件要求的格式。不用 AVAudioConverter，避免它一直返回 0 帧。
    private func resample(_ buffer: AVAudioPCMBuffer, to format: AVAudioFormat) -> AVAudioPCMBuffer? {
        let srcFrames = Int(buffer.frameLength)
        let srcRate = buffer.format.sampleRate
        let dstRate = format.sampleRate
        let srcChannels = Int(buffer.format.channelCount)
        if srcFrames <= 0 || srcRate <= 0 || dstRate <= 0 || srcChannels <= 0 {
            return nil
        }
        let dstFrames = max(Int((Double(srcFrames) * dstRate / srcRate).rounded()), 1)
        guard let out = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(dstFrames)) else {
            return nil
        }
        out.frameLength = AVAudioFrameCount(dstFrames)
        let dstChannels = max(Int(format.channelCount), 1)
        for i in 0..<dstFrames {
            let srcPos = Double(i) * srcRate / dstRate
            let i0 = min(Int(srcPos), srcFrames - 1)
            let i1 = min(i0 + 1, srcFrames - 1)
            let frac = Float(srcPos - Double(i0))
            let mixed = mix(buffer, frame: i0) + (mix(buffer, frame: i1) - mix(buffer, frame: i0)) * frac
            if !store(mixed, at: i, channels: dstChannels, into: out) {
                return nil
            }
        }
        return out
    }

    private func mix(_ buffer: AVAudioPCMBuffer, frame: Int) -> Float {
        let channels = Int(buffer.format.channelCount)
        if channels <= 0 {
            return 0
        }
        var sum: Float = 0
        if let data = buffer.floatChannelData {
            for c in 0..<channels {
                sum += data[c][frame]
            }
            return sum / Float(channels)
        }
        if let data = buffer.int16ChannelData {
            for c in 0..<channels {
                sum += Float(data[c][frame]) / 32768
            }
            return sum / Float(channels)
        }
        return 0
    }

    private func store(_ sample: Float, at index: Int, channels: Int, into buffer: AVAudioPCMBuffer) -> Bool {
        let clamped = max(-1, min(1, sample))
        if buffer.format.commonFormat == .pcmFormatFloat32, let data = buffer.floatChannelData {
            let count = min(channels, Int(buffer.format.channelCount))
            for c in 0..<count {
                data[c][index] = clamped
            }
            return count > 0
        }
        if buffer.format.commonFormat == .pcmFormatInt16, let data = buffer.int16ChannelData {
            let pcm = Int16(clamped * 32767)
            let count = min(channels, Int(buffer.format.channelCount))
            for c in 0..<count {
                data[c][index] = pcm
            }
            return count > 0
        }
        return false
    }

    private func write(_ buffer: AVAudioPCMBuffer, to file: AVAudioFile) {
        do {
            try file.write(from: buffer)
            segmentFrames += Int64(buffer.frameLength)
        } catch {
            if !loggedWrite {
                loggedWrite = true
                NSLog("[voice-note] m4a write failed \(error.localizedDescription) dst=\(file.processingFormat)")
            }
        }
    }

    private func openFile(_ path: String) -> Bool {
        closeFile()
        let url = URL(fileURLWithPath: path)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000
        ]
        do {
            audioFile = try AVAudioFile(forWriting: url, settings: settings)
            segmentFrames = 0
            currentPath = path
            loggedWrite = false
            return true
        } catch {
            NSLog("[voice-note] m4a file failed \(error.localizedDescription)")
            audioFile = nil
            return false
        }
    }

    /// 关掉文件并等它把 m4a 头写完。没有打开的文件返回 "1"；写出的文件仍是 0 字节返回 "0"。
    private func closeFile() -> String {
        let path = currentPath
        let rate = audioFile?.processingFormat.sampleRate ?? 16000
        let duration = rate > 0 ? Int(Double(segmentFrames) * 1000 / rate) : 0
        audioFile = nil
        segmentFrames = 0
        currentPath = ""
        if path.isEmpty {
            return "1"
        }
        lastClosedDurationMs = duration
        let attrs = try? FileManager.default.attributesOfItem(atPath: path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        if size <= 0 {
            NSLog("[voice-note] m4a closed empty \(path)")
            return "0"
        }
        return "1"
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
