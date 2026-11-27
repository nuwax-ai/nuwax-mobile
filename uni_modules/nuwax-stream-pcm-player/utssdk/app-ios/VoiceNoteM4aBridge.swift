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
    var changed: ((CXCall) -> Void)?

    func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) {
        changed?(call)
    }
}

public class VoiceNoteM4aBridge {
    private var recorder: AVAudioRecorder?
    private var lastClosedDurationMs: Int = 0
    private var currentPath = ""
    private var interruptionUpload: VoiceNoteUploadContext?
    private var lastError = ""
    private var interruptObserver: NSObjectProtocol?
    private var audioLifecycleObservers: [NSObjectProtocol] = []
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
    private var resumeCandidatePath = ""
    private var wakeTask: UIBackgroundTaskIdentifier = .invalid
    /// 自己激活会话时会再收到一次 began。这段时间内不能把刚开的下一段又封掉。
    private var suppressBeganUntil = Date()
    private var holdIsPhone = false
    // 恢复许可只来自本轮系统信号或用户明确继续。声音安静、路由和回前台都不授予许可。
    private var resumeSource: String?
    private var resumeGeneration = 0
    private var resumeAttemptsRunning = false
    private var heldPath = ""
    private var heldDurationMs = 0
    private var lastRecordingDurationMs = 0
    private var lastOpenedAt = Date.distantPast
    private var thirdPartySuspect = false
    private var watchTimer: Timer?
    private var activeObserver: NSObjectProtocol?
    private var backgroundObserver: NSObjectProtocol?
    /// 不设置 delegate 时 calls 一直是空的，系统电话会被当成已经挂断。
    private let callWatch = CallWatch()
    private let callObserver = CXCallObserver()
    private var terminateObserver: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?
    private var resumeAttempt = 0
    private static weak var activeBridge: VoiceNoteM4aBridge?

