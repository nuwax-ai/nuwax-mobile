import Foundation
import UIKit
import AVFoundation
import PushKit
import Security
import UserNotifications
@preconcurrency import LiveCommunicationKit
import LiveKit

/** All mutable call state is confined to main; Room delegates marshal back to main. */
@MainActor @objc public final class NuwaxVoipBridge: NSObject, @unchecked Sendable {
    public static let shared = NuwaxVoipBridge()
    private var configuration: [String: Any] = [:]
    private var events: [[String: Any]] = []
    private var generation = 0
    private var snapshot: [String: Any]?
    private var terminal = Set<String>()
    private var stream: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var mediaTask: Task<Void, Never>?
    private var room: Room?
    private var mediaId = ""
    private var connected = false, peerReady = false, readySent = false
    private var microphone = true, camera = false, audioActive = false
    private var pushRegistry: PKPushRegistry?
    private var callUUIDs: [String: UUID] = [:]
    private var systemBridge: AnyObject?
    private var views: [WeakVideoView] = []
    private let prefix = "/api/instant-message/calls"
    private let service = "com.nuwax.voip.session"

    @objc public nonisolated static func isTestPackage() -> Bool {
        #if DEBUG
        return Bundle.main.object(forInfoDictionaryKey: "NuwaxVoipDeviceTest") as? Bool == true
        #else
        return false
        #endif
    }

