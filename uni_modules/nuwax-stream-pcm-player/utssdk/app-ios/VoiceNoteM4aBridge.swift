//
//  伙伴页录音。AVAudioRecorder 直接写 m4a。
//  AVAudioEngine 在 start 前采样率经常是 0，AVAudioFile 用 16 kHz AAC 创建文件也会失败，
//  这两种都会让开始录音立刻返回空路径。系统录音器会自己封口，文件里有音频数据。
//  segmentKey 格式：localId|index。单字符串跨桥，避免多参数转换失败。
//
import AVFoundation
import CallKit
import Foundation
import UIKit

/// 只要被设成 delegate，CXCallObserver.calls 才会更新。
private final class CallWatch: NSObject, CXCallObserverDelegate {
    func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {}
}

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
    /// 用户自己点的暂停。这种停止不能当成电话打断，否则挂断后又会自动录。
    private var userPaused = false
    private var resumeNotBefore = Date()
    /// 飞书、微信语音不是系统电话。接通时同步封口，挂断通知里同步开下一段。
    /// 静音播放用来让系统在后台把挂断通知送回来。静音文件不进录音。
    private var keepAliveForInterrupt = false
    private var silencePlayer: AVAudioPlayer?
    private var silenceTimer: Timer?
    /// 当前这段的编号。挂断后原生自己开下一段时用来生成不重复的文件名。
    private var segmentLocalId = ""
    private var segmentIndexName = ""
    /// 同一次挂断只使用一个文件名，失败重试时不另起一堆空文件。
    private var resumeKey = ""
    private var wakeTask: UIBackgroundTaskIdentifier = .invalid
    /// 自己激活会话时会再收到一次 began。这段时间内不能把刚开的下一段又封掉。
    private var suppressBeganUntil = Date()
    /// 这次暂停来自系统电话。电话没有 ended 通知时，靠通话列表变空来恢复。
    private var holdIsPhone = false
    /// 已经收到挂断。挂断前不能开下一段，否则计时和波浪会在通话中继续走。
    private var interruptEnded = false
    /// 不设置 delegate 时 calls 一直是空的，系统电话会被当成已经挂断。
    private let callWatch = CallWatch()
    private let callObserver = CXCallObserver()
    private var terminateObserver: NSObjectProtocol?
    private static weak var activeBridge: VoiceNoteM4aBridge?

    public init() {
        VoiceNoteM4aBridge.activeBridge = self
        callObserver.setDelegate(callWatch, queue: .main)
        let center = NotificationCenter.default
        // 录音中划掉进程时，JS 的 onExit 经常来不及把 stop() 跑完。这里在进程退出前同步封口。
        terminateObserver = center.addObserver(
            forName: UIApplication.willTerminateNotification,
            object: nil,
            queue: nil
        ) { _ in
            VoiceNoteM4aBridge.stopForTermination()
        }
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
        if let observer = terminateObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        stopSilence()
        if VoiceNoteM4aBridge.activeBridge === self {
            VoiceNoteM4aBridge.activeBridge = nil
        }
    }

    /// 进程被划掉时同步 stop()，把 moov 写进正在录的 m4a。必须在主线程，且不能再派发一次主线程。
    private static func stopForTermination() {
        guard let bridge = activeBridge else {
            return
        }
        let finish = {
            _ = bridge.closeRecorder()
        }
        if Thread.isMainThread {
            finish()
        } else {
            DispatchQueue.main.sync(execute: finish)
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
        if phoneBusy() || (interruptHold && !interruptEnded) {
            lastError = "音频仍被占用"
            return ""
        }
        if let recorder = recorder, recorder.isRecording, !currentPath.isEmpty {
            return currentPath
        }
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
        let holding = interruptHold
        guard activateSession() else {
            return ""
        }
        if openRecorder(path) {
            interruptHold = false
            userPaused = false
            startSilence()
            return path
        }
        // 第一次 record() 失败后，重新激活会话，再用去掉码率的参数试一次。
        guard activateSession() else {
            interruptHold = holding
            return ""
        }
        if openRecorder(path) {
            interruptHold = false
            userPaused = false
            startSilence()
            return path
        }
        interruptHold = holding
        return ""
    }

    public func pauseSegment() -> String {
        return onMain {
            guard let recorder = self.recorder else {
                self.lastError = "录音器不存在"
                return "0"
            }
            userPaused = true
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
            if Date() < self.resumeNotBefore || self.sessionBusy() {
                self.lastError = "音频仍被占用"
                return "0"
            }
            // 电话挂断后会话是停用的，要先激活再继续写同一个文件。
            if !recorder.isRecording {
                _ = self.activateSession()
            }
            if recorder.record() {
                self.userPaused = false
                self.interruptHold = false
                self.pendingEvents.removeAll()
                return "1"
            }
            _ = self.activateSession()
            if recorder.record() {
                self.userPaused = false
                self.interruptHold = false
                self.pendingEvents.removeAll()
                return "1"
            }
            self.resumeNotBefore = Date().addingTimeInterval(1.5)
            self.lastError = "继续录音失败"
            return "0"
        }
    }

    public func stopSegment() -> String {
        return onMain {
            self.userPaused = false
            self.interruptHold = false
            self.holdIsPhone = false
            self.interruptEnded = false
            self.keepAliveForInterrupt = false
            self.pendingEvents.removeAll()
            self.stopSilence()
            return self.closeRecorder()
        }
    }

    /// 电话或第三方语音打断。正在写的下一段不能再关。已经停掉的文件只补一次封口。
    public func sealForInterruption() -> String {
        return onMain {
            if let recorder = self.recorder, recorder.isRecording {
                return "1"
            }
            self.userPaused = false
            self.keepAliveForInterrupt = true
            self.startSilence()
            return self.closeRecorder()
        }
    }

    /// 原生在挂断后已经开好的文件。页面轮询停住时用它接着录，避免再开一个。
    public func currentRecordingPath() -> String {
        if let recorder = recorder, recorder.isRecording {
            return currentPath
        }
        return ""
    }

    /// 下一段已经录了多久。页面恢复计时时从这里接着走，不把通话那一段算进去。
    public func currentRecordingElapsedMs() -> String {
        guard let recorder = recorder, recorder.isRecording else {
            return "0"
        }
        return String(max(Int(recorder.currentTime * 1000), 0))
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
            // 电话进来时经常没有 interruption 通知，录音器已经被系统停掉。页面仍在计时。
            let ready = Date() >= self.ignoreBeganUntil || self.sessionBusy()
            if !self.userPaused && !self.interruptHold && !self.currentPath.isEmpty && ready {
                if let recorder = self.recorder, !recorder.isRecording {
                    self.interruptBeganAt = Date()
                    self.sealActiveFileForInterrupt()
                    self.pushEvent("began")
                    NSLog("[voice-note] m4a recorder stopped without interruption")
                }
            }
            if self.interruptHold && self.phoneBusy() {
                self.holdIsPhone = true
            }
            // 只有系统电话才在通话列表变空时补一次结束。飞书、微信要等真正的挂断通知，否则页面计时会在通话中恢复。
            if self.interruptHold && self.holdIsPhone && self.interruptGraceDone() && !self.phoneBusy() {
                self.interruptEnded = true
                self.resumeRecordingAfterInterrupt()
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
        // 必须在这次通知里做完。再丢到下一轮主线程的话，飞书切到后台后进程会被挂起，暂停和恢复都要等回到页面。
        if Thread.isMainThread {
            applyInterruption(notification)
            return
        }
        DispatchQueue.main.sync {
            self.applyInterruption(notification)
        }
    }

    private func applyInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else {
            return
        }
        beginWake()
        if type == .began {
            guard recorder != nil, !currentPath.isEmpty else {
                return
            }
            // 开录时会话激活会自己发一次中断。真有电话或语音占用时不能忽略。
            if userPaused {
                return
            }
            if Date() < suppressBeganUntil {
                return
            }
            if Date() < ignoreBeganUntil && !sessionBusy() {
                return
            }
            if !interruptHold {
                interruptBeganAt = Date()
            }
            // 立刻 stop。只 pause 的话，飞书占用期间文件时间轴还在长，中间会变成无法播放的一段。
            sealActiveFileForInterrupt()
            pushEvent("began")
            return
        }
        silencePlayer?.play()
        guard interruptHold else {
            return
        }
        // 挂断通知本身就是结束。飞书没有系统电话，不能再看 phoneBusy 或 secondaryAudio。
        interruptEnded = true
        if !phoneBusy() {
            resumeRecordingAfterInterrupt()
        }
        pushEvent("ended")
    }

    private func interruptGraceDone() -> Bool {
        return Date().timeIntervalSince(interruptBeganAt) >= 0.8
    }

    /// 系统电话、FaceTime 还在通话中。
    private func phoneBusy() -> Bool {
        for call in callObserver.calls {
            if !call.hasEnded {
                return true
            }
        }
        return false
    }

    /// 电话或第三方语音还占着会话时不要恢复。
    private func sessionBusy() -> Bool {
        return phoneBusy() || otherAudioBusy()
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
        let holding = keepAliveForInterrupt
        closeRecorder()
        if writeRecorder(path, bitRate: 64000) {
            keepAliveForInterrupt = false
            return true
        }
        try? FileManager.default.removeItem(atPath: path)
        if writeRecorder(path, bitRate: 0) {
            keepAliveForInterrupt = false
            return true
        }
        if holding {
            keepAliveForInterrupt = true
            startSilence()
        }
        return false
    }

    /// 静音循环只用来让系统把进程留在后台。样本几乎为零，听不到。
    private func startSilence() {
        if silencePlayer == nil {
            let url = silenceFileURL()
            silencePlayer = try? AVAudioPlayer(contentsOf: url)
            silencePlayer?.numberOfLoops = -1
            silencePlayer?.volume = 0
            silencePlayer?.prepareToPlay()
        }
        _ = silencePlayer?.play()
        if silenceTimer == nil {
            let timer = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
                self?.pokeSilence()
            }
            RunLoop.main.add(timer, forMode: .common)
            silenceTimer = timer
        }
    }

    private func pokeSilence() {
        guard keepAliveForInterrupt || silencePlayer != nil else {
            return
        }
        if silencePlayer?.isPlaying != true && !phoneBusy() {
            _ = silencePlayer?.play()
        }
        // 通话还没挂断时只保持静音，不开下一段。计时和波浪要停住。
        if interruptEnded && interruptHold && !phoneBusy() {
            resumeRecordingAfterInterrupt()
        }
    }

    /// 打断一开始就封口，不等页面轮询。飞书切走后页面代码不会再跑。
    private func sealActiveFileForInterrupt() {
        beginWake()
        if !currentPath.isEmpty {
            _ = closeRecorder()
        }
        interruptHold = true
        interruptEnded = false
        if phoneBusy() {
            holdIsPhone = true
        }
        keepAliveForInterrupt = true
        startSilence()
    }

    /// 在挂断回调里直接开下一段。这时页面定时器通常是停的。
    private func resumeRecordingAfterInterrupt() {
        if phoneBusy() {
            return
        }
        if let recorder = recorder, recorder.isRecording, !currentPath.isEmpty {
            return
        }
        guard !segmentLocalId.isEmpty else {
            return
        }
        if resumeKey.isEmpty {
            let stamp = Int(Date().timeIntervalSince1970 * 1000)
            let indexName = segmentIndexName.isEmpty ? "c\(stamp)" : "\(segmentIndexName)c\(stamp)"
            resumeKey = "\(segmentLocalId)|\(indexName)"
        }
        guard let path = preparePath(resumeKey) else {
            return
        }
        ignoreBeganUntil = Date().addingTimeInterval(1.5)
        beginWake()
        guard activateSession() else {
            return
        }
        if openRecorder(path) {
            resumeKey = ""
            interruptHold = false
            holdIsPhone = false
            interruptEnded = false
            userPaused = false
            keepAliveForInterrupt = false
            suppressBeganUntil = Date().addingTimeInterval(1.2)
            startSilence()
            endWake()
            NSLog("[voice-note] resumed after interruption \(path)")
            return
        }
        keepAliveForInterrupt = true
        startSilence()
    }

    private func beginWake() {
        if wakeTask != .invalid {
            return
        }
        wakeTask = UIApplication.shared.beginBackgroundTask(withName: "voice-note-call") { [weak self] in
            self?.endWake()
        }
    }

    private func endWake() {
        let task = wakeTask
        wakeTask = .invalid
        if task != .invalid {
            UIApplication.shared.endBackgroundTask(task)
        }
    }

    private func stopSilence() {
        silenceTimer?.invalidate()
        silenceTimer = nil
        silencePlayer?.stop()
        silencePlayer = nil
    }

    private func silenceFileURL() -> URL {
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-note-silence.wav")
        if FileManager.default.fileExists(atPath: url.path) {
            return url
        }
        let sampleRate = 8000
        let sampleCount = 4000
        var bytes = Data(capacity: 44 + sampleCount * 2)
        func appendU32(_ value: UInt32) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { bytes.append(contentsOf: $0) }
        }
        func appendU16(_ value: UInt16) {
            var little = value.littleEndian
            withUnsafeBytes(of: &little) { bytes.append(contentsOf: $0) }
        }
        bytes.append(contentsOf: [0x52, 0x49, 0x46, 0x46])
        appendU32(UInt32(36 + sampleCount * 2))
        bytes.append(contentsOf: [0x57, 0x41, 0x56, 0x45])
        bytes.append(contentsOf: [0x66, 0x6d, 0x74, 0x20])
        appendU32(16)
        appendU16(1)
        appendU16(1)
        appendU32(UInt32(sampleRate))
        appendU32(UInt32(sampleRate * 2))
        appendU16(2)
        appendU16(16)
        bytes.append(contentsOf: [0x64, 0x61, 0x74, 0x61])
        appendU32(UInt32(sampleCount * 2))
        for _ in 0..<sampleCount {
            appendU16(1)
        }
        try? bytes.write(to: url)
        return url
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
        segmentLocalId = localId
        segmentIndexName = indexName
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
