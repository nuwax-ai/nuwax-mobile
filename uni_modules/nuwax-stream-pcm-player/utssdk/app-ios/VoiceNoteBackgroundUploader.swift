import Foundation

struct VoiceNoteUploadContext: Decodable {
    let path: String
    let url: URL
    let authorization: String
    let clientType: String
}

/// The native tester host forwards background session events here. Other hosts use the UTS upload queue.
@objc(NuwaxVoiceNoteBackgroundUploader)
public final class VoiceNoteBackgroundUploader: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private struct Receipt: Codable {
        let pending: Bool
        let response: String
    }

    static let shared = VoiceNoteBackgroundUploader()
    static var enabled: Bool {
        Bundle.main.object(forInfoDictionaryKey: "NuwaxVoiceNoteBackgroundUpload") as? Bool == true
    }

    private static let identifier = "com.nuwax.voice-note.segments"
    private let work = DispatchQueue(label: VoiceNoteBackgroundUploader.identifier)
    private var active: Set<String> = []
    private var discardedNotes: Set<String> = []
    private var responses: [Int: Data] = [:]
    private var hostCompletions: [() -> Void] = []
    private var checkedTasksAt: Date?

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.identifier)
        config.sessionSendsLaunchEvents = true
        let session = URLSession(configuration: config, delegate: self, delegateQueue: nil)
        session.getAllTasks { [weak self] tasks in
            guard let self else { return }
            let paths = tasks.compactMap(\.taskDescription)
            self.work.async {
                // Include tasks still preparing their file or submitted since this enumeration began.
                self.active.formUnion(paths.filter { key in
                    guard let file = self.file(for: key) else { return false }
                    return self.readReceipt(file)?.pending == true
                })
                self.checkedTasksAt = Date()
            }
        }
        return session
    }()

    @objc(handleBackgroundEvents:completionHandler:)
    public static func handleBackgroundEvents(_ identifier: String, completionHandler: @escaping () -> Void) -> Bool {
        guard identifier == Self.identifier else { return false }
        shared.work.async {
            shared.hostCompletions.append(completionHandler)
            _ = shared.session
        }
        return true
    }

    public override init() {
        super.init()
    }

    public func readStatus(_ path: String) -> String {
        return Self.shared.status(path)
    }

    public func cancelNote(_ localId: String) {
        guard Self.enabled, !localId.isEmpty else { return }
        let uploader = Self.shared
        uploader.work.sync {
            uploader.discardedNotes.insert(localId)
            uploader.session.getAllTasks { tasks in
                for task in tasks where task.taskDescription?.hasPrefix(localId + "/") == true {
                    task.cancel()
                }
            }
        }
    }

    private var root: URL? {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first?
            .appendingPathComponent("voice-notes", isDirectory: true).standardizedFileURL
    }

    private func key(for path: String) -> String? {
        guard let root else { return nil }
        let file = URL(fileURLWithPath: path).standardizedFileURL
        let prefix = root.path + "/"
        guard file.path.hasPrefix(prefix), file.pathExtension == "m4a",
              file.deletingLastPathComponent().deletingLastPathComponent().path == root.path else { return nil }
        return String(file.path.dropFirst(prefix.count))
    }

    private func file(for key: String) -> URL? {
        guard let file = root?.appendingPathComponent(key),
              self.key(for: file.path) == key else { return nil }
        return file
    }

    private func readReceipt(_ file: URL) -> Receipt? {
        guard let data = try? Data(contentsOf: file.appendingPathExtension("voice-note-transfer")) else { return nil }
        return try? JSONDecoder().decode(Receipt.self, from: data)
    }

    private func writeReceipt(_ receipt: Receipt, for file: URL) throws {
        try JSONEncoder().encode(receipt).write(to: file.appendingPathExtension("voice-note-transfer"), options: .atomic)
    }

    /// Called at interruption time after stop(). Reserving the source prevents the UTS queue from racing the handoff.
    func enqueue(_ context: VoiceNoteUploadContext) {
        guard Self.enabled, let key = key(for: context.path), let file = file(for: key) else { return }
        let localId = file.deletingLastPathComponent().lastPathComponent
        let reserved = work.sync {
            guard !discardedNotes.contains(localId), readReceipt(file) == nil else { return false }
            do {
                try writeReceipt(Receipt(pending: true, response: ""), for: file)
            } catch {
                return false
            }
            active.insert(key)
            return true
        }
        guard reserved else { return }
        DispatchQueue.global(qos: .utility).async { [self] in
            do {
                let durationMs = VoiceNoteRecordingFiles.durationMs(file.path)
                guard durationMs > 0 else { throw CocoaError(.fileReadCorruptFile) }
                let boundary = "voice-note-\(UUID().uuidString)"
                let body = try multipart(file: file, boundary: boundary, durationMs: durationMs)
                var request = URLRequest(url: context.url)
                request.httpMethod = "POST"
                request.setValue(context.authorization, forHTTPHeaderField: "Authorization")
                if !context.clientType.isEmpty {
                    request.setValue(context.clientType, forHTTPHeaderField: "X-Client-Type")
                }
                request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
                let prepared = request
                work.async { [self] in
                    guard !discardedNotes.contains(localId) else {
                        finish(key, response: "")
                        return
                    }
                    let task = session.uploadTask(with: prepared, fromFile: body)
                    task.taskDescription = key
                    task.resume()
                    NSLog("[voice-note] background upload submitted index=0 durationMs=%ld", durationMs)
                }
            } catch {
                work.async { [self] in finish(key, response: "") }
            }
        }
    }

    func status(_ path: String) -> String {
        guard Self.enabled, let key = key(for: path), let file = file(for: key) else { return "" }
        return work.sync {
            guard let receipt = readReceipt(file) else { return "" }
            if !receipt.pending {
                return receipt.response.isEmpty ? "failed" : "response|\(receipt.response)"
            }
            _ = session
            // A force-quit can cancel the transfer without a delegate callback. Allow time for a restored completion.
            if !active.contains(key), let checkedTasksAt, Date().timeIntervalSince(checkedTasksAt) >= 3 {
                finish(key, response: "")
                return "failed"
            }
            return "pending"
        }
    }

    private func multipart(file: URL, boundary: String, durationMs: Int) throws -> URL {
        let body = file.appendingPathExtension("voice-note-body")
        FileManager.default.createFile(atPath: body.path, contents: nil)
        let output = try FileHandle(forWritingTo: body)
        defer { try? output.close() }
        try output.truncate(atOffset: 0)
        for (key, value) in [("segmentIndex", "0"), ("durationMs", String(durationMs))] {
            try output.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(key)\"\r\n\r\n\(value)\r\n".utf8))
        }
        try output.write(contentsOf: Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"segment-0.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n".utf8))
        let input = try FileHandle(forReadingFrom: file)
        defer { try? input.close() }
        while let data = try input.read(upToCount: 64 * 1024), !data.isEmpty {
            try output.write(contentsOf: data)
        }
        try output.write(contentsOf: Data("\r\n--\(boundary)--\r\n".utf8))
        return body
    }

    private func finish(_ key: String, response: String) {
        active.remove(key)
        guard let file = file(for: key) else { return }
        // A discarded note may already have removed the entire directory.
        try? writeReceipt(Receipt(pending: false, response: response), for: file)
        try? FileManager.default.removeItem(at: file.appendingPathExtension("voice-note-body"))
        NSLog("[voice-note] background upload transport completed response=%@", response.isEmpty ? "empty" : "available")
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        work.async {
            let id = dataTask.taskIdentifier
            let received = self.responses[id]?.count ?? 0
            if received + data.count <= 64 * 1024 {
                self.responses[id, default: Data()].append(data)
            } else {
                dataTask.cancel()
            }
        }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        work.async {
            let data = self.responses.removeValue(forKey: task.taskIdentifier)
            guard let key = task.taskDescription else { return }
            let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
            let response = error == nil && (200..<300).contains(status)
                ? String(data: data ?? Data(), encoding: .utf8) ?? "" : ""
            self.finish(key, response: response)
        }
    }

    public func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        work.async {
            let completions = self.hostCompletions
            self.hostCompletions.removeAll()
            DispatchQueue.main.async {
                completions.forEach { $0() }
            }
        }
    }
}