    @objc public nonisolated static func restoreOnLaunch() {
        if Thread.isMainThread { MainActor.assumeIsolated { shared.restore() } } else { DispatchQueue.main.sync { shared.restore() } }
    }
    @objc public nonisolated static func execute(_ raw: String) {
        DispatchQueue.main.async {
            guard let data = raw.data(using: .utf8), let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            shared.executeOnMain(command)
        }
    }
    @objc public nonisolated static func drainEvents() -> String {
        let read = { @MainActor () -> String in
            let result = shared.events; shared.events = []
            return String(data: (try? JSONSerialization.data(withJSONObject: result)) ?? Data("[]".utf8), encoding: .utf8) ?? "[]"
        }
        return Thread.isMainThread ? MainActor.assumeIsolated(read) : DispatchQueue.main.sync(execute: read)
    }
    @objc public nonisolated static func requestPermissions(_ mediaType: String, _ completion: @escaping @Sendable (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { microphone in
            if mediaType != "video" { DispatchQueue.main.async { completion(microphone) }; return }
            AVCaptureDevice.requestAccess(for: .video) { camera in DispatchQueue.main.async { completion(microphone && camera) } }
        }
    }
    @objc public nonisolated static func createVideoView(_ local: Bool) -> UIView {
        MainActor.assumeIsolated {
            let video = VideoView(); shared.views.append(WeakVideoView(video, local: local)); shared.refreshViews(); return video
        }
    }
    @objc public nonisolated static func releaseVideoView(_ view: UIView) {
        MainActor.assumeIsolated {
            (view as? VideoView)?.track = nil
            shared.views.removeAll { $0.view == nil || $0.view === view }
        }
    }
    private func emit(_ type: String, _ values: [String: Any] = [:]) {
        var event = values; event["type"] = type; event["scope"] = configuration["scope"] as? String ?? ""
        event["callId"] = snapshot?["callId"] as? String ?? ""
        events.append(event); if events.count > 256 { events.removeFirst(events.count - 256) }
    }
    private func executeOnMain(_ command: [String: Any]) {
        let operation = command["op"] as? String ?? ""
        if operation == "initialize" { initialize(command); return }
        if operation == "reset" { reset(); return }
        guard command["scope"] as? String == configuration["scope"] as? String else { return }
        let commandId = command["callId"] as? String ?? ""
        if ["action", "microphone", "camera", "speaker", "audioRoute", "switchCamera"].contains(operation), commandId != snapshot?["callId"] as? String { return }
        switch operation {
        case "reset": reset()
        case "watch": if let value = command["snapshot"] as? [String: Any] { adopt(value) }
        case "action":
            let action = command["action"] as? String ?? ""
            if action == "accept", #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls, let id = snapshot?["callId"] as? String {
                system.requestAnswer(uuid: uuid(id), mediaType: command["answerMediaType"] as? String ?? "audio"); return
            }
            Task { guard self.snapshot?["callId"] as? String == commandId else { return }; await self.action(action, answerMediaType: command["answerMediaType"] as? String ?? "audio") }
        case "microphone": Task { guard self.snapshot?["callId"] as? String == commandId else { return }; await self.setMicrophone(command["enabled"] as? Bool ?? false) }
        case "camera": Task { guard self.snapshot?["callId"] as? String == commandId else { return }; await self.setCamera(command["enabled"] as? Bool ?? false) }
        case "audioRoute":
            let route = command["route"] as? String ?? ""
            let session = AVAudioSession.sharedInstance()
            do {
                if route == "bluetooth" {
                    guard let input = session.availableInputs?.first(where: { $0.portType == .bluetoothHFP }) else { throw VoipError.invalid }
                    try session.overrideOutputAudioPort(.none); try session.setPreferredInput(input)
                } else {
                    try session.setPreferredInput(nil); try session.overrideOutputAudioPort(route == "speaker" ? .speaker : .none)
                }
                emit("speaker", ["enabled": session.currentRoute.outputs.contains { $0.portType == .builtInSpeaker }])
            } catch { emit("error", ["code": "CALL_AUDIO_ROUTE_UNAVAILABLE"]) }
        case "speaker":
            let enabled = command["enabled"] as? Bool ?? false
            AudioManager.shared.isSpeakerOutputPreferred = enabled
            try? AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none)
            emit("speaker", ["enabled": enabled])
        case "switchCamera":
            Task { guard self.snapshot?["callId"] as? String == commandId else { return }; if let track = self.room?.localParticipant.videoTracks.first?.track as? LocalVideoTrack,
                      let capturer = track.capturer as? CameraCapturer { _ = try? await capturer.switchCameraPosition() } }
        case "background":
            Task { try? await self.room?.localParticipant.setCamera(enabled: (command["hidden"] as? Bool != true) && self.camera) }
        default: break
        }
    }
    private func initialize(_ config: [String: Any]) {
        #if !DEBUG
        guard config["development"] as? Bool != true else { return }
        #endif
        guard config["development"] as? Bool == true || config["qaAccepted"] as? Bool == true,
              let base = config["apiBaseUrl"] as? String, let url = URL(string: base), url.host != nil,
              url.scheme == "https" || (config["development"] as? Bool == true && url.scheme == "http"),
              let token = config["accessToken"] as? String, !token.isEmpty,
              let user = config["userId"] as? String, !user.isEmpty else { return }
        let same = configuration["userId"] as? String == user && configuration["apiBaseUrl"] as? String == base && configuration["deviceId"] as? String == config["deviceId"] as? String
        if !same { reset() }
        configuration = config
        if let mapping = config["systemUUIDs"] as? [String: String] { for (key, value) in mapping { if let id = UUID(uuidString: value) { callUUIDs[key] = id } } }
        persist()
        UserDefaults.standard.set(true, forKey: "nuwax-voip-install-session")
        if #available(iOS 17.4, *) {
            if systemBridge == nil { systemBridge = NuwaxSystemCalls(owner: self) }
            AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false
            try? AudioManager.shared.setEngineAvailability(audioActive ? .default : .none)
            if pushRegistry == nil {
                let registry = PKPushRegistry(queue: .main); registry.delegate = self; registry.desiredPushTypes = [.voIP]; pushRegistry = registry
            }
        }
        startStream()
        if let value = snapshot {
            emit("snapshot", ["snapshot": value])
            if connected { emit("connected") }; if peerReady { emit("peerMediaReady") }
        }
    }
    private func request(_ path: String, body: [String: Any]? = nil) async throws -> [String: Any] {
        let run = generation; let config = configuration
        guard let base = config["apiBaseUrl"] as? String, let url = URL(string: base + prefix + path) else { throw VoipError.invalid }
        var request = URLRequest(url: url, timeoutInterval: 4)
        request.setValue("Bearer \(config["accessToken"] as? String ?? "")", forHTTPHeaderField: "Authorization")
        request.setValue(config["deviceId"] as? String, forHTTPHeaderField: "X-Call-Device-Id")
        if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard run == generation, (response as? HTTPURLResponse)?.statusCode == 200,
              let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any], envelope["code"] as? String == "0000",
              let value = envelope["data"] as? [String: Any] else { throw VoipError.invalid }
        return value
    }
    private func startStream() {
        stream?.cancel(); let run = generation; let config = configuration
        stream = Task { @MainActor in
            var cursor = ""
            while !Task.isCancelled && run == self.generation {
                do {
                    guard let url = URL(string: (config["apiBaseUrl"] as? String ?? "") + self.prefix + "/events") else { return }
                    var request = URLRequest(url: url); request.timeoutInterval = 60
                    request.setValue("Bearer \(config["accessToken"] as? String ?? "")", forHTTPHeaderField: "Authorization")
                    request.setValue(config["deviceId"] as? String, forHTTPHeaderField: "X-Call-Device-Id")
                    request.setValue(cursor, forHTTPHeaderField: "Last-Event-ID")
                    let (bytes, response) = try await URLSession.shared.bytes(for: request)
                    if Task.isCancelled { return }
                    if let status = (response as? HTTPURLResponse)?.statusCode, status == 401 || status == 403 {
                        if config["accessToken"] as? String != self.configuration["accessToken"] as? String { return }
                        let event: [String: Any] = ["type": "localEnded", "scope": self.configuration["scope"] as? String ?? "", "callId": self.snapshot?["callId"] as? String ?? "", "reason": "sessionExpired"]
                        self.reset(); self.events.append(event); return
                    }
                    guard (response as? HTTPURLResponse)?.statusCode == 200,
                          (response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Type")?.hasPrefix("text/event-stream") == true else { throw VoipError.invalid }
                    for try await line in bytes.lines {
                        if Task.isCancelled || run != self.generation { return }
                        if line.hasPrefix("id: ") { cursor = String(line.dropFirst(4)) }
                        if line.hasPrefix("data: "), let data = String(line.dropFirst(6)).data(using: .utf8), let value = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { self.adopt(value) }
                    }
                } catch { /* no token-bearing error output */ }
                try? await Task.sleep(nanoseconds: 1_000_000_000)
            }
        }
    }
    private func adopt(_ value: [String: Any]) {
        guard let id = value["callId"] as? String, !terminal.contains(id), let user = configuration["userId"] as? String,
              value["callerId"] as? String == user || value["calleeId"] as? String == user else { return }
        if let previous = snapshot {
            if previous["callId"] as? String != id && previous["state"] as? String != "ended" { return }
            if previous["callId"] as? String == id && (previous["version"] as? Int ?? 0) >= (value["version"] as? Int ?? 0) { return }
        }
        let state = value["state"] as? String ?? ""
        if state == "ringing" && (value["expiresAt"] as? Double ?? 0) <= Date().timeIntervalSince1970 * 1000 { return }
        let ranks = ["ringing", "connecting", "active", "ended"]
        guard let rank = ranks.firstIndex(of: state), (value["version"] as? Int ?? 0) > 0 else { return }
        if let previous = snapshot, previous["callId"] as? String == id, let oldRank = ranks.firstIndex(of: previous["state"] as? String ?? ""), rank < oldRank { return }
        if snapshot?["callId"] as? String != id { microphone = true; camera = value["mediaType"] as? String == "video" }
        snapshot = value; emit("snapshot", ["snapshot": value])
        if state == "ended" { finish(); return }
        expiryTask?.cancel(); expiryTask = nil
        if state == "ringing" || state == "connecting" {
            let limit = state == "ringing" ? 45000.0 : 30000.0
            let now = Date().timeIntervalSince1970 * 1000
            let deadline = value[state == "ringing" ? "expiresAt" : "connectExpiresAt"] as? Double ?? (now + limit)
            expiryTask = Task { @MainActor in
                do { try await Task.sleep(nanoseconds: UInt64(max(0, min(limit, deadline - now)) * 1_000_000)) } catch { return }
                if self.snapshot?["callId"] as? String == id && self.snapshot?["state"] as? String == state { self.finish(state == "ringing" ? "timeout" : "connectionTimeout") }
            }
        }
        let caller = value["callerId"] as? String == user && value["callerDeviceId"] as? String == configuration["deviceId"] as? String
        let accepted = value["acceptedDeviceId"] as? String ?? ""
        if value["calleeId"] as? String == user && !accepted.isEmpty && accepted != configuration["deviceId"] as? String { finish("answeredElsewhere"); return }
        if state == "ringing" {
            if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls {
                system.register(value, uuid: uuid(id), incoming: !caller)
            } else if !caller && UIApplication.shared.applicationState != .active {
                let content = UNMutableNotificationContent(); content.title = "Nuwax"; content.body = value["displayName"] as? String ?? ""; content.sound = .default
                content.userInfo = ["callId": id]
                UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "voip-\(id)", content: content, trigger: nil))
            }
        } else if caller || accepted == configuration["deviceId"] as? String { connectMedia(value) }
    }
    fileprivate func action(_ action: String, answerMediaType: String = "audio") async -> Bool {
        guard let value = snapshot, let id = value["callId"] as? String else { return false }
        let run = generation, token = configuration["accessToken"] as? String
        if action == "accept" && !permissions(answerMediaType) { emit("error", ["code": "CALL_PERMISSION_REQUIRED"]); return false }
        if ["end", "cancel", "reject"].contains(action) { await releaseMedia() }
        do {
            let result = try await request("/\(id)/actions", body: ["action": action, "actionId": UUID().uuidString, "answerMediaType": answerMediaType])
            guard snapshot?["callId"] as? String == id else { return false }
            adopt(result); return true
        } catch {
            guard run == generation, token == configuration["accessToken"] as? String, snapshot?["callId"] as? String == id else { return false }
            if action != "ready" { finish("failed") }
            emit("error", ["code": "CALL_ACTION_FAILED"]); return false
        }
    }
    fileprivate func permissions(_ type: String) -> Bool {
        AVCaptureDevice.authorizationStatus(for: .audio) == .authorized && (type != "video" || AVCaptureDevice.authorizationStatus(for: .video) == .authorized)
    }
    private func connectMedia(_ value: [String: Any]) {
        guard let id = value["callId"] as? String, id != mediaId else { return }
        mediaId = id; connected = false; peerReady = false; readySent = false
        let run = generation
        mediaTask = Task { @MainActor in
            do {
                if value["mediaType"] as? String != "video" { self.camera = false }
                guard self.permissions(self.camera ? "video" : "audio") else { throw VoipError.invalid }
                let credentials = try await self.request("/\(id)/credentials", body: [:])
                guard run == self.generation && !self.terminal.contains(id) else { return }
                let signal = credentials["serverUrl"] as? String ?? ""
                guard signal.hasPrefix("wss://") || (self.configuration["development"] as? Bool == true && signal.hasPrefix("ws://")) else { throw VoipError.invalid }
                let next = Room(delegate: self); self.room = next
                try await next.connect(url: credentials["serverUrl"] as? String ?? "", token: credentials["participantToken"] as? String ?? "")
                guard self.room === next && run == self.generation && !self.terminal.contains(id) else { await next.disconnect(); return }
                if #available(iOS 17.4, *), let system = self.systemBridge as? NuwaxSystemCalls {
                    system.mediaConnected(uuid: self.uuid(id))
                    for _ in 0..<100 {
                        if self.audioActive || Task.isCancelled { break }
                        try await Task.sleep(nanoseconds: 50_000_000)
                    }
                    guard self.audioActive else { throw VoipError.invalid }
                } else {
                    AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = true
                    let session = AVAudioSession.sharedInstance(); try session.setCategory(.playAndRecord, mode: .voiceChat); try session.setActive(true)
                }
                try await next.localParticipant.setMicrophone(enabled: self.microphone)
                if self.camera && UIApplication.shared.applicationState == .active { try await next.localParticipant.setCamera(enabled: true) }
                guard self.room === next && run == self.generation else { await next.disconnect(); return }
                self.connected = true; self.emit("connected"); self.refreshViews(); self.maybeReady()
            } catch { if run == self.generation && !self.terminal.contains(id) { self.finish("mediaFailed"); self.emit("error", ["code": "CALL_MEDIA_FAILED"]) } }
        }
    }
    private func maybeReady() {
        if connected && peerReady && !readySent { readySent = true; Task { _ = await self.action("ready") } }
    }
    fileprivate func setMicrophone(_ enabled: Bool) async {
        microphone = enabled; try? await room?.localParticipant.setMicrophone(enabled: enabled); emit("microphone", ["enabled": enabled])
    }
    private func setCamera(_ enabled: Bool) async {
        if enabled && !permissions("video") { emit("error", ["code": "CALL_PERMISSION_REQUIRED"]); return }
        guard snapshot?["mediaType"] as? String == "video" else { return }
        camera = enabled; try? await room?.localParticipant.setCamera(enabled: enabled); refreshViews(); emit("camera", ["enabled": enabled])
    }
    private func refreshViews() {
        views.removeAll { $0.view == nil }
        for item in views {
            let track = item.local ? room?.localParticipant.videoTracks.first?.track : room?.remoteParticipants.values.first?.videoTracks.first?.track
            item.view?.track = track as? VideoTrack
        }
    }
    private func releaseMedia() async {
        let old = room; room = nil; for view in views { view.view?.track = nil }
        await old?.disconnect(); connected = false; peerReady = false
    }
    fileprivate func finish(_ reason: String = "") {
        if !reason.isEmpty && reason != "answeredElsewhere" && reason != "sessionChanged" { closeServerCall() }
        if let id = snapshot?["callId"] as? String {
            terminal.insert(id)
            if terminal.count > 128, let expired = terminal.first { terminal.remove(expired); callUUIDs.removeValue(forKey: expired) }
            if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.end(uuid: uuid(id)) }
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["voip-\(id)"])
        }
        expiryTask?.cancel(); expiryTask = nil
        mediaTask?.cancel(); mediaTask = nil; mediaId = ""
        let old = room; room = nil; for item in views { item.view?.track = nil }
        Task { await old?.disconnect() }
        if !reason.isEmpty { emit("localEnded", ["reason": reason]) }
        snapshot = nil; connected = false; peerReady = false; readySent = false
    }
    private func closeServerCall() {
        if let call = snapshot, let id = call["callId"] as? String, let base = configuration["apiBaseUrl"] as? String, let url = URL(string: base + prefix + "/\(id)/actions") {
            var request = URLRequest(url: url, timeoutInterval: 4); request.httpMethod = "POST"
            request.setValue("Bearer \(configuration["accessToken"] as? String ?? "")", forHTTPHeaderField: "Authorization")
            request.setValue(configuration["deviceId"] as? String, forHTTPHeaderField: "X-Call-Device-Id")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let action = call["state"] as? String == "ringing" && call["calleeId"] as? String == configuration["userId"] as? String ? "reject" : "end"
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["action": action, "actionId": UUID().uuidString])
            URLSession.shared.dataTask(with: request).resume()
        }
    }
    private func reset() {
        closeServerCall()
        generation += 1; stream?.cancel(); stream = nil; finish("sessionChanged")
        pushRegistry?.desiredPushTypes = []; pushRegistry = nil
        if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.invalidate() }
        systemBridge = nil; configuration = [:]; events = []; terminal = []; callUUIDs = [:]
        UserDefaults.standard.removeObject(forKey: "nuwax-voip-install-session")
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service] as CFDictionary)
    }
    fileprivate func uuid(_ id: String) -> UUID { if let existing = callUUIDs[id] { return existing }; let result = UUID(); callUUIDs[id] = result; if !configuration.isEmpty { persist() }; return result }
    fileprivate func ownsSystemUUID(_ uuid: UUID) -> Bool {
        guard let id = snapshot?["callId"] as? String else { return false }; return callUUIDs[id] == uuid
    }
    fileprivate func ownsSystemManager(_ manager: AnyObject) -> Bool { systemBridge === manager }
    fileprivate func audioActivated(_ active: Bool) {
        audioActive = active
        if active { try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat) }
        try? AudioManager.shared.setEngineAvailability(active ? .default : .none)
    }
    private func persist() {
        var stored = configuration; stored["systemUUIDs"] = callUUIDs.mapValues { $0.uuidString }
        guard let data = try? JSONSerialization.data(withJSONObject: stored) else { return }
        let query = [kSecClass: kSecClassGenericPassword, kSecAttrService: service] as [CFString: Any]
        SecItemDelete(query as CFDictionary)
        var item = query; item[kSecValueData] = data; item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(item as CFDictionary, nil) != errSecSuccess { emit("error", ["code": "CALL_SECURE_STORAGE_FAILED"]) }
    }
    private func restore() {
        guard configuration.isEmpty, UserDefaults.standard.bool(forKey: "nuwax-voip-install-session") else { return }
        var result: CFTypeRef?
        let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data,
           let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { initialize(config) }
    }
}

