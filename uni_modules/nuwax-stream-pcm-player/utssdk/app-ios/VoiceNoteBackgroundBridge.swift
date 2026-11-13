//
//  伙伴页录音退后台继续采集。
//  UIBackgroundModes 已包含 audio。这里把会话保持为 playAndRecord 并激活，
//  避免退到后台后系统把录音会话挂起。停止录音时不 deactivate，以免切段空隙被系统收回。
//
import AVFoundation

public class VoiceNoteBackgroundBridge {
    public func begin() {
        let session = AVAudioSession.sharedInstance()
        // 与会话录音 StreamPcmRecorderBridge.configureSession 同一套参数。
        // 已经是 playAndRecord 时什么都不做，连 setActive 都不调用：
        // 再次激活会在部分机型上打断正在进行的会话录音，首帧空等约 1 秒。
        if session.category == .playAndRecord && session.isInputAvailable {
            return
        }
        do {
            try session.setCategory(
                .playAndRecord,
                mode: .default,
                options: [.defaultToSpeaker, .mixWithOthers]
            )
            try session.setActive(true)
        } catch {
            NSLog("[voice-note] audio session failed \(error.localizedDescription)")
        }
    }

    public func end() {
    }
}
