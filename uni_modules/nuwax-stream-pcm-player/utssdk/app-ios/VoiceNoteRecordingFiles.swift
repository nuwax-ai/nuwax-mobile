import AVFoundation
import Foundation

/// 录音文件已经落盘、UTS 尚未确认时的恢复索引。文件本身仍是录音数据的来源。
public final class VoiceNoteRecordingFiles {
    private struct Entry: Codable {
        let name: String
        let openedAt: Date
        let durationMs: Int?
        let closed: Bool
    }

    private static let suffix = ".voice-note-recovery"

    public init() {}

    static func remember(_ path: String, openedAt: Date = Date(), durationMs: Int? = nil, closed: Bool = false) {
        let file = URL(fileURLWithPath: path)
        let marker = file.appendingPathExtension(String(suffix.dropFirst()))
        let previous = read(marker)
        let entry = Entry(name: file.lastPathComponent, openedAt: previous?.openedAt ?? openedAt,
                          durationMs: durationMs, closed: closed)
        do {
            try JSONEncoder().encode(entry).write(to: marker, options: .atomic)
        } catch {
            NSLog("[voice-note] could not persist recording recovery entry: %@", (error as NSError).domain)
        }
    }

    private static func read(_ marker: URL) -> Entry? {
        guard let data = try? Data(contentsOf: marker) else { return nil }
        return try? JSONDecoder().decode(Entry.self, from: data)
    }

    /// 按打开文件的顺序返回待对账路径。正在录制的文件只在冷启动时由 UTS 对账。
    public func recoveryPaths(_ localId: String, _ includeOpen: Bool) -> String {
        guard !localId.isEmpty, localId.utf8.allSatisfy({ (48...57).contains($0) }),
              let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return "[]"
        }
        let folder = documents.appendingPathComponent("voice-notes", isDirectory: true)
            .appendingPathComponent(localId, isDirectory: true)
        let markers = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        let entries = markers.compactMap { marker -> Entry? in
            guard marker.lastPathComponent.hasSuffix(Self.suffix),
                  let entry = Self.read(marker),
                  includeOpen || entry.closed,
                  marker.deletingPathExtension().lastPathComponent == entry.name else { return nil }
            return entry
        }.sorted { left, right in
            left.openedAt == right.openedAt ? left.name < right.name : left.openedAt < right.openedAt
        }
        let paths = entries.map { folder.appendingPathComponent($0.name).path }
        guard let data = try? JSONEncoder().encode(paths) else { return "[]" }
        return String(decoding: data, as: UTF8.self)
    }

    public func acknowledge(_ path: String) {
        let marker = URL(fileURLWithPath: path + Self.suffix)
        try? FileManager.default.removeItem(at: marker)
    }

    public func seal(_ path: String) -> String {
        VoiceNoteM4aSeal.sealFile(path)
    }

    /// 容器内没有可读音轨时保留文件，避免把容器头或损坏段送给转写。
    public func inspect(_ path: String) -> String {
        do {
            let attributes = try FileManager.default.attributesOfItem(atPath: path)
            if (attributes[.size] as? NSNumber)?.int64Value == 0 { return "missing" }
        } catch let error as NSError {
            if error.domain == NSCocoaErrorDomain && [NSFileNoSuchFileError, NSFileReadNoSuchFileError].contains(error.code) {
                return "missing"
            }
            return "pending"
        }
        let durationMs = Self.durationMs(path)
        if durationMs > 0 { return "ready|\(durationMs)" }
        return VoiceNoteM4aSeal.hasNoMedia(path) ? "empty" : "pending"
    }

    static func durationMs(_ path: String) -> Int {
        guard let file = try? AVAudioFile(forReading: URL(fileURLWithPath: path)),
              file.length > 0, file.fileFormat.sampleRate > 0,
              let probe = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 1) else { return 0 }
        do {
            try file.read(into: probe, frameCount: 1)
            guard probe.frameLength > 0 else { return 0 }
        } catch {
            return 0
        }
        return max(1, Int(Double(file.length) * 1000 / file.fileFormat.sampleRate))
    }
}