extension NuwaxVoipBridge: RoomDelegate {
    public nonisolated func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        DispatchQueue.main.async { guard self.room === room else { return }; self.refreshViews()
            if publication.track is AudioTrack { self.peerReady = true; self.emit("peerMediaReady"); self.maybeReady() } }
    }
    public nonisolated func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) {
        DispatchQueue.main.async { if self.room === room { self.emit("reconnecting") } }
    }
    public nonisolated func room(_ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode) {
        DispatchQueue.main.async { if self.room === room { self.emit("connected") } }
    }
    public nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        DispatchQueue.main.async { if self.room === room { self.finish("disconnected") } }
    }
}
extension NuwaxVoipBridge: @preconcurrency PKPushRegistryDelegate {
    public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        Task { _ = try? await self.request("/devices", body: ["channel": "pushKit", "token": token,
            "bundleId": Bundle.main.bundleIdentifier ?? "", "environment": self.configuration["pushEnvironment"] as? String ?? "production"]) }
    }
    public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        Task { _ = try? await self.request("/devices", body: ["channel": "pushKit", "token": "", "environment": self.configuration["pushEnvironment"] as? String ?? "production", "revoked": true]) }
    }
    public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType) async {
        guard type == .voIP else { return }
        restore()
        let suppliedId = payload.dictionaryPayload["callId"] as? String
        let id = suppliedId ?? UUID().uuidString
        if #available(iOS 17.4, *) {
            let run = generation, systemUUID = uuid(id)
            let system = (systemBridge as? NuwaxSystemCalls) ?? NuwaxSystemCalls(owner: self)
            systemBridge = system
            // Even a stale/malformed delivery is reported, then immediately ended without capture.
            let validId = id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil
            let sameAccount = payload.dictionaryPayload["calleeId"] as? String == configuration["userId"] as? String && configuration["userId"] != nil
            var report = payload.dictionaryPayload
            if !sameAccount || !validId { report["displayName"] = "Nuwax"; report["mediaType"] = "audio" }
            do { try await system.reportIncoming(report, uuid: systemUUID) }
            catch { emit("error", ["code": "CALL_SYSTEM_UNAVAILABLE"]); return }
            guard run == generation else { system.end(uuid: systemUUID); return }
            let expired = (payload.dictionaryPayload["expiresAt"] as? Double ?? 0) <= Date().timeIntervalSince1970 * 1000
            if suppliedId == nil || !validId || !sameAccount || configuration.isEmpty || terminal.contains(id) || expired { system.end(uuid: systemUUID); return }
            do {
                adopt(try await request("/\(id)"))
                if snapshot?["callId"] as? String != id { system.end(uuid: systemUUID) }
            } catch { system.end(uuid: systemUUID); emit("error", ["code": "CALL_INVITATION_FAILED"]) }
        }
    }
}
private final class WeakVideoView {
    weak var view: VideoView?; let local: Bool
    init(_ view: VideoView, local: Bool) { self.view = view; self.local = local }
}
private enum VoipError: Error { case invalid }

