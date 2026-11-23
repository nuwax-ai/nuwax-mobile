//
//  伙伴页录音。AVAudioRecorder 直接写 m4a。
//  AVAudioEngine 在 start 前采样率经常是 0，AVAudioFile 用 16 kHz AAC 创建文件也会失败，
//  这两种都会让开始录音立刻返回空路径。系统录音器会自己封口，文件里有音频数据。
//  segmentKey 格式：localId|index。单字符串跨桥，避免多参数转换失败。
//
import AVFoundation
import Foundation

public class VoiceNoteM4aBridge {
    private let queue = DispatchQueue(label: "voice-note-m4a")
    private var recorder: AVAudioRecorder?
    private var lastClosedDurationMs: Int = 0
    private var currentPath = ""
    private var lastError = ""
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
        lastError = ""
        guard let path = preparePath(segmentKey) else {
            lastError = "录音路径无效"
            return ""
        }
        guard activateSession() else {
            return ""
        }
        var opened = ""
        queue.sync {
            self.ignoreBeganUntil = Date().addingTimeInterval(1.5)
            self.interruptHold = false
            if self.openRecorder(path) {
                opened = path
            }
        }
        return opened
    }

    /// 封上当前 m4a，立刻打开下一段。
    public func rotateSegment(_ segmentKey: String) -> String {
        guard let path = preparePath(segmentKey) else {
            lastError = "录音路径无效"
            return ""
        }
        var opened = ""
        queue.sync {
            self.closeRecorder()
            if self.openRecorder(path) {
                opened = path
            }
        }
        return opened
    }

    public func pauseSegment() -> String {
        var ok = "0"
        queue.sync {
            guard let recorder = self.recorder else {
                self.lastError = "录音器不存在"
                return
            }
            if recorder.isRecording {
                recorder.pause()
            }
            ok = "1"
        }
        return ok
    }

    public func resumeSegment() -> String {
        var ok = "0"
        queue.sync {
            guard let recorder = self.recorder else {
                self.lastError = "录音器不存在"
                return
            }
            self.interruptHold = false
            if recorder.record() {
                ok = "1"
            } else {
                self.lastError = "继续录音失败"
            }
        }
        return ok
    }

    public func stopSegment() -> String {
        var sealed = "1"
        queue.sync {
            self.interruptHold = false
            self.pendingEvent = ""
            sealed = self.closeRecorder()
        }
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

    public func takeLastError() -> String {
        var text = ""
        queue.sync {
            text = self.lastError
        }
        return text
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
            if Date() < ignoreBeganUntil {
                return
            }
            queue.sync {
                guard let recorder = self.recorder, recorder.isRecording else {
                    return
                }
                recorder.pause()
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

    private func activateSession() -> Bool {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.defaultToSpeaker, .mixWithOthers]
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
        let url = URL(fileURLWithPath: path)
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000
        ]
        do {
            let next = try AVAudioRecorder(url: url, settings: settings)
            next.isMeteringEnabled = true
            if !next.prepareToRecord() || !next.record() {
                lastError = "录音器未能开始"
                NSLog("[voice-note] m4a record() failed \(path)")
                return false
            }
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
