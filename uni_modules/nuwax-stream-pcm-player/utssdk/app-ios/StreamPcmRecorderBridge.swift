//
//  StreamPcmRecorderBridge.swift
//  App-iOS 原生录音桥：AVAudioEngine inputNode tap 采 16kHz mono PCM16 → 写临时文件 + 实时帧入队。
//  与 StreamPcmPlayerBridge.swift 定位一致：UTS 侧 20ms 轮询拉取（纯拉取式，无 UTS 回调闭包），
//  PCM 帧走 base64 字符串跨桥（Uint8Array 跨桥当 model 解析会崩）。
//
import AVFoundation
import Foundation

public class StreamPcmRecorderBridge {
    private var engine: AVAudioEngine?
    private var fileHandle: FileHandle?
    private var filePath: String = ""
    private let lock = NSLock()
    private var pendingChunks: [Data] = []
    /** 实时帧队列上限（约 1000 帧 × ~3200B ≈ 3.2MB ≈ 100s）：超限丢最旧（文件兜底保证正确性） */
    private let maxPendingChunks = 1000
    private var recordedBytes: Int = 0
    private var running = false
    /** 引擎已启动且首帧已到（UTS 据此回传 onStart） */
    private var started = false
    /** 已正常收尾（松手 / 时长到 / 中断），UTS 据此回传 onStop */
    private var stopped = false
    private var errorMessage = ""
    private var durationTimer: Timer?
    private var observersAdded = false
    /** 麦克风授权：是否已发起请求 / 是否已出结果 / 是否已授权（iOS 每安装仅弹一次系统授权窗） */
    private var permissionRequested = false
    private var permissionResolvedFlag = false
    private var permissionGrantedFlag = false
    /** 诊断行缓冲：Swift NSLog 不进 App 日志（HX logcat 只收 UTS console），诊断改经 takeDiag 由 UTS 轮询拉取 */
    private var diagLines: [String] = []
    /** 首帧诊断只记一次（避免每个 tap buffer 刷屏） */
    private var diagFirstFrameLogged = false
    /** 启动窗口截止：start 后 ~3s 内的 interruption 视为会话激活的系统自惹事件，一律忽略
     *  （真机实测：无论 isOtherAudioPlaying 真假，start 后约 1s 必来一次 .began） */
    private var interruptSuppressDeadline: Date?
    /** 已配成 playAndRecord 并激活过：后续 start 跳过 deactivate / setActive，避免自惹 interruption */
    private var sessionWarmed = false
    /** prepareSession 正在空跑 engine，等首帧后停引擎、保留 session */
    private var priming = false
    /** IO 已空跑出过首帧：用户按下后的 engine.start 是「第二次」，首帧应立即到达 */
    private var ioPrimed = false

    public init() {}

    // ==================== 诊断（UTS 轮询拉取） ====================

    private func appendDiag(_ line: String) {
        lock.lock()
        diagLines.append(line)
        if diagLines.count > 60 { diagLines.removeFirst() }
        lock.unlock()
    }

    /// 拉取并清空诊断行（调用方不应持有 lock）
    public func takeDiag() -> String {
        lock.lock()
        defer { lock.unlock() }
        let joined = diagLines.joined(separator: "\n")
        diagLines.removeAll()
        return joined
    }

