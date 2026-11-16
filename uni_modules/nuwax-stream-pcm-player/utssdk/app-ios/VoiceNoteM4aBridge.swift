//
//  伙伴页录音。AVAudioRecorder 直接写 m4a（AAC），不写 PCM，也不走 StreamPcmRecorder。
//  segmentKey 格式：localId|index。单字符串跨桥，避免多参数转换失败。
//
import AVFoundation
import Foundation

public class VoiceNoteM4aBridge {
    private var recorder: AVAudioRecorder?

    public init() {}

    public func startSegment(_ segmentKey: String) -> String {
        stopQuiet()
        let parts = segmentKey.split(separator: "|", maxSplits: 1).map { String($0) }
        guard parts.count == 2 else {
            return ""
        }
        let localId = sanitize(parts[0])
        let indexName = sanitize(parts[1])
        guard !localId.isEmpty, !indexName.isEmpty else {
            return ""
        }
        let session = AVAudioSession.sharedInstance()
        if !(session.category == .playAndRecord && session.isInputAvailable) {
            do {
                try session.setCategory(
                    .playAndRecord,
                    mode: .default,
                    options: [.defaultToSpeaker, .mixWithOthers]
                )
                try session.setActive(true)
            } catch {
                NSLog("[voice-note] m4a session failed \(error.localizedDescription)")
                return ""
            }
        }
        let docs = NSSearchPathForDirectoriesInDomains(.documentDirectory, .userDomainMask, true).first
            ?? NSTemporaryDirectory()
        let dir = (docs as NSString).appendingPathComponent("voice-notes/\(localId)")
        do {
            try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        } catch {
            return ""
        }
        let path = (dir as NSString).appendingPathComponent("\(indexName).m4a")
        if FileManager.default.fileExists(atPath: path) {
            try? FileManager.default.removeItem(atPath: path)
        }
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000
        ]
        do {
            let next = try AVAudioRecorder(url: URL(fileURLWithPath: path), settings: settings)
            next.isMeteringEnabled = false
            if !next.prepareToRecord() || !next.record() {
                return ""
            }
            recorder = next
            return path
        } catch {
            NSLog("[voice-note] m4a start failed \(error.localizedDescription)")
            return ""
        }
    }

    public func stopSegment() -> String {
        guard let current = recorder else {
            return "0"
        }
        recorder = nil
        current.stop()
        return "1"
    }

    private func stopQuiet() {
        recorder?.stop()
        recorder = nil
    }

    private func sanitize(_ raw: String) -> String {
        return raw.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "..", with: "_")
    }
}
