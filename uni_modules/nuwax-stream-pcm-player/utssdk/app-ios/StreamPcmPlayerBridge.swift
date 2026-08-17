//
//  StreamPcmPlayerBridge.swift
//  基于 AVAudioEngine + AVAudioPlayerNode 的流式 PCM16 播放器：
//  TTS 推来的 PCM 帧 scheduleBuffer 排队播放，无文件、无段边界（iOS 版 AudioTrack 方案）。
//
import AVFoundation
import Foundation

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
    /** 背压上限：已推送未播放积压超过该字节数时丢弃新帧（~60s 音频 @16kHz mono16，与 Android 上限一致） */
    private let maxBacklogBytes: Int64 = 60 * 32000
    /** 诊断：因积压超上限被丢弃的字节数（正常播放应为 0） */
    private var droppedBytes: Int64 = 0

    public init() {}

    public func initPlayer(_ sampleRate: NSNumber) {
        releasePlayer()
        let sr = sampleRate.doubleValue
        self.sampleRate = sr > 0 ? sr : 16000
        let fmt = AVAudioFormat(commonFormat: .pcmFormatInt16,
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
        // PCM16 LE：两个字节拼一个 Int16 样本
        if let channels = buffer.int16ChannelData {
            let samples = [Int16](unsafeUninitializedCapacity: frameCount) { rawBuf, count in
                pending.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                    let bytes = raw.bindMemory(to: UInt8.self)
                    for i in 0..<frameCount {
                        let lo = Int16(bytes[i * 2])
                        let hi = Int16(bytes[i * 2 + 1])
                        rawBuf[i] = Int16((hi << 8) | (lo & 0xff))
                    }
                }
                count = frameCount
            }
            for i in 0..<frameCount {
                channels[0][i] = samples[i]
            }
        }
        pending.removeAll()
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
        if started { return }
        if writtenMs() >= 150 {
            playNow()
        }
    }

    public func playNow() {
        guard let player = player else { return }
        if started { return }
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
        engine?.stop()
        player = nil
        engine = nil
        format = nil
        started = false
        pending = Data()
        writtenBytes = 0
        playedBytes = 0
    }
}