@available(iOS 17.4, *)
@MainActor private final class NuwaxSystemCalls: NSObject, @preconcurrency ConversationManagerDelegate {
    private weak var owner: NuwaxVoipBridge?
    private let manager: ConversationManager
    private var registered = Set<UUID>()
    private var joining: [UUID: JoinConversationAction] = [:]
    private var answerModes: [UUID: String] = [:]
    init(owner: NuwaxVoipBridge) {
        self.owner = owner
        manager = ConversationManager(configuration: .init(ringtoneName: nil, iconTemplateImageData: nil,
            maximumConversationGroups: 1, maximumConversationsPerConversationGroup: 1,
            includesConversationInRecents: false, supportsVideo: true, supportedHandleTypes: [.generic]))
        super.init(); manager.delegate = self
    }
    func reportIncoming(_ payload: [AnyHashable: Any], uuid: UUID) async throws {
        guard !registered.contains(uuid) else { return }
        if manager.conversations.contains(where: { $0.uuid == uuid }) { registered.insert(uuid); return }
        registered.insert(uuid)
        let handle = Handle(type: .generic, value: payload["callId"] as? String ?? uuid.uuidString, displayName: payload["displayName"] as? String ?? "Nuwax")
        do { try await manager.reportNewIncomingConversation(uuid: uuid, update: .init(members: [handle], capabilities: payload["mediaType"] as? String == "video" ? [.video] : [])) }
        catch { registered.remove(uuid); throw error }
    }
    func register(_ snapshot: [String: Any], uuid: UUID, incoming: Bool) {
        guard !registered.contains(uuid) else { return }
        Task {
            do {
                if incoming { try await reportIncoming(snapshot, uuid: uuid) }
                else {
                    registered.insert(uuid)
                    let handle = Handle(type: .generic, value: snapshot["callId"] as? String ?? uuid.uuidString, displayName: snapshot["calleeDisplayName"] as? String ?? "Nuwax")
                    try await manager.perform([StartConversationAction(conversationUUID: uuid, handles: [handle], isVideo: snapshot["mediaType"] as? String == "video")])
                }
            } catch { owner?.finish("systemFailed") }
        }
    }
    func requestAnswer(uuid: UUID, mediaType: String) { answerModes[uuid] = mediaType; Task { do { try await manager.perform([JoinConversationAction(conversationUUID: uuid)]) } catch { owner?.finish("systemFailed") } } }
    func mediaConnected(uuid: UUID) {
        joining.removeValue(forKey: uuid)?.fulfill(dateConnected: Date())
        if let conversation = manager.conversations.first(where: { $0.uuid == uuid }) { manager.reportConversationEvent(.conversationConnected(Date()), for: conversation) }
    }
    func end(uuid: UUID) {
        joining.removeValue(forKey: uuid)?.fail()
        if let conversation = manager.conversations.first(where: { $0.uuid == uuid }) { manager.reportConversationEvent(.conversationEnded(Date(), .remoteEnded), for: conversation) }
        registered.remove(uuid)
    }
    func invalidate() { manager.invalidate(); joining = [:]; registered = [] }
    func conversationManager(_ manager: ConversationManager, perform action: ConversationAction) {
        guard owner?.ownsSystemUUID(action.conversationUUID) == true else { if action is EndConversationAction { action.fulfill() } else { action.fail() }; return }
        if let join = action as? JoinConversationAction {
            joining[join.conversationUUID] = join
            Task { if await owner?.action("accept", answerMediaType: answerModes.removeValue(forKey: join.conversationUUID) ?? "audio") != true { joining.removeValue(forKey: join.conversationUUID)?.fail() } }
        } else if let start = action as? StartConversationAction { start.fulfill(dateStarted: Date()) }
        else if let mute = action as? MuteConversationAction { Task { guard owner?.ownsSystemUUID(action.conversationUUID) == true else { action.fail(); return }; await owner?.setMicrophone(!mute.isMuted); action.fulfill() } }
        else if action is EndConversationAction { Task { guard owner?.ownsSystemUUID(action.conversationUUID) == true else { action.fulfill(); return }; _ = await owner?.action("end"); action.fulfill() } }
        else { action.fail() }
    }
    func conversationManager(_ manager: ConversationManager, conversationChanged conversation: Conversation) {}
    func conversationManagerDidBegin(_ manager: ConversationManager) {}
    func conversationManagerDidReset(_ manager: ConversationManager) { if owner?.ownsSystemManager(self) == true { owner?.finish("systemReset") } }
    func conversationManager(_ manager: ConversationManager, timedOutPerforming action: ConversationAction) { action.fail(); if owner?.ownsSystemUUID(action.conversationUUID) == true { owner?.finish("systemTimeout") } }
    func conversationManager(_ manager: ConversationManager, didActivate audioSession: AVAudioSession) { if owner?.ownsSystemManager(self) == true { owner?.audioActivated(true) } }
    func conversationManager(_ manager: ConversationManager, didDeactivate audioSession: AVAudioSession) { if owner?.ownsSystemManager(self) == true { owner?.audioActivated(false) } }
}
