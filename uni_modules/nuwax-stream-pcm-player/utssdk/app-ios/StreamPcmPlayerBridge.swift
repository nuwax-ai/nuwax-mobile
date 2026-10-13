//
//  StreamPcmPlayerBridge.swift
//  基于 AVAudioEngine + AVAudioPlayerNode 的流式 PCM16 播放器：
//  TTS 推来的 PCM 帧 scheduleBuffer 排队播放，无文件、无段边界（iOS 版 AudioTrack 方案）。
//
import AVFoundation
import Foundation
import UIKit

public class StreamPcmPlayerBridge {
    private var engine: AVAudioEngine?
    private var player: AVAudioPlayerNode?
    private var format: AVAudioFormat?
    private var sampleRate: Double = 16000
    private var writtenBytes: Int64 = 0
    private var playedBytes: Int64 = 0
    private var started = false
    private var pending = Data()
    private let bytesPerFrame: Int64 = 2 // PCM16 mono
    /** 背压上限：已推送未播放积压超过该字节数时丢弃新帧（~10 分钟音频 @16kHz mono16，对齐 Android；旧值 60s 会让长文本投递快于实时时丢帧卡顿） */
    private let maxBacklogBytes: Int64 = 600 * 32000
    /** 诊断：因积压超上限被丢弃的字节数（正常播放应为 0） */
    private var droppedBytes: Int64 = 0
    /** 退后台 / 回前台时再确认 playback 会话；播报对象存活期间只注册一次 */
    private var lifecycleObserversInstalled = false
    /** 避免 configurationChange 里同步重入 recover */
    private var recovering = false

