//
//  伙伴页录音。AVAudioRecorder 直接写 m4a。
//  AVAudioEngine 在 start 前采样率经常是 0，AVAudioFile 用 16 kHz AAC 创建文件也会失败，
//  这两种都会让开始录音立刻返回空路径。系统录音器会自己封口，文件里有音频数据。
//  segmentKey 格式：localId|index。单字符串跨桥，避免多参数转换失败。
//
import AVFoundation
import Foundation

public class VoiceNoteM4aBridge {
    private var recorder: AVAudioRecorder?
    private var lastClosedDurationMs: Int = 0
    private var currentPath = ""
    private var lastError = ""
    private var interruptObserver: NSObjectProtocol?
    private var interruptHold = false
    private var interruptBeganAt = Date()
    private var pendingEvents: [String] = []
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
        return onMain {
            self.startSegmentOnMain(segmentKey)
        }
    }

    /// 封上当前 m4a，立刻打开下一段。
    public func rotateSegment(_ segmentKey: String) -> String {
        return onMain {
            guard let path = self.preparePath(segmentKey) else {
                self.lastError = "录音路径无效"
                return ""
            }
            self.closeRecorder()
            if self.openRecorder(path) {
                return path
            }
            return ""
        }
    }

    /// AVAudioRecorder 只能在主线程创建和开始。从后台线程调用时 record() 会直接返回失败。
    private func onMain(_ work: () -> String) -> String {
        if Thread.isMainThread {
            return work()
        }
        var opened = ""
        DispatchQueue.main.sync {
            opened = work()
        }
        return opened
    }

    private func startSegmentOnMain(_ segmentKey: String) -> String {
        lastError = ""
        let session = AVAudioSession.sharedInstance()
        if session.recordPermission == .denied {
            lastError = "没有麦克风权限"
            return ""
        }
        guard let path = preparePath(segmentKey) else {
            lastError = "录音路径无效"
            return ""
        }
        ignoreBeganUntil = Date().addingTimeInterval(1.5)
        interruptHold = false
        guard activateSession() else {
            return ""
        }
        if openRecorder(path) {
            return path
        }
        // 第一次 record() 失败后，重新激活会话，再用去掉码率的参数试一次。
        guard activateSession() else {
            return ""
        }
        if openRecorder(path) {
            return path
        }
        return ""
    }

    public func pauseSegment() -> String {
        return onMain {
            guard let recorder = self.recorder else {
                self.lastError = "录音器不存在"
                return "0"
            }
            if recorder.isRecording {
                recorder.pause()
            }
            return "1"
        }
    }

    public func resumeSegment() -> String {
        return onMain {
            guard let recorder = self.recorder else {
                self.lastError = "录音器不存在"
                return "0"
            }
            // 电话挂断后会话是停用的，要先激活再继续写同一个文件。
            if !recorder.isRecording {
                _ = self.activateSession()
            }
            if recorder.record() {
                self.interruptHold = false
                self.pendingEvents.removeAll()
                return "1"
            }
            _ = self.activateSession()
            if recorder.record() {
                self.interruptHold = false
                self.pendingEvents.removeAll()
                return "1"
            }
            self.lastError = "继续录音失败"
            return "0"
        }
    }

    public func stopSegment() -> String {
        return onMain {
            self.interruptHold = false
            self.pendingEvents.removeAll()
            return self.closeRecorder()
        }
    }

    /// 进程被杀掉后，给没有 moov 的 m4a 补封口。已经封口的文件原样返回成功。
    public func sealFile(_ path: String) -> String {
        return VoiceNoteM4aSeal.sealFile(path)
    }

    public func takeClosedDurationMs() -> String {
        let duration = String(lastClosedDurationMs)
        lastClosedDurationMs = 0
        return duration
    }

    public func takeLastError() -> String {
        return lastError
    }

    /// 来电、微信语音、飞书语音等抢走音频会话。返回一次 "began" 或 "ended"，读完即清。
    /// 结束后系统经常不发 interruption ended，会话空出来后补一次结束。
    public func takeInterruption() -> String {
        return onMain {
            if self.interruptHold && self.interruptGraceDone() && !self.otherAudioBusy() {
                self.pushEvent("ended")
            }
            if self.pendingEvents.isEmpty {
                return ""
            }
            let event = self.pendingEvents.removeFirst()
            if event == "began" {
                let ms = Int(self.interruptBeganAt.timeIntervalSince1970 * 1000)
                return "began|\(ms)"
            }
            return event
        }
    }

    /// 最近一小段输入的音量，0 到 100。面板用来画左侧音波。
    public func takeLevel() -> String {
        guard let recorder = recorder, recorder.isRecording else {
            return "0"
        }
        recorder.updateMeters()
        let db = recorder.averagePower(forChannel: 0)
        var level = Int((db + 50) / 50 * 100)
        if level < 0 {
            level = 0
        }
        if level > 100 {
            level = 100
        }
        return String(level)
    }

    private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else {
            return
        }
        if type == .began {
            DispatchQueue.main.async { [weak self] in
                guard let self = self, self.recorder != nil, !self.currentPath.isEmpty else {
                    return
                }
                // 开录时会话激活会自己发一次中断。真有电话或语音占用时不能忽略。
                if Date() < self.ignoreBeganUntil && !self.otherAudioBusy() {
                    return
                }
                // 系统经常先停掉录音器再发通知。这时 isRecording 已经是 false，仍然要通知页面暂停。
                if let recorder = self.recorder, recorder.isRecording {
                    recorder.pause()
                }
                if !self.interruptHold {
                    self.interruptBeganAt = Date()
                }
                self.interruptHold = true
                self.pushEvent("began")
            }
            return
        }
        DispatchQueue.main.async { [weak self] in
            guard let self = self, self.interruptHold, self.interruptGraceDone(), !self.otherAudioBusy() else {
                return
            }
            self.pushEvent("ended")
        }
    }

    private func interruptGraceDone() -> Bool {
        return Date().timeIntervalSince(interruptBeganAt) >= 0.8
    }

    /// 电话或第三方语音还占着会话时不要恢复。
    private func otherAudioBusy() -> Bool {
        let session = AVAudioSession.sharedInstance()
        if session.isOtherAudioPlaying {
            return true
        }
        if session.secondaryAudioShouldBeSilencedHint {
            return true
        }
        return false
    }

    private func pushEvent(_ event: String) {
        if pendingEvents.last == event {
            return
        }
        pendingEvents.append(event)
        if pendingEvents.count > 4 {
            pendingEvents.removeFirst()
        }
    }

    private func activateSession() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.defaultToSpeaker]
            )
            try session.setActive(true)
            return true
        } catch {
            lastError = "音频会话失败"
            NSLog("[voice-note] m4a session failed \(error.localizedDescription)")
            return false
        }
    }

    private func openRecorder(_ path: String) -> Bool {
        closeRecorder()
        if writeRecorder(path, bitRate: 64000) {
            return true
        }
        try? FileManager.default.removeItem(atPath: path)
        return writeRecorder(path, bitRate: 0)
    }

    /// bitRate 为 0 时不写码率，避开部分系统因码率拒绝 prepareToRecord。
    private func writeRecorder(_ path: String, bitRate: Int) -> Bool {
        var settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1
        ]
        if bitRate > 0 {
            settings[AVEncoderBitRateKey] = bitRate
        }
        do {
            let next = try AVAudioRecorder(url: URL(fileURLWithPath: path), settings: settings)
            let prepared = next.prepareToRecord()
            if !prepared || !next.record() {
                let session = AVAudioSession.sharedInstance()
                lastError = "录音器未能开始"
                NSLog("[voice-note] m4a record() failed prepared=\(prepared) category=\(session.category.rawValue) permission=\(session.recordPermission.rawValue) input=\(session.isInputAvailable) bitRate=\(bitRate) path=\(path)")
                next.stop()
                return false
            }
            lastError = ""
            next.isMeteringEnabled = true
            recorder = next
            currentPath = path
            return true
        } catch {
            lastError = "创建录音文件失败"
            NSLog("[voice-note] m4a recorder failed \(error.localizedDescription)")
            return false
        }
    }

    /// 停掉录音器并写完 m4a。没有正在写的文件返回 "1"；文件仍是 0 字节返回 "0"。
    private func closeRecorder() -> String {
        let path = currentPath
        let current = recorder
        if let current = current {
            lastClosedDurationMs = max(Int(current.currentTime * 1000), 0)
            current.stop()
        }
        recorder = nil
        currentPath = ""
        if path.isEmpty {
            return "1"
        }
        let attrs = try? FileManager.default.attributesOfItem(atPath: path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        if size <= 0 {
            lastError = "录音文件是空的"
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