    /// 引擎是否仍在运行（UTS 诊断用）
    public func isRunningNow() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return running
    }

    // ==================== UTS 拉取 API ====================

    public func isRecording() -> Bool {
        return running && started && !stopped
    }

    public func hasStarted() -> Bool {
        return started
    }

    /// 已停止且曾真正开录：UTS 据此回传 onStop（stop 早于首帧不发，避免空文件推 ASR）
    public func hasStopped() -> Bool {
        return stopped
    }

    public func hasPendingChunk() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return !pendingChunks.isEmpty
    }

    /// 取出一帧 base64 编码的 PCM16 字节；无帧返回 ""
    public func takePendingChunk() -> String {
        lock.lock()
        defer { lock.unlock() }
        guard !pendingChunks.isEmpty else { return "" }
        let data = pendingChunks.removeFirst()
        return data.base64EncodedString()
    }

    /// 取错误消息（消费一次）；无错误返回 ""
    public func takeError() -> String {
        lock.lock()
        defer { lock.unlock() }
        let msg = errorMessage
        errorMessage = ""
        return msg
    }

    public func stopFilePath() -> String {
        return filePath
    }

    public func stopByteLength() -> NSNumber {
        return NSNumber(value: recordedBytes)
    }

    /// 当前已采字节数（UTS 轮询拉取：tap 断流自愈检测用，bytes 长时间不涨 = tap 静默断流）。
    /// 注意：不能叫 recordedBytes()——与私有属性 recordedBytes 同名在 UTS→ObjC 桥接层
    /// 会生成重复 selector（属性 getter + 方法都映射为 recordedBytes）报 redeclaration。
    public func currentRecordedBytes() -> NSNumber {
        lock.lock()
        defer { lock.unlock() }
        return NSNumber(value: recordedBytes)
    }

    // ==================== 控制 ====================

    /// 开始录音（时长固定 600000ms = UTS 侧默认/上限）。
    /// 无参跨桥：uni-app x UTS→Swift 桥对 RecorderManagerStartOptions 对象与 number 参数
    /// 的转换不可靠（曾致 startByJs 恒报 method call failed、Swift start 从未进入），
    /// 去掉全部参数即无转换可失败。
    public func start() {
        NSLog("[PCMRec] start() called")
        appendDiag("start() called")
        // 复用实例：先收尾旧轮（不回传旧 stopped，避免污染新会话）
        finishInternal()
        lock.lock()
        pendingChunks.removeAll()
        errorMessage = ""
        recordedBytes = 0
        lock.unlock()
        started = false
        stopped = false
        diagFirstFrameLogged = false
        priming = false

        configureSession()
        addObservers()
        openRecordFile()
        startEngineAndTap()
        if !running {
            return
        }
        // 时长固定 600000ms（10 分钟，对齐 UTS 侧默认值与上限）
        let durationMs: Double = 600000
        if durationMs > 0 {
            let t = Timer(timeInterval: durationMs / 1000.0, repeats: false) { [weak self] _ in
                self?.finishInternal()
            }
            RunLoop.main.add(t, forMode: .common)
            durationTimer = t
        }
    }

    /// 页面进入时预热：bounce 一次 session，并空跑 engine 直到首帧。
    /// 把「第一次 engine.start 必自惹 interruption、首帧晚 1s」消耗在进页阶段；
    /// 用户按下时只重新挂 tap，对齐 Android/鸿蒙按下即采。
    public func prepareSession() {
        appendDiag("prepareSession")
        configureSession()
        addObservers()
        if ioPrimed || priming || running {
            appendDiag("prepareSession skip prime (already primed/running)")
            return
        }
        priming = true
        startEngineAndTap()
        appendDiag("prepareSession priming engine")
    }

    /// 停止录音（松手 / 上层 discard）：收尾但保留已采尾帧，UTS 轮询拉完后回传 onStop
    public func stop() {
        finishInternal()
    }

    /// 释放（页面销毁 / 弃用）：不回传 onStop
    public func release() {
        finishInternal()
        lock.lock()
        pendingChunks.removeAll()
        lock.unlock()
        removeObservers()
    }

    // ==================== 麦克风授权（首次按下主动请求） ====================

    /// 主动请求麦克风权限：iOS 17+ 用 AVAudioApplication，旧版本用 AVAudioSession。
    /// 结果经 permissionResolved() / permissionGranted() 拉取（与现有 UTS 轮询模式一致）。
    /// 每安装仅弹一次系统授权窗；已确定（授权/拒绝）后直接回结果不再弹窗。
    public func requestRecordPermission() {
        lock.lock()
        guard !permissionRequested else {
            lock.unlock()
            return
        }
        permissionRequested = true
        lock.unlock()
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission { [weak self] granted in
                self?.setPermissionResult(granted)
            }
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
                self?.setPermissionResult(granted)
            }
        }
    }

    /// 系统授权是否已出结果（用户已应答 / 状态已确定）
    public func permissionResolved() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return permissionResolvedFlag
    }

    /// 授权结果：true 已授权 / false 拒绝（仅在 permissionResolved() 后有效）
    public func permissionGranted() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return permissionGrantedFlag
    }

    private func setPermissionResult(_ granted: Bool) {
        lock.lock()
        permissionGrantedFlag = granted
        permissionResolvedFlag = true
        lock.unlock()
    }

    // ==================== 内部 ====================

    /// tap 回调（音频渲染线程）：硬件格式 → 16kHz mono Int16，写文件 + 入队（NSLock 保护）
    private func handleTap(_ buffer: AVAudioPCMBuffer) {
        guard running else { return }
        if priming {
            priming = false
            ioPrimed = true
            appendDiag("prime first frame, io primed")
            NSLog("[PCMRec] prime first frame, io primed")
            DispatchQueue.main.async { [weak self] in
                guard let self = self else { return }
                // 用户若已正式 start（有文件句柄），不要停掉正在录的引擎
                if self.fileHandle == nil && self.running {
                    self.running = false
                    self.started = false
                    self.stopEngineOnly()
                }
            }
            return
        }
        let pcm16 = convertToPcm16Mono16k(buffer)
        guard !pcm16.isEmpty else { return }
        let byteCount = pcm16.count * 2
        let data = Data(bytes: pcm16, count: byteCount)
        // 写文件（仅 tap 线程写，无锁竞争）
        fileHandle?.write(data)
        lock.lock()
        recordedBytes += byteCount
        if pendingChunks.count < maxPendingChunks {
            pendingChunks.append(data)
        } else {
            pendingChunks.removeFirst()
            pendingChunks.append(data)
        }
        if !started {
            started = true
            ioPrimed = true
            NSLog("[PCMRec] first tap frame received")
        }
        lock.unlock()
        if started && diagFirstFrameLogged != true {
            diagFirstFrameLogged = true
            appendDiag("first tap frame received")
        }
    }

    /// 任意采样率/格式 → 16kHz mono Int16（线性插值重采样；支持 Float32/Int16 输入与任意采样率比）。
    /// 只取第一声道；多声道输入丢弃其余声道。
    private func convertToPcm16Mono16k(_ buffer: AVAudioPCMBuffer) -> [Int16] {
        let srcRate = buffer.format.sampleRate
        let srcCh = Int(buffer.format.channelCount)
        let frameCount = Int(buffer.frameLength)
        guard srcRate > 0, srcCh > 0, frameCount > 0 else { return [] }

        // 第一声道 → Float32（[-1,1]）
        var floatSamples = [Float](repeating: 0, count: frameCount)
        if buffer.format.commonFormat == .pcmFormatFloat32 {
            guard let ch = buffer.floatChannelData?[0] else { return [] }
            for i in 0..<frameCount { floatSamples[i] = ch[i] }
        } else if buffer.format.commonFormat == .pcmFormatInt16 {
            guard let ch = buffer.int16ChannelData?[0] else { return [] }
            for i in 0..<frameCount { floatSamples[i] = Float(ch[i]) / 32768.0 }
        } else {
            return []
        }

        // 重采样到 16kHz（线性插值）
        let ratio = srcRate / 16000.0
        if abs(ratio - 1.0) < 0.0001 {
            var out = [Int16](repeating: 0, count: frameCount)
            for i in 0..<frameCount {
                let v = floatSamples[i]
                out[i] = Int16(max(-1.0, min(1.0, v)) * 32767.0)
            }
            return out
        }
        let outCount = Int(Double(frameCount) / ratio)
        guard outCount > 0 else { return [] }
        var out = [Int16](repeating: 0, count: outCount)
        for i in 0..<outCount {
            let pos = Double(i) * ratio
            let i0 = Int(pos)
            let i1 = min(i0 + 1, frameCount - 1)
            let frac = Float(pos - Double(i0))
            let v = floatSamples[i0] * (1 - frac) + floatSamples[i1] * frac
            out[i] = Int16(max(-1.0, min(1.0, v)) * 32767.0)
        }
        return out
    }

    /// 正常收尾：停引擎、关文件、标记 stopped（曾开录时）；保留 pendingChunks 供 UTS 拉尾帧
    private func finishInternal() {
        NSLog("[PCMRec] finishInternal called running=\(running) started=\(started)")
        appendDiag("finishInternal called running=\(running) started=\(started)")
        guard running else { return }
        running = false
        stopEngineAndCloseFile()
        if started {
            stopped = true
        }
    }

    /// 写 uni-app x 的 usr 空间（Documents）而非 NSTemporaryDirectory：uni 的
    /// getFileSystemManager.readFile 对 Swift 的 /private/var/mobile/.../tmp 路径
    /// getRealPath 匹配不上（实测读文件恒失败 → 兜底误报「音频文件为空」），
    /// 而 Documents 是 unifile://usr/ 的物理目录，下游 readFile 一定能读。
    private func openRecordFile() {
        if let fh = fileHandle {
            try? fh.close()
            fileHandle = nil
        }
        let docsDir = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first
        filePath = (docsDir ?? NSTemporaryDirectory()) + "/nuwax_voice_record.pcm"
        do {
            if FileManager.default.fileExists(atPath: filePath) {
                try FileManager.default.removeItem(atPath: filePath)
            }
            FileManager.default.createFile(atPath: filePath, contents: nil, attributes: nil)
            fileHandle = try FileHandle(forWritingTo: URL(fileURLWithPath: filePath))
        } catch {
            lock.lock()
            errorMessage = "录音启动失败"
            lock.unlock()
        }
    }

    /// 创建 AVAudioEngine、挂 tap 并 start。不碰 session、不重置文件。
    private func startEngineAndTap() {
        guard AVAudioSession.sharedInstance().isInputAvailable else {
            lock.lock()
            errorMessage = "麦克风输入不可用"
            lock.unlock()
            NSLog("[PCMRec] isInputAvailable=false，中止 start（避免 inputNode 抛 NSException）")
            appendDiag("isInputAvailable=false，中止 start")
            running = false
            return
        }
        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        // 用硬件原生格式挂 tap：iOS 上以 16k Int16 自定义格式 installTap 会抛
        // "Failed to create tap due to format mismatch"（无隐式 SRC），
        // 改在 handleTap 里手动重采样到 16kHz mono Int16。
        let inputFormat = input.inputFormat(forBus: 0)
        NSLog("[PCMRec] inputFormat sr=\(inputFormat.sampleRate) ch=\(inputFormat.channelCount) fmt=\(inputFormat.commonFormat.rawValue)")
        appendDiag("inputFormat sr=\(inputFormat.sampleRate) ch=\(inputFormat.channelCount) fmt=\(inputFormat.commonFormat.rawValue)")
        // 1024 ≈ 21ms @48kHz，比 4096 更快吐出首帧（系统仍可能忽略 hint）
        input.installTap(onBus: 0, bufferSize: 1024, format: inputFormat) { [weak self] buffer, _ in
            self?.handleTap(buffer)
        }
        running = true
        do {
            try engine.start()
            NSLog("[PCMRec] engine.start ok")
            appendDiag("engine.start ok")
            interruptSuppressDeadline = Date().addingTimeInterval(3.0)
        } catch {
            running = false
            NSLog("[PCMRec] engine.start FAIL: \(error)")
            appendDiag("engine.start FAIL: \(error)")
            lock.lock()
            errorMessage = "录音启动失败"
            lock.unlock()
            stopEngineOnly()
        }
    }

    /// 只停引擎、卸 tap；保留文件与 durationTimer
    private func stopEngineOnly() {
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
    }

    private func stopEngineAndCloseFile() {
        stopEngineOnly()
        if let t = durationTimer {
            t.invalidate()
            durationTimer = nil
        }
        if let fh = fileHandle {
            try? fh.close()
            fileHandle = nil
        }
    }

    /// AVAudioSession：录音与 TTS 播放共存，统一 .playAndRecord + mixWithOthers。
    /// 已是 playAndRecord：什么都不做（连 setActive(true) 都不要）——
    /// 再次 setActive 也会在部分机型上自惹 interruption，按下后首帧空等 1s。
    private func configureSession() {
        let session = AVAudioSession.sharedInstance()
        if session.category == .playAndRecord && session.isInputAvailable {
            sessionWarmed = true
            NSLog("[PCMRec] configureSession skip (already playAndRecord)")
            appendDiag("configureSession skip (already playAndRecord)")
            return
        }
        // 冷启动 / 从其他 category 切过来：必须 setActive(false) 再重配，
        // 否则输入路由不真正建立 → 永不产帧（已实测）。
        do {
            try session.setActive(false)
            NSLog("[PCMRec] deactivate session ok")
            appendDiag("deactivate session ok")
        } catch {
            NSLog("[PCMRec] deactivate session fail(continue): \(error)")
            appendDiag("deactivate session fail: \(error)")
        }
        do {
            try session.setCategory(.playAndRecord,
                                    mode: .default,
                                    options: [.defaultToSpeaker, .mixWithOthers])
            NSLog("[PCMRec] setCategory(.playAndRecord) ok")
            appendDiag("setCategory(.playAndRecord) ok")
        } catch {
            NSLog("[PCMRec] setCategory(.playAndRecord) FAIL: \(error)")
            appendDiag("setCategory FAIL: \(error)")
        }
        do {
            try session.setActive(true)
            NSLog("[PCMRec] setActive(true) ok")
            appendDiag("setActive(true) ok")
            sessionWarmed = true
        } catch {
            NSLog("[PCMRec] setActive(true) FAIL: \(error)")
            appendDiag("setActive(true) FAIL: \(error)")
        }
        NSLog("[PCMRec] session category=\(session.category.rawValue) inputAvailable=\(session.isInputAvailable) otherAudio=\(session.isOtherAudioPlaying)")
        appendDiag("session category=\(session.category.rawValue) inputAvailable=\(session.isInputAvailable) otherAudio=\(session.isOtherAudioPlaying)")
    }

    private func addObservers() {
        guard !observersAdded else { return }
        observersAdded = true
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleInterruption(_:)),
                                               name: AVAudioSession.interruptionNotification,
                                               object: nil)
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleRouteChange(_:)),
                                               name: AVAudioSession.routeChangeNotification,
                                               object: nil)
    }

    private func removeObservers() {
        guard observersAdded else { return }
        observersAdded = false
        NotificationCenter.default.removeObserver(self,
                                                  name: AVAudioSession.interruptionNotification,
                                                  object: nil)
        NotificationCenter.default.removeObserver(self,
                                                  name: AVAudioSession.routeChangeNotification,
                                                  object: nil)
    }

    /// 来电等系统中断：优雅收尾（等价松手），跳主线程避免在任意线程碰 AVAudioEngine。
    /// 三层守卫：
    /// 1) 启动窗口（start 后 3s）：会话激活的系统自惹 .began（真机实测无论 otherAudio 真假必来一次）→ 忽略；
    /// 2) started==false（首帧未到）→ 忽略；
    /// 3) isOtherAudioPlaying==false（无其他 App 在播）→ 视为自惹，忽略。
    /// 只有过了启动窗口、已开录、且确有其他 App 音频在播（真抢占）才收尾。
    @objc private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
        NSLog("[PCMRec] interruption notification type=\(type.rawValue) (\(type == .began ? "began" : "ended"))")
        appendDiag("interruption type=\(type.rawValue)")
        guard type == .began else { return }
        if let deadline = interruptSuppressDeadline, Date() < deadline {
            appendDiag("interruption began ignored (startup window)")
            // 只忽略，不要 restartCapture：自惹中断时重挂 engine 会再触发
            // interruption/routeChange，tap 卡在首帧（~3200B）→ 松手 no_speech。
            return
        }
        interruptSuppressDeadline = nil
        guard started else {
            appendDiag("interruption began ignored (started=false)")
            return
        }
        let otherAudio = AVAudioSession.sharedInstance().isOtherAudioPlaying
        appendDiag("interruption began otherAudio=\(otherAudio)")
        guard otherAudio else {
            appendDiag("interruption began ignored (no other audio playing)")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.finishInternal()
        }
    }

    /// 路由变更（耳机拔插）导致旧设备不可用：优雅收尾。同样加 started 守卫。
    @objc private func handleRouteChange(_ notification: Notification) {
        guard let info = notification.userInfo,
              let reasonRaw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) else { return }
        NSLog("[PCMRec] routeChange notification reason=\(reason.rawValue)")
        appendDiag("routeChange reason=\(reason.rawValue)")
        guard reason == .oldDeviceUnavailable else { return }
        guard started else {
            appendDiag("routeChange oldDeviceUnavailable ignored (started=false)")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.finishInternal()
        }
    }
}
