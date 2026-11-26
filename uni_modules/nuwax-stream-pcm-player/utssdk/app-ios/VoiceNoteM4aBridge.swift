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
    /// 这次打断里离开过前台。回到录音页时即使没有挂断通知，也要继续录。
    private var resignedDuringHold = false
    /// 这次打断开始时（或第一次被发现时）App 已经在后台。飞书在后台挂断常常不再补 ended，
    /// 只有「后台打断」允许回到前台后按挂断处理；前台打断仍只认系统 ended，避免通话中把计时打开。
    private var holdInBackground = false
    /// 录音期间退过后台。录音器在后台被系统悄悄停掉时，用来判断这是一次后台打断。
    private var backgroundedWhileRecording = false
    /// 最近一次看到其他 App 还在出声的时间。后台打断靠它确认通话真的结束，避免刚挂断就又去抢会话。
    private var otherAudioSeenAt = Date.distantPast
    /// 飞书、微信的来电通知。这时麦克风未必被拿走，先观察，占稳了再暂停。
    private var thirdPartySuspect = false
    /// 开始观察第三方来电的时间。前 0.8 秒不探麦克风，避免系统电话的通话列表还没更新就被探开。
    private var suspectStartedAt = Date.distantPast
    /// 麦克风连续被第三方占住的起点。没接听的铃声通常占不住这么久。
    private var micOccupiedSince: Date?
    /// 第三方通话里，其他 App 连续不再出声的起点。稳定后再尝试续录。
    private var micFreeSince: Date?
    /// 已经看到过通话出声、收到挂断或路由切回。没有这个标记时不尝试开麦，避免通话静音间隙把录音打开。
    private var micProbeArmed = false
    /// 飞书占麦和挂断都靠它观察。系统电话不走这个定时器。
    private var watchTimer: Timer?
    private var resignObserver: NSObjectProtocol?
    private var activeObserver: NSObjectProtocol?
    private var backgroundObserver: NSObjectProtocol?
    /// 不设置 delegate 时 calls 一直是空的，系统电话会被当成已经挂断。
    private let callWatch = CallWatch()
    private let callObserver = CXCallObserver()
    private var terminateObserver: NSObjectProtocol?
    private var routeObserver: NSObjectProtocol?
    /// 接通时先准备好下一段。挂断后在后台只调用 record()，避免重新创建录音器被系统拒绝。
    private var armedRecorder: AVAudioRecorder?
    private var armedPath = ""
    private var resumeAttempt = 0
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
        routeObserver = center.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: AVAudioSession.sharedInstance(),
            queue: nil
        ) { [weak self] _ in
            self?.handleRouteChange()
        }
        UIApplication.shared.beginReceivingRemoteControlEvents()
        resignObserver = center.addObserver(
            forName: UIApplication.willResignActiveNotification,
            object: nil,
            queue: nil
        ) { [weak self] _ in
            self?.noteLeftForeground()
        }
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
        if let observer = interruptObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = terminateObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = routeObserver {
            NotificationCenter.default.removeObserver(observer)
        }
        if let observer = resignObserver {
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
        // 系统电话没挂断、或飞书还占着麦克风时，不能开下一段。
        if phoneBusy() || (interruptHold && !holdIsPhone) || (interruptHold && !interruptEnded) {
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
            holdInBackground = false
            backgroundedWhileRecording = false
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
            holdInBackground = false
            backgroundedWhileRecording = false
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
            self.holdInBackground = false
            self.backgroundedWhileRecording = false
            self.keepAliveForInterrupt = false
            self.pendingEvents.removeAll()
            self.armedRecorder?.stop()
            self.armedRecorder = nil
            self.armedPath = ""
            self.resignedDuringHold = false
            self.clearThirdPartyWatch()
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
            if self.otherAppPlaying() {
                self.otherAudioSeenAt = Date()
            }
            // 录音器一直在正常录，说明之前那次退后台和这次打断无关。
            if self.recorder?.isRecording == true && UIApplication.shared.applicationState == .active {
                self.backgroundedWhileRecording = false
            }
            // 电话进来时经常没有 interruption 通知，录音器已经被系统停掉。页面仍在计时。
            // 只有系统电话在这里立刻暂停。飞书来电先观察麦克风，占稳了再暂停。
            let ready = Date() >= self.ignoreBeganUntil || self.sessionBusy()
            if !self.userPaused && !self.interruptHold && !self.currentPath.isEmpty && ready {
                if let recorder = self.recorder, !recorder.isRecording {
                    if self.phoneBusy() {
                        self.interruptBeganAt = Date()
                        self.sealActiveFileForInterrupt()
                        self.pushEvent("began")
                        self.logState("m4a recorder stopped without interruption")
                    } else {
                        self.noteThirdPartySuspect()
                    }
                }
            }
            if self.interruptHold && self.phoneBusy() {
                self.holdIsPhone = true
            }
            // 只有系统电话才在通话列表变空时补一次结束。飞书不走这里。
            if self.interruptHold && self.holdIsPhone && self.interruptGraceDone() && !self.phoneBusy() {
                self.interruptEnded = true
                self.resumeRecordingAfterInterrupt()
                self.pushEvent("ended")
            }
            if self.holdIsPhone {
                // 后台打断经常收不到 ended，回到前台后按挂断处理，让下面的恢复流程去探麦克风。
                self.adoptBackgroundHoldEndIfReady()
                // 挂断通知已经到了，但当时在后台没能开录。回到前台再试一次。通话未结束不能试。
                if self.interruptHold && self.interruptEnded && self.returnedToForeground() && !self.phoneBusy() {
                    if !self.holdInBackground || !self.otherAppPlaying() {
                        self.resumeRecordingAfterInterrupt()
                        self.pushEvent("ended")
                    }
                }
            } else {
                self.watchThirdPartyAudio()
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

    /// 打断期间离开过界面，并且现在已经回到前台。后台打断来不及标 resigned 时也算回来过。
    private func returnedToForeground() -> Bool {
        guard UIApplication.shared.applicationState == .active else {
            return false
        }
        return resignedDuringHold || holdInBackground
    }

    private func noteLeftForeground() {
        onMainVoid {
            if self.interruptHold {
                self.resignedDuringHold = true
            }
        }
    }

    /// 退到后台。录音器在后台被系统停掉时，这里留下「在后台录过」的标记，回到前台才知道要补一次结束。
    private func noteEnteredBackground() {
        onMainVoid {
            if self.recorder?.isRecording == true || !self.currentPath.isEmpty {
                self.backgroundedWhileRecording = true
            }
            if self.interruptHold {
                self.resignedDuringHold = true
            }
            self.logState("entered background")
        }
    }

    private func noteBecameActive() {
        onMainVoid {
            self.logState("became active")
            if self.holdIsPhone {
                self.adoptBackgroundHoldEndIfReady()
                self.resumeAfterReturning()
                return
            }
            self.watchThirdPartyAudio()
        }
    }

    /// 挂断通知到了但后台没开成。回到前台再试。人还在通话里时不能因为回到页面就继续计时。
    private func resumeAfterReturning() {
        guard interruptHold, interruptEnded, returnedToForeground(), !userPaused, !phoneBusy() else {
            return
        }
        scheduleResumeAttempts()
        pushEvent("ended")
    }

    /// 后台打断时飞书常常不再补 ended。回到前台、其他音频已经安静下来后，按挂断处理，
    /// 让后面的恢复流程去试麦克风。前台打断不在这里放行，避免通话没挂断就把计时和波浪又打开。
    private func adoptBackgroundHoldEndIfReady() {
        guard interruptHold, !interruptEnded, holdInBackground, !userPaused, !phoneBusy() else {
            return
        }
        if otherAppPlaying() {
            otherAudioSeenAt = Date()
            return
        }
        guard returnedToForeground(), interruptGraceDone() else {
            return
        }
        // 通话中的安静间隙不算结束，要连续 2 秒没有其他音频才认。
        guard Date().timeIntervalSince(otherAudioSeenAt) >= 2.0 else {
            return
        }
        interruptEnded = true
        pushEvent("ended")
        NSLog("[voice-note] background hold: no ended notification, treating call as finished")
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
            "[voice-note] \(tag) app=\(app) hold=\(interruptHold) ended=\(interruptEnded) bgHold=\(holdInBackground) resigned=\(resignedDuringHold) userPaused=\(userPaused) recording=\(recording) armed=\(armedRecorder != nil) phone=\(phoneBusy()) other=\(otherAudioBusy()) playing=\(otherAppPlaying()) path=\(path)"
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
        beginWake()
        if type == .began {
            logState("interruption began notification")
            guard recorder != nil, !currentPath.isEmpty else {
                logState("interruption began ignored: no active file")
                return
            }
            // 开录时会话激活会自己发一次中断。真有电话或语音占用时不能忽略。
            if userPaused {
                logState("interruption began ignored: user paused")
                return
            }
            if Date() < suppressBeganUntil {
                logState("interruption began ignored: suppressed")
                return
            }
            if Date() < ignoreBeganUntil && !sessionBusy() {
                logState("interruption began ignored: session idle")
                return
            }
            if phoneBusy() {
                if !interruptHold {
                    interruptBeganAt = Date()
                }
                // 系统电话立刻停。只 pause 的话，通话期间文件时间轴还在长。
                sealActiveFileForInterrupt()
                pushEvent("began")
                return
            }
            // 飞书来电先不暂停。麦克风被连续占住后，下面的观察才会停计时和波浪。
            if interruptHold {
                micFreeSince = nil
                return
            }
            noteThirdPartySuspect()
            return
        }
        silencePlayer?.play()
        logState("interruption ended notification")
        if phoneBusy() || holdIsPhone {
            guard interruptHold else {
                return
            }
            NSLog("[voice-note] interruption ended")
            interruptEnded = true
            if !phoneBusy() {
                scheduleResumeAttempts()
            }
            pushEvent("ended")
            return
        }
        if !interruptHold {
            // 铃声结束，麦克风没有被占住。继续原来的文件，页面不进入暂停。
            if continueCurrentRecorder() {
                clearThirdPartyWatch()
            }
            return
        }
        NSLog("[voice-note] interruption ended")
        interruptEnded = true
        micProbeArmed = true
        if !otherAppPlaying() {
            micFreeSince = Date().addingTimeInterval(-1.2)
        }
        watchThirdPartyAudio()
    }

    /// 已经收到挂断后，路由切回本机时再试一次。接通过程中的路由变化不能当成挂断。
    private func handleRouteChange() {
        if Thread.isMainThread {
            resumeIfRouteFree()
            return
        }
        DispatchQueue.main.sync {
            self.resumeIfRouteFree()
        }
    }

    private func resumeIfRouteFree() {
        if !holdIsPhone && !phoneBusy() {
            if interruptHold && !otherAppPlaying() {
                micProbeArmed = true
            }
            watchThirdPartyAudio()
            return
        }
        adoptBackgroundHoldEndIfReady()
        guard interruptHold, interruptEnded, !userPaused, !phoneBusy(), !otherAudioBusy() else {
            return
        }
        resumeRecordingAfterInterrupt()
    }

    private func scheduleResumeAttempts() {
        resumeAttempt = 0
        pumpResumeAttempt()
    }

    private func pumpResumeAttempt() {
        guard interruptHold, interruptEnded, !userPaused, !phoneBusy() else {
            return
        }
        resumeRecordingAfterInterrupt()
        if !interruptHold || resumeAttempt >= 20 {
            return
        }
        resumeAttempt += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0) { [weak self] in
            self?.pumpResumeAttempt()
        }
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
        guard keepAliveForInterrupt || silencePlayer != nil else {
            return
        }
        if otherAppPlaying() {
            otherAudioSeenAt = Date()
        }
        if !holdIsPhone && !phoneBusy() {
            watchThirdPartyAudio()
        } else {
            // 系统电话：后台打断收不到 ended 时，回到前台靠这里补一次结束。
            adoptBackgroundHoldEndIfReady()
        }
        if silencePlayer?.isPlaying != true && !phoneBusy() {
            _ = silencePlayer?.play()
        }
        // 系统电话只有挂断之后才试。飞书由上面的麦克风观察决定，不在这里重试。
        guard holdIsPhone, interruptHold, interruptEnded, !userPaused, !phoneBusy() else {
            return
        }
        let holding = interruptHold
        resumeRecordingAfterInterrupt()
        if holding && !interruptHold {
            pushEvent("ended")
        }
    }

    /// 飞书、微信来电。先不暂停，等麦克风真的被占住。
    private func noteThirdPartySuspect() {
        if userPaused || interruptHold || phoneBusy() || currentPath.isEmpty {
            return
        }
        if !thirdPartySuspect {
            thirdPartySuspect = true
            suspectStartedAt = Date()
            micOccupiedSince = nil
            logState("third-party audio, waiting until microphone is held")
        }
        beginWake()
        startWatchTimer()
    }

    /// 麦克风还在自己手里时接着写原文件。已经封口的文件不会走到这里。
    private func continueCurrentRecorder() -> Bool {
        guard let recorder = recorder, !currentPath.isEmpty else {
            return false
        }
        if recorder.isRecording {
            return true
        }
        guard activateSession() else {
            return false
        }
        return recorder.record()
    }

    /// 激活自己的录音会话失败，说明麦克风被其他 App 占着。
    private func microphoneAvailable() -> Bool {
        let session = AVAudioSession.sharedInstance()
        if !session.isInputAvailable {
            return false
        }
        return activateSession()
    }

    private func startWatchTimer() {
        if watchTimer != nil {
            return
        }
        let timer = Timer(timeInterval: 0.4, repeats: true) { [weak self] _ in
            self?.watchThirdPartyAudio()
        }
        RunLoop.main.add(timer, forMode: .common)
        watchTimer = timer
    }

    private func clearThirdPartyWatch() {
        thirdPartySuspect = false
        micOccupiedSince = nil
        micFreeSince = nil
        micProbeArmed = false
        watchTimer?.invalidate()
        watchTimer = nil
    }

    /// 飞书占麦后暂停，挂断后前台和后台都续。系统电话不进这里。
    private func watchThirdPartyAudio() {
        if userPaused || holdIsPhone {
            if holdIsPhone {
                watchTimer?.invalidate()
                watchTimer = nil
            }
            return
        }
        if phoneBusy() {
            if !interruptHold && !currentPath.isEmpty && recorder?.isRecording != true {
                thirdPartySuspect = false
                micOccupiedSince = nil
                interruptBeganAt = Date()
                sealActiveFileForInterrupt()
                pushEvent("began")
                logState("phone appeared while watching third-party audio")
            }
            return
        }
        if !interruptHold {
            guard thirdPartySuspect else {
                if watchTimer != nil && micFreeSince == nil {
                    clearThirdPartyWatch()
                }
                return
            }
            if recorder?.isRecording == true {
                clearThirdPartyWatch()
                return
            }
            // 给系统电话留出进入通话列表的时间，这段时间不抢会话。
            if Date().timeIntervalSince(suspectStartedAt) < 0.8 {
                return
            }
            if microphoneAvailable() && continueCurrentRecorder() {
                clearThirdPartyWatch()
                logState("microphone still ours, keep recording")
                return
            }
            if micOccupiedSince == nil {
                micOccupiedSince = Date()
            }
            if Date().timeIntervalSince(micOccupiedSince!) >= 1.0 {
                thirdPartySuspect = false
                micOccupiedSince = nil
                interruptBeganAt = Date()
                sealActiveFileForInterrupt()
                pushEvent("began")
                logState("microphone held, pause")
            }
            return
        }
        if otherAppPlaying() {
            micFreeSince = nil
            micProbeArmed = true
            return
        }
        if !micProbeArmed {
            return
        }
        if micFreeSince == nil {
            micFreeSince = Date()
            return
        }
        if Date().timeIntervalSince(micFreeSince!) < 1.2 {
            return
        }
        micProbeArmed = false
        micFreeSince = nil
        resumeRecordingAfterInterrupt()
        if interruptHold {
            keepAliveForInterrupt = true
            startSilence()
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
        let state = UIApplication.shared.applicationState
        if state == .background || backgroundedWhileRecording {
            // 后台里被打断（或回到前台才发现被打断）：飞书不会补 ended，恢复要靠回到前台后试探麦克风。
            holdInBackground = true
        }
        if state != .active {
            resignedDuringHold = true
        }
        keepAliveForInterrupt = true
        armNextRecorder()
        startSilence()
        if !holdIsPhone {
            startWatchTimer()
        }
        NSLog("[voice-note] interruption began")
        logState("sealed for interruption")
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
        beginWake()
        ignoreBeganUntil = Date().addingTimeInterval(1.5)
        logState("resume after interruption attempt")
        // 后台里重新设置会话类别经常失败。先直接启动接通前准备好的录音器。
        if let armed = armedRecorder, !armedPath.isEmpty {
            try? AVAudioSession.sharedInstance().setActive(true)
            if armed.record() {
                recorder = armed
                currentPath = armedPath
                armedRecorder = nil
                armedPath = ""
                finishInterruptResume(currentPath)
                return
            }
            NSLog("[voice-note] armed recorder refused to start")
        }
        guard activateSession() else {
            NSLog("[voice-note] resume failed: audio session not active")
            lastError = "音频会话未激活"
            keepAliveForInterrupt = true
            startSilence()
            return
        }
        if let armed = armedRecorder, !armedPath.isEmpty, armed.record() {
            recorder = armed
            currentPath = armedPath
            armedRecorder = nil
            armedPath = ""
            finishInterruptResume(currentPath)
            return
        }
        armedRecorder?.stop()
        armedRecorder = nil
        armedPath = ""
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
            finishInterruptResume(path)
            return
        }
        NSLog("[voice-note] resume failed: recorder did not start")
        if lastError.isEmpty {
            lastError = "录音器未能开始"
        }
        keepAliveForInterrupt = true
        startSilence()
    }

    /// 接通后先建好下一段，挂断回调里就不用再创建录音器。
    private func armNextRecorder() {
        if armedRecorder != nil {
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
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000
        ]
        guard let next = try? AVAudioRecorder(url: URL(fileURLWithPath: path), settings: settings) else {
            return
        }
        if next.prepareToRecord() {
            armedRecorder = next
            armedPath = path
            return
        }
        next.stop()
    }

    private func finishInterruptResume(_ path: String) {
        resumeKey = ""
        interruptHold = false
        holdIsPhone = false
        interruptEnded = false
        resignedDuringHold = false
        holdInBackground = false
        backgroundedWhileRecording = false
        userPaused = false
        keepAliveForInterrupt = false
        clearThirdPartyWatch()
        suppressBeganUntil = Date().addingTimeInterval(1.2)
        startSilence()
        armNextRecorderLater()
        endWake()
        pushEvent("ended")
        NSLog("[voice-note] resumed after interruption \(path)")
        logState("resumed after interruption")
    }

    /// 录音已经开始后再准备下一段，避免和当前录音器抢会话。
    private func armNextRecorderLater() {
        DispatchQueue.main.async { [weak self] in
            self?.armNextRecorder()
        }
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
