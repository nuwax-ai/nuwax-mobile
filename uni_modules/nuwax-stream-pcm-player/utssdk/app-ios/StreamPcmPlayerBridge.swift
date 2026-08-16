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

    public init() {}

    public func initPlayer(_ sampleRate: Int) {
        releasePlayer()
        self.sampleRate = sampleRate > 0 ? Double(sampleRate) : 16000
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
        do {
            try engine.start()
        } catch {
            self.engine = nil
            self.player = nil
        }
    }

    /// UTS 侧把 Uint8Array 逐字节转成 number[] 传入（[Double]）
    public func push(_ bytes: [Double]) {
        var data = Data(capacity: bytes.count)
        for v in bytes {
            data.append(UInt8(v))
        }
        pending.append(data)
        writtenBytes += Int64(data.count)
        flushPending()
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

    public func ensurePlaying() {
        if started { return }
        if getWrittenMs() >= 150 {
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

    public func getWrittenMs() -> Double {
        return Double(writtenBytes) * 1000.0 / (sampleRate * 2)
    }

    public func getPlayedMs() -> Double {
        return Double(playedBytes) * 1000.0 / (sampleRate * 2)
    }

    public func isDrained() -> Bool {
        return getPlayedMs() + 50 >= getWrittenMs()
    }

    public func hasPendingAudio() -> Bool {
        return !pending.isEmpty || getWrittenMs() > getPlayedMs() + 50
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