    public init() {
        VoiceNoteM4aBridge.activeBridge = self
        callWatch.changed = { [weak self] call in
            self?.systemCallChanged(call)
        }
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
        observeAudioLifecycle()
        routeObserver = center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] _ in
            self?.handleRouteChange()
        }
        UIApplication.shared.beginReceivingRemoteControlEvents()
        activeObserver = center.addObserver(
            forName: UIApplication.didBecomeActiveNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.noteBecameActive()
        }
        backgroundObserver = center.addObserver(
            forName: UIApplication.didEnterBackgroundNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.noteEnteredBackground()
        }
    }

    deinit {
        for observer in audioLifecycleObservers {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = interruptObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = terminateObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = routeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = activeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = backgroundObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        stopSilence()
        watchTimer?.invalidate()
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
            _ = bridge.stopSegment()
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

    public func configureInterruptionUpload(_ raw: String) -> String {
        return onMain {
            self.interruptionUpload = nil
            guard VoiceNoteBackgroundUploader.enabled,
                  let context = try? JSONDecoder().decode(VoiceNoteUploadContext.self, from: Data(raw.utf8)),
                  context.path == self.currentPath, !context.authorization.isEmpty,
                  context.url.scheme == "https" || context.url.scheme == "http" else { return "0" }
            self.interruptionUpload = context
            return "1"
        }
    }

    /// 封上当前 m4a，立刻打开下一段。
    public func rotateSegment(_ segmentKey: String) -> String {
        return onMain {
            self.observeStoppedRecorder()
            guard !self.interruptHold,
                  let path = self.preparePath(segmentKey) else {
                self.lastError = "录音路径无效"
                return ""
            }
            _ = self.closeRecorder()
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
        guard !phoneBusy(), !interruptHold, !userPaused || !otherAppPlaying() else {
            lastError = "音频仍被占用"
            return ""
        }
        if let recorder, recorder.isRecording, !currentPath.isEmpty {
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
        // 首次 record() 失败时重新激活一次。
        guard activateSession() else { return "" }
        if !openRecorder(path) {
            guard activateSession(), openRecorder(path) else { return "" }
        }
        userPaused = false
        startSilence()
        return path
    }

    public func pauseSegment() -> String {
        return onMain {
            self.userPaused = true
            if self.interruptHold {
                // 暂停时可能正等首个采样。先封口，索引会保留已写入的数据。
                self.cancelResume()
                self.interruptHold = false
                self.holdIsPhone = false
            } else if let recorder = self.recorder, recorder.isRecording {
                self.sampleRecordingDuration()
                recorder.pause()
            }
            self.pendingEvents.removeAll()
            self.clearThirdPartyWatch()
            self.stopSilence()
            self.endWake()
            return "1"
        }
    }

    public func resumeSegment() -> String {
        return onMain {
            guard !self.interruptHold, let recorder = self.recorder else {
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
            if recorder.record() || (self.activateSession() && recorder.record()) {
                self.userPaused = false
                self.pendingEvents.removeAll()
                self.startSilence()
                return "1"
            }
            self.resumeNotBefore = Date().addingTimeInterval(1.5)
            self.lastError = "继续录音失败"
            return "0"
        }
    }

    public func stopSegment() -> String {
        return onMain {
            self.cancelResume(closeCandidate: false)
            self.userPaused = false
            self.interruptHold = false
            self.holdIsPhone = false
            self.keepAliveForInterrupt = false
            self.pendingEvents.removeAll()
            self.clearThirdPartyWatch()
            self.stopSilence()
            self.endWake()
            let result = self.closeRecorder()
            self.segmentLocalId = ""
            self.heldPath = ""
            self.heldDurationMs = 0
            return result
        }
    }

    public func sealForInterruption() -> String {
        return onMain {
            self.observeStoppedRecorder()
            return "1"
        }
    }

    public func requestInterruptionResume(_ localId: String) -> String {
        return onMain {
            guard self.segmentLocalId == localId, self.interruptHold, !self.userPaused,
                  UIApplication.shared.applicationState == .active,
                  !self.phoneBusy(), !self.otherAppPlaying() else { return "0" }
            self.acceptResumeSignal("user")
            return "1"
        }
    }

    /// 以同一份原生状态同步文件和时长。恢复候选段在确认采样前仍是 held。
    public func recordingState(_ localId: String) -> String {
        return onMain {
            guard !localId.isEmpty, self.segmentLocalId == localId else { return "" }
            self.observeStoppedRecorder()
            self.observeSystemCallEnd()
            if self.interruptHold {
                return "held|\(self.heldDurationMs)|\(self.heldPath)"
            }
            if let recorder = self.recorder, recorder.isRecording, !self.userPaused {
                self.sampleRecordingDuration()
                return "live|\(self.lastRecordingDurationMs)|\(self.currentPath)"
            }
            return ""
        }
    }

    public func currentRecordingPath() -> String {
        return onMain {
            guard !self.userPaused, !self.interruptHold, self.recorder?.isRecording == true else { return "" }
            return self.currentPath
        }
    }

    public func currentRecordingElapsedMs() -> String {
        return onMain {
            guard !self.userPaused, !self.interruptHold, self.recorder?.isRecording == true else { return "0" }
            self.sampleRecordingDuration()
            return String(self.lastRecordingDurationMs)
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

    public func takeInterruption() -> String {
        return onMain {
            self.observeStoppedRecorder()
            self.observeSystemCallEnd()
            return self.pendingEvents.isEmpty ? "" : self.pendingEvents.removeFirst()
        }
    }

    /// 最近一小段输入的音量，0 到 100。面板用来画左侧音波。
    public func takeLevel() -> String {
        return onMain { self.recordingLevel() }
    }

    private func recordingLevel() -> String {
        guard !userPaused, !interruptHold, let recorder, recorder.isRecording else { return "-1" }
        sampleRecordingDuration()
        if !recorder.isMeteringEnabled {
            recorder.isMeteringEnabled = true
        }
        recorder.updateMeters()
        let db = recorder.averagePower(forChannel: 0)
        // -160 是没有采样。这时不是安静，不能画成 6px 往左滑。
        if db <= -120 {
            return "-1"
        }
        var level = Int((db + 50) / 50 * 100)
        if level < 0 {
            level = 0
        }
        if level > 100 {
            level = 100
        }
        return String(level)
    }

    private func noteEnteredBackground() {
        onMainVoid {
            self.observeStoppedRecorder()
            self.logState("entered background")
        }
    }

    private func noteBecameActive() {
        onMainVoid {
            self.observeStoppedRecorder()
            self.observeSystemCallEnd()
            self.logState("became active")
            self.scheduleResumeAttempts()
        }
    }

    private func onMainVoid(_ work: @escaping () -> Void) {
        if Thread.isMainThread {
            work()
        } else {
            DispatchQueue.main.sync(execute: work)
        }
    }

    /// 联调日志：打断、前后台、恢复每一步都打印原生状态。真机复现时看 HBuilderX logcat 里的 [voice-note]。
    private func logState(_ tag: String) {
        let state = UIApplication.shared.applicationState
        let app = state == .active ? "active" : (state == .background ? "background" : "inactive")
        let recording = recorder?.isRecording == true ? "1" : "0"
        let path = currentPath.isEmpty ? "-" : (currentPath as NSString).lastPathComponent
        NSLog(
            "[voice-note] \(tag) app=\(app) hold=\(interruptHold) resume=\(resumeSource ?? "-") generation=\(resumeGeneration) userPaused=\(userPaused) recording=\(recording) phone=\(phoneBusy()) other=\(otherAudioBusy()) playing=\(otherAppPlaying()) path=\(path)"
        )
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
        if type == .began {
            if (info[AVAudioSessionInterruptionReasonKey] as? UInt) == AVAudioSession.InterruptionReason.appWasSuspended.rawValue {
                logState("delayed interruption after suspension")
                observeStoppedRecorder()
                return
            }
            noteInterruptionBegan()
            return
        }

        logState("legacy interruption ended")
        if holdIsPhone || phoneBusy() {
            observeSystemCallEnd()
            return
        }
        if interruptHold {
            acceptResumeSignal("legacy")
            return
        }
        guard thirdPartySuspect, !userPaused else { return }
        // 响铃结束时，如果原录音器还可继续，就留在同一段。
        if !otherAppPlaying(), continueSameFile() {
            clearThirdPartyWatch()
            endWake()
            return
        }
        sealActiveFileForInterrupt(isPhone: false)
        acceptResumeSignal("legacy")
    }

    private func noteInterruptionBegan() {
        guard !userPaused, interruptHold || recorder != nil else { return }
        logState("interruption began")
        let isPhone = phoneBusy()
        if interruptHold {
            // 激活会话可能带来自身的 began。新的占用才撤销上一轮恢复许可。
            let waitingToOpen = resumeSource != nil && resumeAttempt == 0
            let candidateStopped = !resumeCandidatePath.isEmpty && recorder?.isRecording != true
            if isPhone || otherAppPlaying() || waitingToOpen || candidateStopped {
                cancelResume()
                holdIsPhone = holdIsPhone || isPhone
            }
            return
        }
        if isPhone {
            sealActiveFileForInterrupt(isPhone: true)
        } else if recorder?.isRecording != true {
            sealActiveFileForInterrupt(isPhone: false)
        } else if Date() >= suppressBeganUntil {
            thirdPartySuspect = true
            beginWake()
            startWatchTimer()
        }
    }

    private func systemCallChanged(_ call: CXCall) {
        guard !userPaused else { return }
        if call.hasEnded {
            observeSystemCallEnd()
        } else if call.hasConnected, interruptHold || recorder != nil {
            if interruptHold {
                if !holdIsPhone || resumeSource != nil { cancelResume() }
                holdIsPhone = true
            } else {
                sealActiveFileForInterrupt(isPhone: true)
            }
        }
    }

    private func observeSystemCallEnd() {
        guard interruptHold, holdIsPhone, !phoneBusy() else { return }
        acceptResumeSignal("callkit")
    }

    /// iOS 27 真机先观测送达时机。通过长通话验收后，才能打开实验性的恢复路径。
    private func observeAudioLifecycle() {
        #if compiler(>=6.4)
        guard #available(iOS 27.0, *) else { return }
        let center = NotificationCenter.default
        let session = AVAudioSession.sharedInstance()
        audioLifecycleObservers.append(center.addObserver(
            forName: AVAudioSession.didBecomeInactiveNotification, object: session, queue: .main
        ) { [weak self] notification in
            guard let self, self.recorder != nil || self.interruptHold else { return }
            self.logState("iOS 27 audio session inactive")
            guard UserDefaults.standard.bool(forKey: "NuwaxVoiceNoteResumeRecommendation"),
                  let context = notification.userInfo?[AVAudioSession.deactivationContextKey] as? AVAudioSession.DeactivationContext,
                  context.source == .system else { return }
            self.noteInterruptionBegan()
        })
        audioLifecycleObservers.append(center.addObserver(
            forName: AVAudioSession.resumptionRecommendationNotification, object: session, queue: .main
        ) { [weak self] notification in
            guard let self, self.recorder != nil || self.interruptHold,
                  let context = notification.userInfo?[AVAudioSession.resumptionContextKey] as? AVAudioSession.ResumptionContext else { return }
            let shouldResume = context.recommendation == .shouldResume
            self.logState("iOS 27 resumption recommendation shouldResume=\(shouldResume)")
            guard shouldResume, !self.holdIsPhone, !self.phoneBusy(),
                  UserDefaults.standard.bool(forKey: "NuwaxVoiceNoteResumeRecommendation") else { return }
            self.observeStoppedRecorder()
            self.acceptResumeSignal("ios27")
        })
        #endif
    }

    /// 路由和前后台事件只能重试已有的许可。
    private func handleRouteChange() {
        onMainVoid {
            self.observeStoppedRecorder()
            self.scheduleResumeAttempts()
        }
    }

    private func acceptResumeSignal(_ source: String) {
        guard interruptHold, !userPaused, !phoneBusy() else { return }
        if resumeSource == nil {
            resumeSource = source
            logState("resume signal accepted")
        } else if source != "user" {
            return
        }
        scheduleResumeAttempts()
    }

    private func cancelResume(closeCandidate: Bool = true) {
        resumeGeneration += 1
        resumeAttemptsRunning = false
        resumeSource = nil
        if closeCandidate && !resumeCandidatePath.isEmpty { _ = closeRecorder() }
        resumeCandidatePath = ""
        resumeKey = ""
    }

    private func scheduleResumeAttempts() {
        guard interruptHold, resumeSource != nil, !resumeAttemptsRunning, !phoneBusy() else { return }
        resumeAttemptsRunning = true
        resumeAttempt = 0
        let generation = resumeGeneration
        // 快速出现的旧 ended 可能只是响铃退出。给随后的接通中断留出撤销窗口。
        let settle = resumeSource == "legacy" ? 0.8 - Date().timeIntervalSince(interruptBeganAt) : 0
        if settle > 0 {
            DispatchQueue.main.asyncAfter(deadline: .now() + settle) { [weak self] in
                self?.pumpResumeAttempt(generation)
            }
        } else {
            pumpResumeAttempt(generation)
        }
    }

    private func pumpResumeAttempt(_ generation: Int) {
        guard generation == resumeGeneration else { return }
        guard interruptHold, resumeSource != nil, !userPaused, !phoneBusy() else {
            resumeAttemptsRunning = false
            return
        }
        resumeAttempt += 1
        resumeRecordingAfterInterrupt()
        guard generation == resumeGeneration else { return }
        if resumeAttempt >= 21 {
            resumeAttemptsRunning = false
            logState("resume attempts exhausted")
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.pumpResumeAttempt(generation)
        }
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

    /// 其他 App 此刻是否真的在出声。只看 isOtherAudioPlaying：
    /// secondaryAudio 提示在飞书挂断后会残留，拿来当「通话还没结束」会把恢复一直卡住。
    private func otherAppPlaying() -> Bool {
        return AVAudioSession.sharedInstance().isOtherAudioPlaying
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
            var options: AVAudioSession.CategoryOptions = [.defaultToSpeaker]
            if UserDefaults.standard.bool(forKey: "NuwaxVoiceNoteMixWithOthers") {
                options.insert(.mixWithOthers)
            }
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: options
            )
            try session.setActive(true)
            return true
        } catch {
            lastError = "音频会话失败"
            let failure = error as NSError
            NSLog("[voice-note] m4a session activation failed domain=%@ code=%ld", failure.domain, failure.code)
            return false
        }
    }

    private func openRecorder(_ path: String) -> Bool {
        let holding = keepAliveForInterrupt
        _ = closeRecorder()
        if writeRecorder(path, bitRate: 64000) {
            keepAliveForInterrupt = false
            return true
        }
        try? FileManager.default.removeItem(atPath: path)
        if writeRecorder(path, bitRate: 0) {
            keepAliveForInterrupt = false
            return true
        }
        try? FileManager.default.removeItem(atPath: path)
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
            // 音量为 0 时系统不把它当成正在播放，飞书挂断后不会在后台唤醒。波形本身很小，听不到，也不会写进 m4a。
            silencePlayer?.volume = 1
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
        observeStoppedRecorder()
        observeSystemCallEnd()
        if silencePlayer?.isPlaying != true && !phoneBusy() {
            _ = silencePlayer?.play()
        }
    }

    /// 麦克风还在自己手里时，接着写已经打开的文件。
    /// 已经 stop() 过的录音器不能再 record()，那会从文件头覆盖接通前的内容。
    private func continueSameFile() -> Bool {
        guard let recorder = recorder, !currentPath.isEmpty else {
            return false
        }
        if recorder.isRecording {
            return true
        }
        if !activateSession() {
            return false
        }
        if recorder.record() {
            recorder.isMeteringEnabled = true
            return true
        }
        return false
    }

    private func startWatchTimer() {
        if watchTimer != nil {
            return
        }
        let timer = Timer(timeInterval: 0.4, repeats: true) { [weak self] _ in
            self?.observeStoppedRecorder()
        }
        RunLoop.main.add(timer, forMode: .common)
        watchTimer = timer
    }

    private func clearThirdPartyWatch() {
        thirdPartySuspect = false
        watchTimer?.invalidate()
        watchTimer = nil
    }

    private func sampleRecordingDuration() {
        if let recorder, recorder.isRecording {
            lastRecordingDurationMs = max(lastRecordingDurationMs, Int(recorder.currentTime * 1000))
        }
    }

    private func observeStoppedRecorder() {
        guard !userPaused, !interruptHold, let recorder else { return }
        if recorder.isRecording {
            sampleRecordingDuration()
            return
        }
        let isPhone = phoneBusy()
        guard thirdPartySuspect || isPhone || Date() >= ignoreBeganUntil else { return }
        sealActiveFileForInterrupt(isPhone: isPhone)
    }

    /// 打断时在原生封口，不依赖面板轮询。
    private func sealActiveFileForInterrupt(isPhone: Bool) {
        guard !interruptHold else { return }
        beginWake()
        cancelResume()
        interruptHold = true
        holdIsPhone = isPhone
        interruptBeganAt = Date()
        heldPath = currentPath
        let eligible = interruptionUpload?.path == heldPath ? interruptionUpload : nil
        if closeRecorder() == "1", let eligible {
            VoiceNoteBackgroundUploader.shared.enqueue(eligible)
        }
        heldDurationMs = lastClosedDurationMs
        keepAliveForInterrupt = true
        clearThirdPartyWatch()
        startSilence()
        pushEvent("began|\(Int(interruptBeganAt.timeIntervalSince1970 * 1000))")
        logState("sealed for interruption")
    }

    /// 在挂断回调里直接开下一段。这时页面定时器通常是停的。
    private func resumeRecordingAfterInterrupt() {
        guard interruptHold, resumeSource != nil, !userPaused, !phoneBusy(),
              resumeCandidatePath.isEmpty, recorder?.isRecording != true else { return }
        guard !segmentLocalId.isEmpty else { return }
        if !holdIsPhone && otherAppPlaying() {
            logState("resume deferred: other app still playing")
            return
        }
        beginWake()
        ignoreBeganUntil = Date().addingTimeInterval(1.5)
        logState("resume after interruption attempt")
        guard activateSession() else {
            NSLog("[voice-note] resume failed: audio session not active")
            lastError = "音频会话未激活"
            keepAliveForInterrupt = true
            startSilence()
            return
        }
        // 别的 App 还在出声时不要建文件。会话激活成功也不代表麦克风已经回到自己手里。
        if !holdIsPhone && otherAppPlaying() {
            logState("resume skipped: other app still playing")
            keepAliveForInterrupt = true
            startSilence()
            return
        }
        if resumeKey.isEmpty {
            let stamp = Int(Date().timeIntervalSince1970 * 1000)
            let indexName = segmentIndexName.isEmpty ? "c\(stamp)" : "\(segmentIndexName)c\(stamp)"
            resumeKey = "\(segmentLocalId)|\(indexName)"
        }
        guard let path = preparePath(resumeKey) else {
            NSLog("[voice-note] resume failed: bad path")
            return
        }
        if openRecorder(path) {
            resumeCandidatePath = path
            verifyInterruptResume(path, generation: resumeGeneration, remainingChecks: 4)
            return
        }
        NSLog("[voice-note] resume failed: recorder did not start")
        if lastError.isEmpty {
            lastError = "录音器未能开始"
        }
        keepAliveForInterrupt = true
        startSilence()
    }

    private func verifyInterruptResume(_ path: String, generation: Int, remainingChecks: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, generation == self.resumeGeneration, self.interruptHold, !self.userPaused,
                  self.resumeCandidatePath == path, self.currentPath == path else { return }
            if self.phoneBusy() || (!self.holdIsPhone && self.otherAppPlaying()) {
                self.cancelResume()
                self.logState("resume candidate interrupted")
            } else if let recorder = self.recorder, recorder.isRecording, recorder.currentTime > 0 {
                self.sampleRecordingDuration()
                self.finishInterruptResume()
            } else if remainingChecks > 1 {
                self.verifyInterruptResume(path, generation: generation, remainingChecks: remainingChecks - 1)
            } else {
                self.logState("resume candidate produced no samples")
                _ = self.closeRecorder()
                self.resumeKey = ""
            }
        }
    }

    private func finishInterruptResume() {
        cancelResume(closeCandidate: false)
        interruptHold = false
        holdIsPhone = false
        heldPath = ""
        heldDurationMs = 0
        keepAliveForInterrupt = false
        clearThirdPartyWatch()
        suppressBeganUntil = Date().addingTimeInterval(1.2)
        startSilence()
        endWake()
        pushEvent("ended")
        let firstSampleEstimate = Int(Date().timeIntervalSince1970 * 1000) - lastRecordingDurationMs
        logState("resumed after interruption recordedMs=\(lastRecordingDurationMs) firstSampleEstimateEpochMs=\(firstSampleEstimate)")
    }

    private func beginWake() {
        if wakeTask != .invalid {
            return
        }
        wakeTask = UIApplication.shared.beginBackgroundTask(withName: "voice-note-call") { [weak self] in
            self?.logState("interruption background task expired")
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
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("voice-note-keepalive.wav")
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
        for i in 0..<sampleCount {
            let sample: Int16 = (i % 2 == 0) ? 24 : -24
            appendU16(UInt16(bitPattern: sample))
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
        let session = AVAudioSession.sharedInstance()
        if !session.isInputAvailable {
            lastError = "麦克风不可用"
            NSLog("[voice-note] m4a record skipped: input unavailable path=\(path)")
            return false
        }
        do {
            let next = try AVAudioRecorder(url: URL(fileURLWithPath: path), settings: settings)
            let prepared = next.prepareToRecord()
            if !prepared || !next.record() {
                lastError = "录音器未能开始"
                NSLog("[voice-note] m4a record() failed prepared=\(prepared) category=\(session.category.rawValue) permission=\(session.recordPermission.rawValue) input=\(session.isInputAvailable) bitRate=\(bitRate) path=\(path)")
                next.stop()
                try? FileManager.default.removeItem(atPath: path)
                return false
            }
            lastError = ""
            next.isMeteringEnabled = true
            recorder = next
            currentPath = path
            lastRecordingDurationMs = 0
            lastOpenedAt = max(Date(), lastOpenedAt.addingTimeInterval(0.001))
            VoiceNoteRecordingFiles.remember(path, openedAt: lastOpenedAt)
            NSLog("[voice-note] m4a writing localId=%@ file=%@", segmentLocalId, URL(fileURLWithPath: path).lastPathComponent)
            return true
        } catch {
            lastError = "创建录音文件失败"
            NSLog("[voice-note] m4a recorder failed \(error.localizedDescription)")
            try? FileManager.default.removeItem(atPath: path)
            return false
        }
    }

    /// 停掉录音器并写完 m4a。没有正在写的文件返回 "1"；文件仍是 0 字节返回 "0"。
    private func closeRecorder() -> String {
        let path = currentPath
        let current = recorder
        if let current = current {
            lastClosedDurationMs = max(Int(current.currentTime * 1000), lastRecordingDurationMs)
            current.stop()
        }
        recorder = nil
        lastRecordingDurationMs = 0
        currentPath = ""
        interruptionUpload = nil
        resumeCandidatePath = ""
        if path.isEmpty {
            return "1"
        }
        let attrs = try? FileManager.default.attributesOfItem(atPath: path)
        let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
        if attrs != nil && (size == 0 || VoiceNoteM4aSeal.hasNoMedia(path)) {
            try? FileManager.default.removeItem(atPath: path)
            VoiceNoteRecordingFiles().acknowledge(path)
            lastClosedDurationMs = 0
            lastError = "录音文件是空的"
            NSLog("[voice-note] m4a closed empty \(path)")
            return "0"
        }
        VoiceNoteRecordingFiles.remember(path, durationMs: lastClosedDurationMs > 0 ? lastClosedDurationMs : nil, closed: true)
        NSLog("[voice-note] recording closed bytes=%ld recorderMs=%ld", size, lastClosedDurationMs)
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
            return (dir as NSString).appendingPathComponent("\(indexName)-\(UUID().uuidString).m4a")
        }
        return path
    }

    private func sanitize(_ raw: String) -> String {
        return raw.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "..", with: "_")
    }
}