    public init() {
        installLifecycleObservers()
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    /// 播报期间用 playback，退后台才能继续播完（ambient 进后台会被系统静音）。
    /// mixWithOthers：不抢占其他 App 正在播放的音频。
    /// 播完 releasePlayer 切回 ambient，录音仍由录音器自行切到 playAndRecord。
    /// 播报进行中不跟随静音键，与 Android STREAM_MUSIC 一致；结束后恢复 ambient。
    private func preparePlaybackSession() throws {
        let session = AVAudioSession.sharedInstance()
        if session.category != .playback {
            try session.setCategory(.playback, mode: .default, options: [.mixWithOthers])
            try session.setActive(true)
        } else if engine?.isRunning != true {
            try session.setActive(true)
        }
        let outputs = session.currentRoute.outputs.map { $0.portType.rawValue }.joined(separator: ",")
        NSLog("[PCMPlay] session category=\(session.category.rawValue) outputs=\(outputs) volume=\(session.outputVolume)")
    }

    private func installLifecycleObservers() {
        if lifecycleObserversInstalled { return }
        lifecycleObserversInstalled = true
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(appWillResignActive),
                                               name: UIApplication.willResignActiveNotification,
                                               object: nil)
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(appDidBecomeActive),
                                               name: UIApplication.didBecomeActiveNotification,
                                               object: nil)
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleEngineConfigurationChange(_:)),
                                               name: .AVAudioEngineConfigurationChange,
                                               object: nil)
        NotificationCenter.default.addObserver(self,
                                               selector: #selector(handleSessionInterruption(_:)),
                                               name: AVAudioSession.interruptionNotification,
                                               object: nil)
    }

    /// 进后台前再激活 playback 会话。控制中心/来电也会触发；未在播则不动会话。
    @objc private func appWillResignActive() {
        recoverPlaybackIfNeeded(reason: "resign-active")
    }

    /// 回前台：会话仍是 playback 且引擎在跑就不要动。
    /// 无条件 pause/start 会把正在播的声音掐断一下，页面也会跟着顿。
    @objc private func appDidBecomeActive() {
        recoverPlaybackIfNeeded(reason: "become-active")
    }

    @objc private func handleEngineConfigurationChange(_ notification: Notification) {
        guard let changed = notification.object as? AVAudioEngine, changed === engine else { return }
        DispatchQueue.main.async { [weak self] in
            self?.recoverPlaybackIfNeeded(reason: "configuration-change")
        }
    }

    /// 中断结束（回前台、录音预热 setActive 等）后把还在播的引擎拉起来。began 不改 started。
    @objc private func handleSessionInterruption(_ notification: Notification) {
        guard started else { return }
        guard let info = notification.userInfo,
              let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw),
              type == .ended else { return }
        DispatchQueue.main.async { [weak self] in
            self?.recoverPlaybackIfNeeded(reason: "interruption-ended")
        }
    }

    /// 进后台：会话被改掉或引擎停了才修。未在播则不动。
    private func recoverPlaybackIfNeeded(reason: String) {
        guard started else { return }
        let session = AVAudioSession.sharedInstance()
        let engineDown = engine?.isRunning != true
        let wrongCategory = session.category != .playback
        if !engineDown && !wrongCategory && player?.isPlaying == true {
            return
        }
        reassertPlaybackOutput(reason: reason)
    }

    /// 只在会话被改掉或引擎已停时接回输出。正在跑的引擎不要 pause，否则回前台会顿一下。
    private func reassertPlaybackOutput(reason: String) {
        guard started, !recovering, let engine = engine, let player = player else { return }
        recovering = true
        defer { recovering = false }
        do {
            try preparePlaybackSession()
            if !engine.isRunning {
                try engine.start()
            }
            if !player.isPlaying {
                player.play()
            }
        } catch {
            NSLog("[PCMPlay] reassert \(reason) failed: \(error)")
        }
    }

    /// 播报结束后交还会话。正在录音（playAndRecord）时不改，避免拆掉录音路由。
    private func restoreAmbientSession() {
        let session = AVAudioSession.sharedInstance()
        if session.category != .playback {
            return
        }
        do {
            try session.setCategory(.ambient, mode: .default)
        } catch {
            NSLog("[PCMPlay] restore ambient failed: \(error)")
        }
    }

    public func initPlayer(_ sampleRate: NSNumber) {
        do {
            try preparePlaybackSession()
        } catch {
            NSLog("[PCMPlay] prepare session failed: \(error)")
            return
        }
        let sr = sampleRate.doubleValue
        let nextSr = sr > 0 ? sr : 16000
        // 复用已有引擎：不要 release 再重建。engine.stop() 会自惹 AVAudioSession
        // interruption，紧接着按住说话会空等 1~2s 首帧（第二次录音 loading）。
        if engine != nil && player != nil && abs(self.sampleRate - nextSr) < 0.1 {
            player?.stop()
            self.writtenBytes = 0
            self.playedBytes = 0
            self.started = false
            self.pending = Data()
            self.droppedBytes = 0
            if engine?.isRunning != true {
                do { try engine?.start() } catch {
                    NSLog("[PCMPlay] restart engine failed: \(error)")
                }
            }
            return
        }
        player?.stop()
        engine?.stop()
        player = nil
        engine = nil
        format = nil
        self.sampleRate = nextSr
        // mixer 的连接使用 Float32；服务端 PCM16 仅作为传输格式，在入队时转换。
        // 直接把 Int16 连接到 mainMixerNode 会触发 -10868（FormatNotSupported）。
        let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32,
                                sampleRate: self.sampleRate,
                                channels: 1,
                                interleaved: false)
        self.format = fmt
        let engine = AVAudioEngine()
        let player = AVAudioPlayerNode()
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: fmt)
        self.engine = engine
        self.player = player
        self.writtenBytes = 0
        self.playedBytes = 0
        self.started = false
        self.pending = Data()
        self.droppedBytes = 0
        do {
            try engine.start()
        } catch {
            NSLog("[PCMPlay] start engine failed: \(error)")
            self.engine = nil
            self.player = nil
        }
    }

    /// UTS 侧以 base64 字符串传入 PCM16 字节（iOS 桥接 Uint8Array 参数会崩，统一走 base64）
    public func pushBase64(_ b64: String) {
        guard let data = Data(base64Encoded: b64), !data.isEmpty else { return }
        // 背压：已推送未播放积压超过上限时丢弃本帧，防长音频/生产过快导致内存无限增长。
        // 正常播放（消费≈实时）不会触发；触发时音频有短暂缺口但 app 不崩。
        if writtenBytes - playedBytes > maxBacklogBytes {
            droppedBytes += Int64(data.count)
            return
        }
        pending.append(data)
        writtenBytes += Int64(data.count)
        // 攒够 ~100ms(3200B) 再调度，避免每帧 scheduleBuffer 卡顿
        if pending.count >= 3200 {
            flushPending()
        }
    }

    /// 诊断：因积压超上限被丢弃的字节数
    public func getDroppedBytes() -> NSNumber {
        return NSNumber(value: droppedBytes)
    }

    public func flushPending() {
        guard let player = player, let format = format, pending.count >= Int(bytesPerFrame) else {
            return
        }
        let frameCount = pending.count / Int(bytesPerFrame)
        guard frameCount > 0,
              let buffer = AVAudioPCMBuffer(pcmFormat: format,
                                            frameCapacity: AVAudioFrameCount(frameCount)) else {
            return
        }
        buffer.frameLength = AVAudioFrameCount(frameCount)
        guard let channel = buffer.floatChannelData?[0] else { return }
        // PCM16 LE 有符号样本归一化到 [-1, 1)，保留服务端采样率和时长。
        pending.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            let bytes = raw.bindMemory(to: UInt8.self)
            for i in 0..<frameCount {
                let bits = UInt16(bytes[i * 2]) | (UInt16(bytes[i * 2 + 1]) << 8)
                channel[i] = Float(Int16(bitPattern: bits)) / 32768.0
            }
        }
        // WebSocket 分帧不保证样本对齐，保留末尾不足一个样本的字节。
        pending = Data(pending.dropFirst(frameCount * Int(bytesPerFrame)))
        let frames = Int64(frameCount)
        player.scheduleBuffer(buffer, at: nil, options: [], completionHandler: { [weak self] in
            guard let self = self else { return }
            self.playedBytes += frames * self.bytesPerFrame
        })
    }

    private func writtenMs() -> Double {
        return Double(writtenBytes) * 1000.0 / (sampleRate * 2)
    }

    private func playedMs() -> Double {
        return Double(playedBytes) * 1000.0 / (sampleRate * 2)
    }

    public func ensurePlaying() {
        if started {
            // 排空轮询约 200ms 一次。回前台会话被改成 playAndRecord、或引擎被停时，在这里接回去。
            let session = AVAudioSession.sharedInstance()
            if session.category != .playback || engine?.isRunning != true {
                reassertPlaybackOutput(reason: "ensure-playing")
            }
            return
        }
        if writtenMs() >= 150 {
            playNow()
        }
    }

    public func playNow() {
        guard let player = player, let engine = engine else { return }
        if started { return }
        if !engine.isRunning {
            do {
                try preparePlaybackSession()
                try engine.start()
            } catch {
                NSLog("[PCMPlay] resume before play failed: \(error)")
                return
            }
        }
        started = true
        player.play()
    }

    public func setMuted(_ muted: Bool) {
        player?.volume = muted ? 0 : 1
    }

    public func getWrittenMs() -> NSNumber {
        return NSNumber(value: writtenMs())
    }

    public func getPlayedMs() -> NSNumber {
        return NSNumber(value: playedMs())
    }

    public func isDrained() -> Bool {
        return playedMs() + 50 >= writtenMs()
    }

    public func hasPendingAudio() -> Bool {
        return !pending.isEmpty || writtenMs() > playedMs() + 50
    }

    public func releasePlayer() {
        player?.stop()
        pending = Data()
        writtenBytes = 0
        playedBytes = 0
        started = false
        // 不停 AVAudioEngine：engine.stop() 会自惹 session interruption，
        // 随后立刻开录音会丢开头 1~2s。下次 initPlayer 复用同一引擎。
        // 切回 ambient，避免播完后仍占后台音频资格。不 setActive(false)，同上。
        restoreAmbientSession()
    }
}
