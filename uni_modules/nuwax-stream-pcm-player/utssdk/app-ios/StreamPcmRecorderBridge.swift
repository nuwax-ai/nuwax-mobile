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
    private var sessionConfigured = false
    private var observersAdded = false

    public init() {}

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

    // ==================== 控制 ====================

    /// 开始录音：durationMs 毫秒后自动停止（<=0 不限）。采样率/声道/格式固定 16kHz mono PCM16。
    public func start(_ durationMs: NSNumber) {
        // 复用实例：先收尾旧轮（不回传旧 stopped，避免污染新会话）
        finishInternal()
        lock.lock()
        pendingChunks.removeAll()
        errorMessage = ""
        lock.unlock()
        started = false
        stopped = false

        configureSession()
        addObservers()

        filePath = NSTemporaryDirectory() + "nuwax_voice_record.pcm"
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
            return
        }

        guard let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16,
                                      sampleRate: 16000,
                                      channels: 1,
                                      interleaved: false) else {
            lock.lock()
            errorMessage = "录音启动失败"
            lock.unlock()
            return
        }
        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        // tap 格式指定 16kHz：AVAudioEngine 从硬件采样率隐式重采样（SRC）
        input.installTap(onBus: 0, bufferSize: 3200, format: fmt) { [weak self] buffer, _ in
            self?.handleTap(buffer)
        }
        running = true
        do {
            try engine.start()
        } catch {
            running = false
            lock.lock()
            errorMessage = "录音启动失败"
            lock.unlock()
            stopEngineAndCloseFile()
            return
        }
        if durationMs.doubleValue > 0 {
            let t = Timer(timeInterval: durationMs.doubleValue / 1000.0, repeats: false) { [weak self] _ in
                self?.finishInternal()
            }
            RunLoop.main.add(t, forMode: .common)
            durationTimer = t
        }
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

    // ==================== 内部 ====================

    /// tap 回调（音频渲染线程）：PCM 帧写文件 + 入队（NSLock 保护）
    private func handleTap(_ buffer: AVAudioPCMBuffer) {
        guard running else { return }
        guard let channelData = buffer.int16ChannelData?[0] else { return }
        let frameCount = Int(buffer.frameLength)
        guard frameCount > 0 else { return }
        let byteCount = frameCount * 2
        var data = Data(count: byteCount)
        data.withUnsafeMutableBytes { raw in
            if let base = raw.baseAddress {
                memcpy(base, channelData, byteCount)
            }
        }
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
        }
        lock.unlock()
    }

    /// 正常收尾：停引擎、关文件、标记 stopped（曾开录时）；保留 pendingChunks 供 UTS 拉尾帧
    private func finishInternal() {
        guard running else { return }
        running = false
        stopEngineAndCloseFile()
        if started {
            stopped = true
        }
    }

    private func stopEngineAndCloseFile() {
        engine?.inputNode.removeTap(onBus: 0)
        engine?.stop()
        engine = nil
        if let t = durationTimer {
            t.invalidate()
            durationTimer = nil
        }
        if let fh = fileHandle {
            try? fh.close()
            fileHandle = nil
        }
    }

    /// AVAudioSession：录音与 TTS 播放共存，统一 .playAndRecord（首次配置一次）
    private func configureSession() {
        guard !sessionConfigured else { return }
        sessionConfigured = true
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playAndRecord,
                                 mode: .default,
                                 options: [.defaultToSpeaker, .allowBluetoothHFP])
        try? session.setActive(true)
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

    /// 来电等系统中断：优雅收尾（等价松手），跳主线程避免在任意线程碰 AVAudioEngine
    @objc private func handleInterruption(_ notification: Notification) {
        guard let info = notification.userInfo,
              let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw),
              type == .began else { return }
        DispatchQueue.main.async { [weak self] in
            self?.finishInternal()
        }
    }

    /// 路由变更（耳机拔插）导致旧设备不可用：优雅收尾
    @objc private func handleRouteChange(_ notification: Notification) {
        guard let info = notification.userInfo,
              let reasonRaw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
              let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw),
              reason == .oldDeviceUnavailable else { return }
        DispatchQueue.main.async { [weak self] in
            self?.finishInternal()
        }
    }
}
