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
    private var terminalOrder: [String] = []
    private var imSocket: URLSessionWebSocketTask?
    private var business: Bool { configuration["protocol"] as? String == "im-voip-v1" }
    private var stream: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var mediaTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var reconnectWindow = NuwaxVoipReconnectWindow()
    private var audioLifecycle: NuwaxVoipAudioLifecycle?
    private var systemPaused = false, audioInterrupted = false
    private var history = NuwaxVoipCallHistory()
    private var historyStorage: NuwaxVoipHistoryStorage?
    private var room: Room?
    private var mediaId = ""
    private var connected = false, peerReady = false, readySent = false
    private var microphone = true, camera = false, audioActive = false
    private var pushRegistry: PKPushRegistry?
    private var callUUIDs: [String: UUID] = [:]
    private struct PendingPush { let invitation: NuwaxVoipPushInvitation; var declined = false }
    private var pendingPushes: [UUID: PendingPush] = [:]
    private var pendingPushExpiry: [UUID: Task<Void, Never>] = [:]
    private var pushRegistration: NuwaxVoipApnsRegistration?
    private var systemBridge: AnyObject?
    #if DEBUG
    private var systemDiagnostics: NuwaxVoipSystemDiagnostics?
    #endif
    private var views: [WeakVideoView] = []
    private let prefix = "/api/instant-message/calls"
    private let service = "com.nuwax.voip.session"

    private func trace(_ stage: String) {
        #if DEBUG
        NSLog("[NuwaxVoipNative] %@", stage)
        #endif
    }

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
            if !microphone || mediaType != "video" { DispatchQueue.main.async { completion(microphone) }; return }
            AVCaptureDevice.requestAccess(for: .video) { camera in DispatchQueue.main.async { completion(microphone && camera) } }
        }
    }
    @objc public nonisolated static func openAppSettings() {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
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
    private func emitSnapshot(_ value: [String: Any]) {
        var nativeIncoming = false
        if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls,
           value["calleeId"] as? String == configuration["userId"] as? String,
           value["state"] as? String == "ringing", let id = value["callId"] as? String {
            // A failed system report must not open an ended-only incoming page.
            guard system.isPresented(uuid: uuid(id)) else { return }
            nativeIncoming = true
        }
        emit("snapshot", ["snapshot": value, "nativeIncomingUI": nativeIncoming])
    }
    fileprivate func systemIncomingReady(_ uuid: UUID) {
        guard validatedSystemUUID(uuid), let value = snapshot else { return }
        emitSnapshot(value)
    }
    fileprivate func systemIncomingFailed(_ uuid: UUID, error: Error) {
        guard validatedSystemUUID(uuid) else { return }
        let failure = NuwaxVoipIncomingFailure(error)
        emit("error", ["code": failure.code]); finish(failure.reason)
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
        case "history": emitHistory()
        case "clearHistory": history.clear(); saveHistory()
        case "invitation":
            if business, let conv = command["convId"] as? String, let msg = command["msgId"] as? String {
                guard [conv, msg].allSatisfy({ $0.range(of: "^[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil }) else { return }
                let run = generation
                Task {
                    guard run == self.generation else { return }
                    if let message = try? await self.request("/api/instant-message/messages/\(msg)?convId=\(conv)", absolute: true), run == self.generation { await self.receiveInvitation(message) }
                }
            }
        case "watch":
            if let value = command["snapshot"] as? [String: Any] {
                let id = value["callId"] as? String ?? ""
                let pending = pendingPushes.values.filter { !$0.declined }.map { $0.invitation.callId }
                guard NuwaxVoipCallPolicy.mayWatch(callID: id, currentID: snapshot?["callId"] as? String, pendingIDs: pending) else {
                    events.append(["type": "localEnded", "scope": configuration["scope"] as? String ?? "", "callId": id, "reason": "busy"])
                    if events.count > 256 { events.removeFirst(events.count - 256) }
                    if let current = snapshot { emitSnapshot(current) }
                    return
                }
                adopt(value)
            }
        case "action":
            let action = command["action"] as? String ?? ""
            if action == "accept", #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls, let id = snapshot?["callId"] as? String {
                system.requestAnswer(uuid: uuid(id), mediaType: command["answerMediaType"] as? String ?? "audio"); return
            }
            Task { guard self.snapshot?["callId"] as? String == commandId else { return }; await self.action(action, answerMediaType: command["answerMediaType"] as? String ?? "audio") }
        case "microphone":
            let enabled = command["enabled"] as? Bool ?? false
            if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.requestMute(uuid: uuid(commandId), muted: !enabled) }
            else { Task { guard self.snapshot?["callId"] as? String == commandId else { return }; await self.setMicrophone(enabled) } }
        case "camera": Task { guard self.snapshot?["callId"] as? String == commandId else { return }; await self.setCamera(command["enabled"] as? Bool ?? false) }
        case "audioRoute":
            selectAudioRoute(command["route"] as? String ?? "")
        case "speaker":
            selectAudioRoute(command["enabled"] as? Bool == true ? "speaker" : "earpiece")
        case "switchCamera":
            Task { guard self.snapshot?["callId"] as? String == commandId else { return }; if let track = self.room?.localParticipant.videoTracks.first?.track as? LocalVideoTrack,
                      let capturer = track.capturer as? CameraCapturer { _ = try? await capturer.switchCameraPosition() } }
        case "background":
            let target = room, id = snapshot?["callId"] as? String, run = generation
            Task {
                guard run == self.generation, self.snapshot?["callId"] as? String == id, self.room === target else { return }
                let visible = command["hidden"] as? Bool != true && UIApplication.shared.applicationState == .active
                try? await target?.localParticipant.setCamera(enabled: visible && self.camera)
                if run != self.generation || self.snapshot?["callId"] as? String != id || self.room !== target || UIApplication.shared.applicationState != .active {
                    try? await target?.localParticipant.setCamera(enabled: false)
                }
            }
        default: break
        }
    }
    private func initialize(_ config: [String: Any]) {
        trace("initialize requested")
        #if !DEBUG
        guard config["development"] as? Bool != true, config["businessEnabled"] as? Bool != true || config["qaAccepted"] as? Bool == true else { return }
        #endif
        guard config["development"] as? Bool == true || config["qaAccepted"] as? Bool == true || config["businessEnabled"] as? Bool == true,
              let base = config["apiBaseUrl"] as? String, let url = URL(string: base), url.host != nil,
              url.scheme == "https" || (config["development"] as? Bool == true && url.scheme == "http"),
              let token = config["accessToken"] as? String, !token.isEmpty,
              let user = config["userId"] as? String, !user.isEmpty else { return }
        // An internal QA IPA must reject a production context left in Keychain
        // by a prior installation, before opening any native transport.
        guard NuwaxVoipClientPolicy.allowsOrigin(base, pinnedOrigin: Bundle.main.object(forInfoDictionaryKey: "NuwaxAPIOrigin") as? String) else {
            trace("signed host origin mismatch rejected"); return
        }
        trace("initialize accepted")
        let same = configuration["userId"] as? String == user && configuration["apiBaseUrl"] as? String == base && configuration["deviceId"] as? String == config["deviceId"] as? String
        if !same { reset() }
        let savedRegistration = same ? configuration["apnsRegistration"] : nil
        configuration = config; configuration["pushProvider"] = "apns"
        if !same {
            historyStorage = NuwaxVoipHistoryStorage(origin: base, userID: user)
            history = NuwaxVoipCallHistory(data: historyStorage?.read(), recoveringAt: Date().timeIntervalSince1970 * 1000)
        }
        if configuration["apnsRegistration"] == nil { configuration["apnsRegistration"] = savedRegistration }
        // Refresh the transport when access credentials refresh; retain the exact registration identity.
        pushRegistration?.stop(revoke: false); pushRegistration = nil
        if let mapping = config["systemUUIDs"] as? [String: String] { for (key, value) in mapping { if let id = UUID(uuidString: value) { callUUIDs[key] = id } } }
        terminalOrder = NuwaxVoipCallPolicy.terminalHistory((config["terminalCallIds"] as? [String] ?? []) + terminalOrder)
        terminal = Set(terminalOrder)
        if !same {
            for record in history.records where record.reason == "processInterrupted" { rememberTerminal(record.callId) }
            saveHistory()
        } else { emitHistory() }
        if audioLifecycle == nil {
            audioLifecycle = NuwaxVoipAudioLifecycle(routeChanged: { [weak self] in self?.emitAudioRoutes() },
                interrupted: { [weak self] began, resume in self?.handleInterruption(began: began, resume: resume) },
                mediaReset: { [weak self] in if self?.snapshot != nil { self?.finish("audioReset") } },
                foreground: { [weak self] in self?.becameActive() },
                background: { [weak self] in
                    guard let self else { return }
                    self.executeOnMain(["op": "background", "scope": self.configuration["scope"] as? String ?? "", "hidden": true])
                })
        }
        #if DEBUG
        if systemDiagnostics == nil {
            systemDiagnostics = NuwaxVoipSystemDiagnostics(ownedUUIDs: { [weak self] in
                guard let self else { return [] }
                return Set(self.callUUIDs.values)
            })
        } else { systemDiagnostics?.report() }
        #endif
        let run = generation, settings = configuration
        let restored = (settings["apnsRegistration"] as? [String: Any]).flatMap { NuwaxVoipApnsDevice(stored: $0) }
        pushRegistration = NuwaxVoipApnsRegistration(restored: restored, transport: { [weak self] body in
            guard let self else { throw VoipError.invalid }
            return try await self.request("/devices", body: body, captured: settings)
        }, changed: { [weak self] state, ready in
            guard let self, run == self.generation else { return }
            self.emit("pushRegistration", ["provider": "apns", "state": state, "nativePush": ready])
        })
        persist()
        UserDefaults.standard.set(true, forKey: "nuwax-voip-install-session")
        if #available(iOS 17.4, *) {
            if systemBridge == nil { systemBridge = NuwaxSystemCalls(owner: self) }
            AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = false
            updateAudioEngine()
            if pushRegistry == nil {
                let registry = PKPushRegistry(queue: .main)
                registry.delegate = self
                pushRegistry = registry
                registry.desiredPushTypes = [.voIP]
            }
        }
        if let registry = pushRegistry, let token = registry.pushToken(for: .voIP) { updatePushToken(token, registry: registry) }
        startStream()
        if let value = snapshot {
            emitSnapshot(value)
            if connected { emit("connected") }; if peerReady { emit("peerMediaReady") }
        }
    }
    private func request(_ path: String, body: [String: Any]? = nil, absolute: Bool = false, captured: [String: Any]? = nil) async throws -> [String: Any] {
        let run = generation; let config = captured ?? configuration
        guard let base = config["apiBaseUrl"] as? String, let url = URL(string: base + (absolute ? "" : prefix) + path) else { throw VoipError.invalid }
        var request = URLRequest(url: url, timeoutInterval: 4)
        request.setValue("Bearer \(config["accessToken"] as? String ?? "")", forHTTPHeaderField: "Authorization")
        request.setValue(config["deviceId"] as? String, forHTTPHeaderField: "X-Call-Device-Id")
        if let body { request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await URLSession.shared.data(for: request)
        if captured == nil, run == generation, (response as? HTTPURLResponse)?.statusCode == 401,
           config["accessToken"] as? String == configuration["accessToken"] as? String {
            invalidateSession("sessionExpired"); throw VoipError.invalid
        }
        guard (captured != nil || run == generation), (response as? HTTPURLResponse)?.statusCode == 200,
              let envelope = try JSONSerialization.jsonObject(with: data) as? [String: Any], envelope["code"] as? String == "0000",
              let value = envelope["data"] as? [String: Any] else { throw VoipError.invalid }
        return value
    }
    private func invalidateSession(_ reason: String) {
        let event: [String: Any] = ["type": "localEnded", "scope": configuration["scope"] as? String ?? "",
                                   "callId": snapshot?["callId"] as? String ?? "", "reason": reason]
        var error = event; error["type"] = "error"; error["code"] = "CALL_SESSION_EXPIRED"
        reset(); events.append(error); events.append(event)
    }
    private func startStream() {
        imSocket?.cancel(with: .goingAway, reason: nil); imSocket = nil
        stream?.cancel(); if business { startImStream(); return }; let run = generation; let config = configuration
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
                        self.invalidateSession("sessionExpired"); return
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
    private func wireString(_ value: Any?) -> String { value.map { String(describing: $0) } ?? "" }
    private func frame(_ op: Int, _ body: [String: Any] = [:]) -> String {
        let data = try? JSONSerialization.data(withJSONObject: ["v": 1, "op": op, "reqId": UUID().uuidString, "ts": Int64(Date().timeIntervalSince1970 * 1000), "body": body])
        return String(data: data ?? Data(), encoding: .utf8) ?? ""
    }
    /** Separate IM tab keeps the app's ordinary device route and push registration intact. */
    private func startImStream() {
        let run = generation, config = configuration
        stream = Task { @MainActor in
            var retry: UInt64 = 1_000_000_000
            while !Task.isCancelled && run == self.generation {
                let base = (config["apiBaseUrl"] as? String ?? "").replacingOccurrences(of: "https://", with: "wss://").replacingOccurrences(of: "http://", with: "ws://")
                guard let url = URL(string: base + "/instant-message/ws") else { return }
                let socket = URLSession.shared.webSocketTask(with: url, protocols: ["im-v1"]); self.imSocket = socket
                self.trace("control opening")
                socket.resume()
                var heartbeat: Task<Void, Never>?
                var rejected = false
                let handshake = Task { @MainActor in
                    do { try await Task.sleep(nanoseconds: 10_000_000_000) } catch { return }
                    socket.cancel(with: .goingAway, reason: nil)
                }
                do {
                    let physical = (config["deviceId"] as? String ?? "").components(separatedBy: "#").first ?? ""
                    try await socket.send(.string(self.frame(1000, ["token": config["accessToken"] as? String ?? "", "deviceId": physical + "#voip", "platform": "ios", "lastAckSeq": 0])))
                    while !Task.isCancelled && run == self.generation {
                        let received = try await socket.receive()
                        guard self.imSocket === socket, run == self.generation else { break }
                        guard case .string(let text) = received, let bytes = text.data(using: .utf8), let env = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] else { continue }
                        let body = env["body"] as? [String: Any] ?? [:]
                        switch env["op"] as? Int ?? 0 {
                        case 1001:
                            self.trace("control authenticated")
                            handshake.cancel(); heartbeat?.cancel(); retry = 1_000_000_000
                            let interval = UInt64(max(5, min(60, body["heartbeatInterval"] as? Int ?? 30))) * 1_000_000_000
                            heartbeat = Task { @MainActor in
                                while !Task.isCancelled {
                                    do { try await Task.sleep(nanoseconds: interval); try await socket.send(.string(self.frame(2000))); socket.sendPing { error in if error != nil { socket.cancel(with: .goingAway, reason: nil) } } }
                                    catch { socket.cancel(with: .goingAway, reason: nil); return }
                                }
                            }
                        case 1002, 9000:
                            rejected = true; self.trace("control rejected")
                            if config["accessToken"] as? String == self.configuration["accessToken"] as? String {
                                self.invalidateSession((env["op"] as? Int) == 9000 ? "sessionReplaced" : "sessionExpired")
                            }
                            socket.cancel(with: .normalClosure, reason: nil)
                        case 3002:
                            if body["msgType"] as? String == "voip" {
                                try await socket.send(.string(self.frame(3003, ["convId": self.wireString(body["convId"]), "seq": body["seq"] ?? 0])))
                                await self.receiveInvitation(body)
                            }
                        case 3007: self.receiveSignal(body)
                        default: break
                        }
                        if rejected { break }
                    }
                } catch { self.trace("control connection failed") }
                handshake.cancel(); heartbeat?.cancel(); socket.cancel(with: .goingAway, reason: nil)
                if self.imSocket === socket { self.imSocket = nil }
                if rejected || Task.isCancelled { return }
                try? await Task.sleep(nanoseconds: retry); retry = min(30_000_000_000, retry * 2)
            }
        }
    }
    private func receiveInvitation(_ message: [String: Any]) async {
        trace("control invitation received")
        guard let next = await businessInvitation(message), let id = next["callId"] as? String, !terminal.contains(id), snapshot?["callId"] as? String != id else { return }
        adoptBusinessInvitation(next)
    }
    private func businessInvitation(_ message: [String: Any]) async -> [String: Any]? {
        let run = generation, user = configuration["userId"] as? String
        guard message["msgType"] as? String == "voip", (message["senderType"] as? Int ?? 1) == 1, (message["msgStatus"] as? Int ?? 1) == 1,
              let body = message["body"] as? [String: Any], let id = body["callId"] as? String, let roomName = body["roomName"] as? String,
              let media = body["mediaType"] as? String, ["audio", "video"].contains(media), !roomName.isEmpty,
              id.range(of: "^[A-Za-z0-9_-]{1,128}$", options: .regularExpression) != nil else { return nil }
        let sender = wireString(message["senderId"]), conv = wireString(message["convId"]), sent = (message["sendTime"] as? NSNumber)?.doubleValue ?? 0
        guard sender != user, sent > 0, sent + 60000 > Date().timeIntervalSince1970 * 1000,
              [sender, conv].allSatisfy({ $0.range(of: "^[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil }) else { return nil }
        guard let conversation = try? await request("/api/instant-message/conversations/\(conv)", absolute: true),
              run == generation, user == configuration["userId"] as? String,
              conversation["convType"] as? Int == 1, wireString(conversation["peerUserId"]) == sender else { return nil }
        let next: [String: Any] = ["protocol": "im-voip-v1", "callId": id, "roomName": roomName, "msgId": wireString(message["msgId"]), "convId": conv, "version": 1, "state": "ringing", "callerId": sender, "calleeId": configuration["userId"] as? String ?? "", "callerDeviceId": "", "acceptedDeviceId": "", "mediaType": media, "displayName": conversation["peerName"] as? String ?? sender, "callerDisplayName": conversation["peerName"] as? String ?? sender, "calleeDisplayName": configuration["userId"] as? String ?? "", "expiresAt": sent + 60000]
        return next
    }
    private func adoptBusinessInvitation(_ next: [String: Any]) {
        guard let id = next["callId"] as? String, !terminal.contains(id) else { return }
        if snapshot != nil && snapshot?["callId"] as? String != id { notifyBusinessEnd(next, reason: "busy"); rememberTerminal(id); return }
        adopt(next)
    }
    private func receiveSignal(_ event: [String: Any]) {
        guard let payload = event["payload"] as? [String: Any] else { return }
        let type = event["eventType"] as? String ?? "", id = wireString(payload["callId"])
        let conv = wireString(payload["convId"])
        guard !conv.isEmpty else { return }
        if let call = snapshot, wireString(call["convId"]) == conv,
           NuwaxVoipCallPolicy.matches(signalID: id, messageID: wireString(payload["msgId"]), callID: wireString(call["callId"]), callMessageID: wireString(call["msgId"])) {
            if type == "voip:answered" {
                if call["calleeId"] as? String == configuration["userId"] as? String && wireString(call["acceptedDeviceId"]).isEmpty { finish("answeredElsewhere", notifyRemote: false) }
                else if call["callerId"] as? String == configuration["userId"] as? String && call["state"] as? String == "ringing" { project("connecting") }
            } else if let reason = NuwaxVoipCallPolicy.signalEndReason(type: type, state: wireString(call["state"])) { finish(reason, notifyRemote: false) }
            return
        }
        // Terminal-before-invitation ordering, including another device's answer.
        // An unrelated conversation may never tombstone the current call.
        guard !id.isEmpty, snapshot?["callId"] as? String != id,
              ["voip:cancel", "voip:timeout", "voip:decline"].contains(type) || (type == "voip:answered" && wireString(payload["userId"]) == configuration["userId"] as? String) else { return }
        rememberTerminal(id)
        for (key, pending) in pendingPushes where pending.invitation.callId == id {
            removePendingPush(key)
            if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.end(uuid: key) }
        }
    }
    private func project(_ state: String, media: String? = nil) {
        guard var call = snapshot else { return }
        call["state"] = state; call["version"] = (call["version"] as? Int ?? 0) + 1
        if let media { call["mediaType"] = media }
        if state == "connecting" {
            if call["calleeId"] as? String == configuration["userId"] as? String { call["acceptedDeviceId"] = configuration["deviceId"] }
            call["connectExpiresAt"] = Date().timeIntervalSince1970 * 1000 + 30000
        }
        if state == "active" { call["connectedAt"] = Date().timeIntervalSince1970 * 1000 }
        adopt(call)
    }
    private func businessCredentials(_ call: [String: Any]) async throws -> [String: Any] {
        let room = wireString(call["roomName"]).addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
        let result = try await request("/api/instant-message/meetings/rtc/rooms/\(room)/tokens", body: ["platform": "ios", "deviceId": configuration["deviceId"] as? String ?? "", "displayName": configuration["userId"] as? String ?? ""], absolute: true)
        return ["serverUrl": result["wsUrl"] as? String ?? "", "participantToken": result["token"] as? String ?? ""]
    }
    private func businessBody(_ call: [String: Any]) -> [String: Any] {
        ["convId": wireString(call["convId"]), "msgId": wireString(call["msgId"]), "callId": wireString(call["callId"]), "roomName": wireString(call["roomName"])]
    }
    private func mediaJoined() async throws {
        guard let call = snapshot else { return }
        let settings = configuration, run = generation
        if call["callerId"] as? String == configuration["userId"] as? String {
            let result = try await request("/api/instant-message/messages", body: ["convId": wireString(call["convId"]), "deviceId": configuration["deviceId"] as? String ?? "", "clientMsgId": wireString(call["callId"]), "msgType": "voip", "body": ["callId": wireString(call["callId"]), "roomName": wireString(call["roomName"]), "mediaType": wireString(call["mediaType"])]], absolute: true, captured: settings)
            guard run == generation, snapshot?["callId"] as? String == call["callId"] as? String else { var late = call; late["msgId"] = wireString(result["msgId"]); notifyBusinessEnd(late, reason: "cancel", captured: settings); return }
            if var next = snapshot { next["msgId"] = wireString(result["msgId"]); next["version"] = (next["version"] as? Int ?? 0) + 1; snapshot = next; emitSnapshot(next) }
        } else { _ = try await request("/answered", body: businessBody(call)) }
    }
    private func businessAction(_ action: String, media: String) async -> Bool {
        guard let call = snapshot else { return false }
        switch action {
        case "accept":
            guard call["calleeId"] as? String == configuration["userId"] as? String,
                  media == "audio" || (media == "video" && call["mediaType"] as? String == "video") else { return false }
            guard call["state"] as? String == "ringing", permissions(media) else { emit("error", ["code": "CALL_PERMISSION_REQUIRED"]); return false }
            project("connecting", media: call["mediaType"] as? String == "video" ? media : "audio"); return true
        case "ready": if connected && peerReady { project("active") }; return true
        case "end", "cancel", "reject": finish(NuwaxVoipCallPolicy.endReason(action: action, state: wireString(call["state"]), callee: call["calleeId"] as? String == configuration["userId"] as? String)); return true
        default: return false
        }
    }
    private func notifyBusinessEnd(_ call: [String: Any], reason: String, captured: [String: Any]? = nil) {
        let settings = captured ?? configuration
        guard !wireString(call["msgId"]).isEmpty, !["remoteEnded", "remoteCancelled", "answeredElsewhere", "sessionChanged"].contains(reason) else { return }
        let caller = call["callerId"] as? String == settings["userId"] as? String
        if !caller && !NuwaxVoipCallPolicy.canDecline(reason: reason, state: wireString(call["state"])) { return }
        guard let base = settings["apiBaseUrl"] as? String, let url = URL(string: base + prefix + (caller ? "/ended" : "/declined")) else { return }
        var body = businessBody(call); if caller { body["reason"] = reason == "timeout" ? "timeout" : "cancel" }
        var request = URLRequest(url: url, timeoutInterval: 4); request.httpMethod = "POST"
        request.setValue("Bearer \(settings["accessToken"] as? String ?? "")", forHTTPHeaderField: "Authorization"); request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try? JSONSerialization.data(withJSONObject: body); URLSession.shared.dataTask(with: request).resume()
    }

    private func adopt(_ value: [String: Any]) {
        guard let id = value["callId"] as? String, !terminal.contains(id), let user = configuration["userId"] as? String,
              value["callerId"] as? String == user || value["calleeId"] as? String == user else { return }
        if value["callerId"] as? String == user && value["callerDeviceId"] as? String != configuration["deviceId"] as? String { return }
        if let previous = snapshot {
            if previous["callId"] as? String != id && previous["state"] as? String != "ended" { return }
            if previous["callId"] as? String == id && (previous["version"] as? Int ?? 0) >= (value["version"] as? Int ?? 0) { return }
        }
        let state = value["state"] as? String ?? ""
        if state == "ringing" && (value["expiresAt"] as? Double ?? 0) <= Date().timeIntervalSince1970 * 1000 { return }
        let ranks = ["ringing", "connecting", "active", "ended"]
        guard let rank = ranks.firstIndex(of: state), (value["version"] as? Int ?? 0) > 0 else { return }
        if let previous = snapshot, previous["callId"] as? String == id, let oldRank = ranks.firstIndex(of: previous["state"] as? String ?? ""), rank < oldRank { return }
        if snapshot?["callId"] as? String != id { microphone = true; camera = value["mediaType"] as? String == "video"; systemPaused = false; audioInterrupted = false }
        snapshot = value; observeHistory(value); emitSnapshot(value)
        if state == "ended" { finish(); return }
        expiryTask?.cancel(); expiryTask = nil
        if state == "ringing" || state == "connecting" {
            let limit = state == "ringing" ? (business ? 60000.0 : 45000.0) : 30000.0
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
        }
        if (state != "ringing" || (business && caller)) && (caller || accepted == configuration["deviceId"] as? String) { connectMedia(value) }
    }
    fileprivate func action(_ action: String, answerMediaType: String = "audio") async -> Bool {
        guard let value = snapshot, let id = value["callId"] as? String else { return false }
        let run = generation, token = configuration["accessToken"] as? String
        if business { return await businessAction(action, media: answerMediaType) }
        if ["end", "cancel", "reject"].contains(action) {
            finish(NuwaxVoipCallPolicy.endReason(action: action, state: wireString(value["state"]), callee: value["calleeId"] as? String == configuration["userId"] as? String))
            return true
        }
        if action == "accept" && !permissions(answerMediaType) { emit("error", ["code": "CALL_PERMISSION_REQUIRED"]); return false }
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
                let credentials = try await (self.business ? self.businessCredentials(value) : self.request("/\(id)/credentials", body: [:]))
                guard !Task.isCancelled, run == self.generation, self.snapshot?["callId"] as? String == id, !self.terminal.contains(id) else { return }
                let signal = credentials["serverUrl"] as? String ?? ""
                guard signal.hasPrefix("wss://") || (self.configuration["development"] as? Bool == true && signal.hasPrefix("ws://")) else { throw VoipError.invalid }
                let next = Room(delegate: self); self.room = next
                try await next.connect(url: credentials["serverUrl"] as? String ?? "", token: credentials["participantToken"] as? String ?? "")
                guard !Task.isCancelled, self.room === next, run == self.generation, self.snapshot?["callId"] as? String == id, !self.terminal.contains(id) else { await next.disconnect(); return }
                if #available(iOS 17.4, *), let system = self.systemBridge as? NuwaxSystemCalls {
                    system.mediaConnected(uuid: self.uuid(id))
                    for _ in 0..<100 {
                        if self.audioActive || Task.isCancelled { break }
                        try await Task.sleep(nanoseconds: 50_000_000)
                    }
                    guard self.audioActive else { throw VoipError.invalid }
                } else {
                    AudioManager.shared.audioSession.isAutomaticConfigurationEnabled = true
                    let session = AVAudioSession.sharedInstance(); try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth]); try session.setActive(true)
                    self.audioActive = true; self.updateAudioEngine()
                }
                guard !Task.isCancelled, self.room === next, run == self.generation, self.snapshot?["callId"] as? String == id else { await next.disconnect(); return }
                try await next.localParticipant.setMicrophone(enabled: self.microphone)
                guard !Task.isCancelled, self.room === next, run == self.generation, self.snapshot?["callId"] as? String == id else { await next.disconnect(); return }
                if self.camera && UIApplication.shared.applicationState == .active { try await next.localParticipant.setCamera(enabled: true) }
                if UIApplication.shared.applicationState != .active { try? await next.localParticipant.setCamera(enabled: false) }
                guard !Task.isCancelled, self.room === next, run == self.generation, self.snapshot?["callId"] as? String == id else { await next.disconnect(); return }
                self.connected = true; self.emit("connected"); self.emitAudioRoutes(); self.refreshViews(); self.announceMediaReady()
                if self.business {
                    Task { @MainActor in
                        guard run == self.generation, self.snapshot?["callId"] as? String == id else { return }
                        do { try await self.mediaJoined() }
                        catch { if run == self.generation && self.snapshot?["callId"] as? String == id { self.finish("mediaFailed") } }
                    }
                }
                self.maybeReady()
            } catch { if run == self.generation && !self.terminal.contains(id) { self.finish("mediaFailed"); self.emit("error", ["code": "CALL_MEDIA_FAILED"]) } }
        }
    }
    private func maybeReady() {
        if connected && peerReady && !readySent, let id = snapshot?["callId"] as? String {
            readySent = true; let run = generation
            if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.peerMediaReady(uuid: uuid(id)) }
            Task { guard run == self.generation, self.snapshot?["callId"] as? String == id else { return }; _ = await self.action("ready") }
        }
    }
    fileprivate func announceMediaReady() {
        guard connected, let target = room, let id = snapshot?["callId"] as? String,
              let data = try? JSONSerialization.data(withJSONObject: ["v": 1, "type": "ready", "callId": id]) else { return }
        let run = generation
        Task {
            guard run == self.generation, self.room === target, self.snapshot?["callId"] as? String == id else { return }
            try? await target.localParticipant.publish(data: data, options: DataPublishOptions(topic: NuwaxVoipCallPolicy.readyTopic, reliable: true))
        }
    }
    @discardableResult fileprivate func setMicrophone(_ enabled: Bool) async -> Bool {
        let target = room, id = snapshot?["callId"] as? String, run = generation
        do { try await target?.localParticipant.setMicrophone(enabled: enabled) }
        catch { if run == generation, snapshot?["callId"] as? String == id { emit("error", ["code": "CALL_MEDIA_FAILED"]) }; return false }
        guard run == generation, snapshot?["callId"] as? String == id, room === target else {
            try? await target?.localParticipant.setMicrophone(enabled: false); return false
        }
        microphone = enabled; emit("microphone", ["enabled": enabled]); return true
    }
    private func setCamera(_ enabled: Bool) async {
        if enabled && !permissions("video") { emit("error", ["code": "CALL_PERMISSION_REQUIRED"]); return }
        guard snapshot?["mediaType"] as? String == "video" else { return }
        let target = room, id = snapshot?["callId"] as? String, run = generation
        do { try await target?.localParticipant.setCamera(enabled: enabled && UIApplication.shared.applicationState == .active) }
        catch { if run == generation, snapshot?["callId"] as? String == id { emit("error", ["code": "CALL_MEDIA_FAILED"]) }; return }
        if run != generation || snapshot?["callId"] as? String != id || room !== target || UIApplication.shared.applicationState != .active {
            try? await target?.localParticipant.setCamera(enabled: false)
        }
        guard run == generation, snapshot?["callId"] as? String == id, room === target else { return }
        camera = enabled; refreshViews(); emit("camera", ["enabled": enabled])
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
        connected = false; peerReady = false; await old?.disconnect()
    }
    fileprivate func finish(_ reason: String = "", notifyRemote: Bool = true) {
        trace("call ending reason=\(reason.isEmpty ? "remoteState" : reason)")
        if notifyRemote && !reason.isEmpty && reason != "answeredElsewhere" && reason != "sessionChanged" { closeServerCall(reason) }
        if let id = snapshot?["callId"] as? String {
            history.end(callID: id, reason: reason.isEmpty ? (snapshot?["reason"] as? String ?? "ended") : reason, now: Date().timeIntervalSince1970 * 1000); saveHistory()
            rememberTerminal(id)
            if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.end(uuid: uuid(id)) }
            UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: ["voip-\(id)", "voip-permission-\(id)"])
            UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: ["voip-\(id)", "voip-permission-\(id)"])
        }
        expiryTask?.cancel(); expiryTask = nil
        mediaTask?.cancel(); mediaTask = nil; mediaId = ""
        reconnectTask?.cancel(); reconnectTask = nil; reconnectWindow.cancel()
        let old = room; room = nil; for item in views { item.view?.track = nil }
        audioActive = false; systemPaused = false; audioInterrupted = false
        try? AudioManager.shared.setEngineAvailability(.none)
        let run = generation
        Task {
            await old?.disconnect()
            if #unavailable(iOS 17.4), run == self.generation, self.snapshot == nil, self.room == nil {
                try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            }
        }
        if !reason.isEmpty { emit("localEnded", ["reason": reason]) }
        snapshot = nil; connected = false; peerReady = false; readySent = false
    }
    private func closeServerCall(_ reason: String = "") {
        if business { if let call = snapshot { notifyBusinessEnd(call, reason: reason) }; return }
        if let call = snapshot, let id = call["callId"] as? String, let base = configuration["apiBaseUrl"] as? String, let url = URL(string: base + prefix + "/\(id)/actions") {
            var request = URLRequest(url: url, timeoutInterval: 4); request.httpMethod = "POST"
            request.setValue("Bearer \(configuration["accessToken"] as? String ?? "")", forHTTPHeaderField: "Authorization")
            request.setValue(configuration["deviceId"] as? String, forHTTPHeaderField: "X-Call-Device-Id")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let action = call["state"] as? String == "ringing" ? (call["calleeId"] as? String == configuration["userId"] as? String ? "reject" : "cancel") : "end"
            request.httpBody = try? JSONSerialization.data(withJSONObject: ["action": action, "actionId": UUID().uuidString])
            URLSession.shared.dataTask(with: request).resume()
        }
    }
    private func reset() {
        closeServerCall()
        generation += 1; imSocket?.cancel(with: .goingAway, reason: nil); imSocket = nil; stream?.cancel(); stream = nil; finish("sessionChanged")
        pushRegistration?.stop(revoke: true); pushRegistration = nil
        for task in pendingPushExpiry.values { task.cancel() }; pendingPushExpiry = [:]; pendingPushes = [:]
        pushRegistry?.desiredPushTypes = []; pushRegistry = nil
        if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.invalidate() }
        systemBridge = nil; configuration = [:]; events = []; terminal = []; terminalOrder = []; callUUIDs = [:]
        audioLifecycle?.stop(); audioLifecycle = nil; history = NuwaxVoipCallHistory(); historyStorage = nil
        UserDefaults.standard.removeObject(forKey: "nuwax-voip-install-session")
        SecItemDelete([kSecClass: kSecClassGenericPassword, kSecAttrService: service] as CFDictionary)
    }
    private func removePendingPush(_ uuid: UUID) {
        pendingPushExpiry.removeValue(forKey: uuid)?.cancel()
        pendingPushes.removeValue(forKey: uuid)
    }
    private func expirePendingPush(_ uuid: UUID, invitation: NuwaxVoipPushInvitation) {
        let run = generation
        pendingPushExpiry[uuid] = Task { @MainActor in
            let wait = max(0, invitation.expiresAt - Date().timeIntervalSince1970 * 1000)
            do { try await Task.sleep(nanoseconds: UInt64(wait * 1_000_000)) } catch { return }
            guard run == self.generation, self.pendingPushes[uuid] != nil, !self.validatedSystemUUID(uuid) else { return }
            self.rememberTerminal(invitation.callId)
            self.removePendingPush(uuid)
            if #available(iOS 17.4, *), let system = self.systemBridge as? NuwaxSystemCalls { system.end(uuid: uuid) }
        }
    }
    fileprivate func uuid(_ id: String) -> UUID { if let existing = callUUIDs[id] { return existing }; let result = UUID(); callUUIDs[id] = result; if !configuration.isEmpty { persist() }; return result }
    fileprivate func ownsSystemUUID(_ uuid: UUID) -> Bool {
        validatedSystemUUID(uuid) || (pendingPushes[uuid] != nil && pendingPushes[uuid]?.declined == false)
    }
    fileprivate func validatedSystemUUID(_ uuid: UUID) -> Bool {
        guard let id = snapshot?["callId"] as? String else { return false }; return callUUIDs[id] == uuid
    }
    fileprivate func endSystemCall(_ uuid: UUID) {
        if var pending = pendingPushes[uuid], !validatedSystemUUID(uuid) {
            pending.declined = true; pendingPushes[uuid] = pending; rememberTerminal(pending.invitation.callId)
            if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.end(uuid: uuid) }
            return // Send decline only after the authenticated invitation has been verified.
        }
        guard validatedSystemUUID(uuid), let call = snapshot else { return }
        finish(NuwaxVoipCallPolicy.endReason(action: "end", state: wireString(call["state"]), callee: call["calleeId"] as? String == configuration["userId"] as? String))
    }
    fileprivate func systemReset() {
        for pending in pendingPushes.values { rememberTerminal(pending.invitation.callId) }
        for task in pendingPushExpiry.values { task.cancel() }; pendingPushExpiry = [:]; pendingPushes = [:]
        finish("systemReset")
    }
    fileprivate func ownsSystemManager(_ manager: AnyObject) -> Bool { systemBridge === manager }
    fileprivate func audioActivated(_ active: Bool) {
        let id = snapshot?["callId"] as? String ?? ""
        let outgoing = snapshot?["callerId"] as? String == configuration["userId"] as? String
            && snapshot?["callerDeviceId"] as? String == configuration["deviceId"] as? String
        if active && !NuwaxVoipCallPolicy.mayActivateAudio(state: snapshot?["state"] as? String, outgoing: outgoing, terminal: id.isEmpty || terminal.contains(id)) {
            audioActive = false; try? AudioManager.shared.setEngineAvailability(.none); return
        }
        audioActive = active
        if active {
            audioInterrupted = false
            try? AVAudioSession.sharedInstance().setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetooth])
        }
        updateAudioEngine(); emitAudioRoutes()
    }
    fileprivate func permissionPlan(_ media: String) -> NuwaxVoipPermissionPlan {
        func status(_ type: AVMediaType) -> NuwaxVoipPermission {
            switch AVCaptureDevice.authorizationStatus(for: type) {
            case .authorized: return .authorized
            case .notDetermined: return .notDetermined
            default: return .denied
            }
        }
        return NuwaxVoipClientPolicy.permissionPlan(microphone: status(.audio), camera: status(.video), video: media == "video", foreground: UIApplication.shared.applicationState == .active)
    }
    fileprivate func mediaControlFailed() { emit("error", ["code": "CALL_MEDIA_FAILED"]) }
    fileprivate func permissionPending() {
        guard let id = snapshot?["callId"] as? String else { return }
        emit("permissionPending")
        if UIApplication.shared.applicationState == .active { emit("openPage"); return }
        let content = UNMutableNotificationContent()
        let labels = configuration["labels"] as? [String: String] ?? [:]
        content.title = configuration["callLabel"] as? String ?? "Nuwax"
        content.body = labels["permissionForeground"] ?? "Open Nuwax to grant microphone access and answer."
        // Default notification action opens the App. UniPush retains delegate ownership.
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "voip-permission-\(id)", content: content, trigger: nil))
    }
    fileprivate func permissionFailed() {
        emit("error", ["code": "CALL_PERMISSION_REQUIRED"]); emit("openPage"); finish("permissionDenied")
    }
    private func becameActive() {
        if #available(iOS 17.4, *), let system = systemBridge as? NuwaxSystemCalls { system.resumePendingAnswer() }
        guard snapshot != nil else { return }
        emitAudioRoutes()
        executeOnMain(["op": "background", "scope": configuration["scope"] as? String ?? "", "hidden": false])
    }
    fileprivate func pauseAudio(_ paused: Bool) { systemPaused = paused; updateAudioEngine() }
    private func handleInterruption(began: Bool, resume: Bool) {
        guard snapshot != nil else { return }
        if began { audioInterrupted = true }
        // LCK's didActivate remains the authority on supported OS versions.
        else if resume {
            if #unavailable(iOS 17.4) { try? AVAudioSession.sharedInstance().setActive(true); audioInterrupted = false }
            else if audioActive { audioInterrupted = false }
        }
        updateAudioEngine()
    }
    private func updateAudioEngine() {
        let id = snapshot?["callId"] as? String ?? ""
        let outgoing = snapshot?["callerId"] as? String == configuration["userId"] as? String
            && snapshot?["callerDeviceId"] as? String == configuration["deviceId"] as? String
        let enabled = NuwaxVoipClientPolicy.canRunAudio(state: snapshot?["state"] as? String, outgoing: outgoing,
            terminal: id.isEmpty || terminal.contains(id), active: audioActive, paused: systemPaused, interrupted: audioInterrupted)
        do { try AudioManager.shared.setEngineAvailability(enabled ? .default : .none) }
        catch { emit("error", ["code": "CALL_AUDIO_ROUTE_UNAVAILABLE"]) }
        emit("audioInterrupted", ["enabled": systemPaused || audioInterrupted || !audioActive])
    }
    private func selectAudioRoute(_ route: String) {
        let session = AVAudioSession.sharedInstance()
        do {
            if route == "speaker" || route == "earpiece" {
                AudioManager.shared.isSpeakerOutputPreferred = route == "speaker"
                try session.setPreferredInput(session.availableInputs?.first { $0.portType == .builtInMic })
                try session.overrideOutputAudioPort(route == "speaker" ? .speaker : .none)
            } else {
                guard let input = session.availableInputs?.first(where: { $0.uid == route || (route == "bluetooth" && $0.portType == .bluetoothHFP) }) else { throw VoipError.invalid }
                AudioManager.shared.isSpeakerOutputPreferred = false
                try session.overrideOutputAudioPort(.none); try session.setPreferredInput(input)
            }
            emitAudioRoutes()
        } catch { emit("error", ["code": "CALL_AUDIO_ROUTE_UNAVAILABLE"]); emitAudioRoutes() }
    }
    private func emitAudioRoutes() {
        guard snapshot != nil else { return }
        let session = AVAudioSession.sharedInstance()
        let speaker = session.currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
        let external = session.currentRoute.inputs.first { $0.portType != .builtInMic }
        let selected = external?.uid ?? (speaker ? "speaker" : "earpiece")
        var routes: [[String: String]] = [["id": "earpiece", "kind": "earpiece"], ["id": "speaker", "kind": "speaker"]]
        for input in session.availableInputs ?? [] where input.portType != .builtInMic {
            routes.append(["id": input.uid, "kind": input.portType == .bluetoothHFP ? "bluetooth" : "headset", "name": input.portName])
        }
        emit("speaker", ["enabled": speaker]); emit("audioRoutes", ["routes": routes, "selected": selected])
    }
    private func observeHistory(_ value: [String: Any]) {
        guard historyStorage != nil, let id = value["callId"] as? String, let conv = value["convId"] as? String else { return }
        let outgoing = value["callerId"] as? String == configuration["userId"] as? String
        let now = Date().timeIntervalSince1970 * 1000
        let previous = history.records.first { $0.callId == id }
        history.observe(NuwaxVoipCallRecord(callId: id, convId: conv, peerId: value[outgoing ? "calleeId" : "callerId"] as? String ?? "",
            peerName: value[outgoing ? "calleeDisplayName" : "callerDisplayName"] as? String ?? "",
            direction: outgoing ? "outgoing" : "incoming", mediaType: value["mediaType"] as? String ?? "audio",
            startedAt: previous?.startedAt ?? now, connectedAt: connected && peerReady && value["state"] as? String == "active" ? now : 0))
        saveHistory()
    }
    private func emitHistory() { emit("history", ["records": history.records.map { $0.payload }]) }
    private func saveHistory() {
        if let data = history.encode(), historyStorage?.write(data) == false { emit("error", ["code": "CALL_SECURE_STORAGE_FAILED"]) }
        emitHistory()
    }
    private func beginReconnect(_ target: Room) {
        guard room === target, let id = snapshot?["callId"] as? String else { return }
        let run = generation
        reconnectWindow.begin(callID: id, generation: run, now: ProcessInfo.processInfo.systemUptime * 1000)
        emit("reconnecting")
        guard reconnectTask == nil else { return }
        let remaining = max(0, reconnectWindow.deadline - ProcessInfo.processInfo.systemUptime * 1000)
        reconnectTask = Task { @MainActor in
            do { try await Task.sleep(nanoseconds: UInt64(remaining * 1_000_000)) } catch { return }
            guard run == self.generation, self.room === target,
                  self.reconnectWindow.expired(callID: id, generation: run, now: ProcessInfo.processInfo.systemUptime * 1000) else { return }
            self.finish("reconnectTimeout")
        }
    }
    private func persist() {
        var stored = configuration; stored["systemUUIDs"] = callUUIDs.mapValues { $0.uuidString }
        stored["terminalCallIds"] = terminalOrder
        guard let data = try? JSONSerialization.data(withJSONObject: stored) else { return }
        let query = [kSecClass: kSecClassGenericPassword, kSecAttrService: service] as [CFString: Any]
        SecItemDelete(query as CFDictionary)
        var item = query; item[kSecValueData] = data; item[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        if SecItemAdd(item as CFDictionary, nil) != errSecSuccess { emit("error", ["code": "CALL_SECURE_STORAGE_FAILED"]) }
    }
    private func rememberTerminal(_ id: String) {
        let previous = terminal
        terminalOrder = NuwaxVoipCallPolicy.terminalHistory(terminalOrder + [id]); terminal = Set(terminalOrder)
        for removed in previous.subtracting(terminal) { callUUIDs.removeValue(forKey: removed) }
        if !configuration.isEmpty { persist() }
    }
    private func restore() {
        trace("native restore requested")
        guard configuration.isEmpty, UserDefaults.standard.bool(forKey: "nuwax-voip-install-session") else { return }
        var result: CFTypeRef?
        let query: [CFString: Any] = [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecReturnData: true, kSecMatchLimit: kSecMatchLimitOne]
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data,
           let config = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { trace("native session restored"); initialize(config) }
    }
}

extension NuwaxVoipBridge: RoomDelegate {
    public nonisolated func room(_ room: Room, participantDidConnect participant: RemoteParticipant) {
        DispatchQueue.main.async { if self.room === room { self.announceMediaReady() } }
    }
    public nonisolated func room(_ room: Room, participant: RemoteParticipant?, didReceiveData data: Data, forTopic topic: String, encryptionType: EncryptionType) {
        guard participant != nil else { return }
        DispatchQueue.main.async {
            guard self.room === room, let id = self.snapshot?["callId"] as? String,
                  NuwaxVoipCallPolicy.isPeerReady(data, topic: topic, callID: id) else { return }
            self.peerReady = true; self.emit("peerMediaReady"); self.maybeReady()
        }
    }
    public nonisolated func room(_ room: Room, participantDidDisconnect participant: RemoteParticipant) {
        DispatchQueue.main.async { if self.room === room && self.business { self.finish("remoteEnded", notifyRemote: false) } }
    }
    public nonisolated func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
        DispatchQueue.main.async { guard self.room === room else { return }; self.refreshViews()
            if publication.track is AudioTrack { self.peerReady = true; self.emit("peerMediaReady"); self.maybeReady() } }
    }
    public nonisolated func room(_ room: Room, didStartReconnectWithMode reconnectMode: ReconnectMode) {
        DispatchQueue.main.async { self.beginReconnect(room) }
    }
    public nonisolated func room(_ room: Room, didCompleteReconnectWithMode reconnectMode: ReconnectMode) {
        DispatchQueue.main.async { if self.room === room {
            self.reconnectTask?.cancel(); self.reconnectTask = nil; self.reconnectWindow.cancel()
            self.emit("connected"); self.announceMediaReady()
        } }
    }
    public nonisolated func room(_ room: Room, didDisconnectWithError error: LiveKitError?) {
        DispatchQueue.main.async { if self.room === room { self.finish("disconnected") } }
    }
}
extension NuwaxVoipBridge: @preconcurrency PKPushRegistryDelegate {
    private func updatePushToken(_ data: Data, registry: PKPushRegistry) {
        guard registry === pushRegistry, !configuration.isEmpty else { return }
        if data.isEmpty {
            pushRegistration?.stop(revoke: true)
            configuration.removeValue(forKey: "apnsRegistration"); persist(); return
        }
        let config = configuration
        // The signed host owns APNs environment. Never infer it from DEBUG or the API domain.
        let environment = Bundle.main.object(forInfoDictionaryKey: "NuwaxVoipAPNSEnvironment") as? String ?? ""
        let bundle = Bundle.main.bundleIdentifier ?? "", device = config["deviceId"] as? String ?? ""
        let previous = (config["apnsRegistration"] as? [String: Any]).flatMap { NuwaxVoipApnsDevice(stored: $0) }
        let sameToken = previous?.token == data.map { String(format: "%02x", $0) }.joined()
            && previous?.environment == environment && previous?.bundleId == bundle && previous?.deviceId == device
        guard Bundle.main.object(forInfoDictionaryKey: "NuwaxVoipPushProvider") as? String == "apns",
            let registration = NuwaxVoipApnsDevice(token: data, bundleId: bundle, environment: environment,
            deviceId: device, registrationId: sameToken ? previous!.registrationId : UUID().uuidString,
            previousRegistrationId: sameToken ? previous!.previousRegistrationId : (previous?.registrationId ?? "")) else {
            emit("pushRegistration", ["provider": "apns", "state": "configurationMissing", "nativePush": false]); return
        }
        configuration["apnsRegistration"] = registration.body("register"); persist()
        pushRegistration?.register(registration)
    }
    public func pushRegistry(_ registry: PKPushRegistry, didUpdate pushCredentials: PKPushCredentials, for type: PKPushType) {
        guard type == .voIP else { return }
        updatePushToken(pushCredentials.token, registry: registry)
    }
    public func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        updatePushToken(Data(), registry: registry)
    }
    public func pushRegistry(_ registry: PKPushRegistry, didReceiveIncomingPushWith payload: PKPushPayload, for type: PKPushType) async {
        guard type == .voIP else { return }
        restore()
        if #available(iOS 17.4, *) {
            let run = generation
            let invitation = NuwaxVoipPushInvitation(payload.dictionaryPayload, userId: configuration["userId"] as? String ?? "", business: business, now: Date().timeIntervalSince1970 * 1000)
            let systemUUID = invitation.map { uuid($0.callId) } ?? UUID()
            let system = (systemBridge as? NuwaxSystemCalls) ?? NuwaxSystemCalls(owner: self)
            systemBridge = system
            let duplicate = pendingPushes[systemUUID] != nil
            if let invitation, !terminal.contains(invitation.callId), !duplicate, !validatedSystemUUID(systemUUID) {
                pendingPushes[systemUUID] = PendingPush(invitation: invitation)
                expirePendingPush(systemUUID, invitation: invitation)
            }
            // Report before network access, including malformed/stale deliveries. No capture here.
            do { try await system.reportIncoming(invitation?.report ?? ["displayName": "Nuwax", "mediaType": "audio"], uuid: systemUUID, requiredByPushKit: true) }
            catch {
                removePendingPush(systemUUID); system.end(uuid: systemUUID)
                if run == generation, let invitation {
                    rememberTerminal(invitation.callId)
                    if snapshot == nil { emit("error", ["code": NuwaxVoipIncomingFailure(error).code]) }
                }
                return
            }
            guard run == generation, let invitation, !configuration.isEmpty else { system.end(uuid: systemUUID); return }
            if duplicate { if pendingPushes[systemUUID]?.declined == true { system.end(uuid: systemUUID) }; return }
            if validatedSystemUUID(systemUUID) { removePendingPush(systemUUID); return }
            guard pendingPushes[systemUUID] != nil, !terminal.contains(invitation.callId) || pendingPushes[systemUUID]?.declined == true else { removePendingPush(systemUUID); system.end(uuid: systemUUID); return }
            defer { if run == generation { removePendingPush(systemUUID) } }
            do {
                if business, let conv = invitation.convId, let msg = invitation.msgId {
                    let message = try await request("/api/instant-message/messages/\(msg)?convId=\(conv)", absolute: true)
                    guard invitation.matches(message, now: Date().timeIntervalSince1970 * 1000),
                          var next = await businessInvitation(message), run == generation,
                          let pending = pendingPushes[systemUUID] else { system.end(uuid: systemUUID); return }
                    next["expiresAt"] = invitation.expiresAt
                    if pending.declined { notifyBusinessEnd(next, reason: "rejected"); system.end(uuid: systemUUID); return }
                    guard !terminal.contains(invitation.callId) else { system.end(uuid: systemUUID); return }
                    adoptBusinessInvitation(next)
                } else {
                    let value = try await request("/\(invitation.callId)")
                    guard run == generation, let pending = pendingPushes[systemUUID] else { system.end(uuid: systemUUID); return }
                    if pending.declined {
                        _ = try? await request("/\(invitation.callId)/actions", body: ["action": "reject", "actionId": UUID().uuidString])
                        system.end(uuid: systemUUID); return
                    }
                    adopt(value)
                }
                if validatedSystemUUID(systemUUID) { system.invitationReady(uuid: systemUUID) }
                else { system.end(uuid: systemUUID) }
            } catch { system.end(uuid: systemUUID); if run == generation { emit("error", ["code": "CALL_INVITATION_FAILED"]) } }
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
    private var registry = NuwaxVoipSystemCallRegistry()
    private var ending: [UUID: Task<Void, Never>] = [:]
    private var joining: [UUID: JoinConversationAction] = [:]
    private var answering = Set<UUID>()
    private var answerRequested = Set<UUID>()
    private var answerModes: [UUID: String] = [:]
    private var permissionRequests = Set<UUID>()
    private var permissionWaiting = Set<UUID>()
    init(owner: NuwaxVoipBridge) {
        self.owner = owner
        manager = ConversationManager(configuration: .init(ringtoneName: nil, iconTemplateImageData: nil,
            maximumConversationGroups: 1, maximumConversationsPerConversationGroup: 1,
            includesConversationInRecents: false, supportsVideo: true, supportedHandleTypes: [.generic]))
        super.init(); manager.delegate = self
    }
    func reportIncoming(_ payload: [AnyHashable: Any], uuid: UUID, requiredByPushKit: Bool = false) async throws {
        if !requiredByPushKit && registry.isReported(uuid) {
            if registry.hasEnded(uuid) { end(uuid: uuid) }
            else { owner?.systemIncomingReady(uuid) }
            return
        }
        let run = registry.beginIncomingReport(uuid, requiredByPushKit: requiredByPushKit)
        // A late PushKit delivery still requires a system reporting attempt;
        // the tombstone prevents media/registration revival and closes it again.
        guard run != nil || (requiredByPushKit && registry.hasEnded(uuid)) else { return }
        if !requiredByPushKit && manager.conversations.contains(where: { $0.uuid == uuid }) {
            registry.registrationReported(uuid, generation: registry.generation)
            if registry.hasEnded(uuid) { end(uuid: uuid) }
            else { owner?.systemIncomingReady(uuid) }
            return
        }
        let handle = Handle(type: .generic, value: payload["callId"] as? String ?? uuid.uuidString, displayName: payload["displayName"] as? String ?? "Nuwax")
        trace("incoming report requested")
        do {
            try await manager.reportNewIncomingConversation(uuid: uuid, update: .init(members: [handle], capabilities: payload["mediaType"] as? String == "video" ? [.video, .pausing] : [.pausing]))
            registry.registrationReported(uuid, generation: run ?? registry.generation)
            trace("incoming report accepted")
            if run.map({ registry.registrationIsCurrent(uuid, generation: $0) }) != true || owner?.ownsSystemManager(self) != true { end(uuid: uuid) }
            else { owner?.systemIncomingReady(uuid) }
        } catch {
            // The required reporting attempt may legitimately return "UUID
            // exists" after the online path won. It must not end that call.
            if requiredByPushKit && NuwaxVoipCallPolicy.isDuplicateIncomingReport(error)
                && (registry.isReported(uuid) || manager.conversations.contains(where: { $0.uuid == uuid })) {
                registry.registrationReported(uuid, generation: run ?? registry.generation)
                if registry.hasEnded(uuid) { end(uuid: uuid) }
                else { owner?.systemIncomingReady(uuid) }
                return
            }
            traceFailure("incoming report failed", error: error)
            if let run { registry.registrationFailed(uuid, generation: run) }
            throw error
        }
    }
    func register(_ snapshot: [String: Any], uuid: UUID, incoming: Bool) {
        let run = incoming ? nil : registry.beginRegistration(uuid)
        if !incoming && run == nil { return }
        Task {
            do {
                if incoming { try await reportIncoming(snapshot, uuid: uuid) }
                else if let run {
                    guard registry.registrationIsCurrent(uuid, generation: run), owner?.ownsSystemUUID(uuid) == true else { end(uuid: uuid); return }
                    let handle = Handle(type: .generic, value: snapshot["callId"] as? String ?? uuid.uuidString, displayName: snapshot["calleeDisplayName"] as? String ?? "Nuwax")
                    try await manager.perform([StartConversationAction(conversationUUID: uuid, handles: [handle], isVideo: snapshot["mediaType"] as? String == "video")])
                    registry.registrationReported(uuid, generation: run)
                    if !registry.registrationIsCurrent(uuid, generation: run) || owner?.ownsSystemUUID(uuid) != true { end(uuid: uuid) }
                }
            } catch {
                if owner?.ownsSystemManager(self) == true && owner?.ownsSystemUUID(uuid) == true {
                    if incoming { owner?.systemIncomingFailed(uuid, error: error) }
                    else { owner?.finish("systemUnavailable") }
                }
            }
        }
    }
    func isPresented(uuid: UUID) -> Bool { registry.isReported(uuid) && !registry.hasEnded(uuid) }
    func requestAnswer(uuid: UUID, mediaType: String) {
        guard owner?.validatedSystemUUID(uuid) == true, !registry.hasEnded(uuid), joining[uuid] == nil, !answering.contains(uuid), answerRequested.insert(uuid).inserted else { return }
        answerModes[uuid] = mediaType
        Task {
            do { try await manager.perform([JoinConversationAction(conversationUUID: uuid)]) }
            catch {
                answerRequested.remove(uuid)
                if owner?.ownsSystemManager(self) == true && owner?.validatedSystemUUID(uuid) == true { owner?.finish("systemUnavailable") }
            }
        }
    }
    func requestMute(uuid: UUID, muted: Bool) {
        guard owner?.validatedSystemUUID(uuid) == true, isPresented(uuid: uuid) else { return }
        Task {
            do { try await manager.perform([MuteConversationAction(conversationUUID: uuid, isMuted: muted)]) }
            catch { if owner?.validatedSystemUUID(uuid) == true { owner?.mediaControlFailed() } }
        }
    }
    func mediaConnected(uuid: UUID) {
        trace("media connected")
        joining.removeValue(forKey: uuid)?.fulfill(dateConnected: Date())
        if let conversation = manager.conversations.first(where: { $0.uuid == uuid }) { manager.reportConversationEvent(.conversationStartedConnecting(Date()), for: conversation) }
    }
    func peerMediaReady(uuid: UUID) {
        guard owner?.validatedSystemUUID(uuid) == true, !registry.hasEnded(uuid) else { return }
        if let conversation = manager.conversations.first(where: { $0.uuid == uuid }) { manager.reportConversationEvent(.conversationConnected(Date()), for: conversation) }
    }
    func end(uuid: UUID) {
        registry.markEnded(uuid)
        joining.removeValue(forKey: uuid)?.fail()
        answering.remove(uuid); answerRequested.remove(uuid); answerModes.removeValue(forKey: uuid); permissionRequests.remove(uuid); permissionWaiting.remove(uuid)
        // Filtered/failed incoming reports have no system call to end. Keep the
        // tombstone so a pending successful report will close on completion.
        guard registry.isReported(uuid) else { trace("end tombstoned before report"); return }
        guard ending[uuid] == nil else { return }
        let run = registry.generation
        ending[uuid] = Task { @MainActor [weak self] in
            guard let self, self.registry.generation == run else { return }
            defer { if self.registry.generation == run { self.ending.removeValue(forKey: uuid) } }
            if self.manager.conversations.first(where: { $0.uuid == uuid })?.state == .left { self.registry.systemEnded(uuid); return }
            do { try await self.manager.perform([EndConversationAction(conversationUUID: uuid)]) }
            catch {
                if let conversation = self.manager.conversations.first(where: { $0.uuid == uuid }), conversation.state != .left {
                    self.manager.reportConversationEvent(.conversationEnded(Date(), .remoteEnded), for: conversation)
                }
                self.traceFailure("end action rejected", error: error)
                self.registry.systemEnded(uuid)
            }
        }
        // perform + typed fulfill is the primary route. Reporting ended before
        // the transaction completed removed the UUID and rejected that action.
        trace("end reported")
    }
    func invalidate() {
        registry.reset()
        for task in ending.values { task.cancel() }; ending = [:]
        for action in joining.values { action.fail() }; manager.invalidate(); joining = [:]; answerModes = [:]; answering = []; answerRequested = []; permissionRequests = []; permissionWaiting = []
    }
    private func trace(_ stage: String) {
        #if DEBUG
        NSLog("[NuwaxVoipSystem] %@ active=%ld total=%ld", stage, manager.conversations.filter { $0.state != .left }.count, manager.conversations.count)
        #endif
    }
    private func traceFailure(_ stage: String, error: Error) {
        #if DEBUG
        // Only structured error identifiers: localized descriptions can include
        // peer data or request details and must not enter diagnostic logs.
        let failure = error as NSError
        NSLog("[NuwaxVoipSystem] %@ domain=%@ code=%ld", stage, failure.domain, failure.code)
        #endif
    }
    private func reconcileSystemConversations() {
        let run = registry.generation
        Task { @MainActor [weak self] in
            guard let self, self.registry.generation == run, self.owner?.ownsSystemManager(self) == true else { return }
            for conversation in self.manager.conversations where conversation.state != .left && conversation.state != .leaving {
                if self.registry.hasEnded(conversation.uuid) || self.owner?.ownsSystemUUID(conversation.uuid) != true {
                    if !self.registry.hasEnded(conversation.uuid) { self.registry.registrationReported(conversation.uuid, generation: run) }
                    self.end(uuid: conversation.uuid)
                }
            }
            self.trace("system conversations reconciled")
        }
    }
    func invitationReady(uuid: UUID) {
        guard owner?.ownsSystemManager(self) == true, owner?.validatedSystemUUID(uuid) == true,
              let join = joining[uuid], !registry.hasEnded(uuid), !answering.contains(uuid), !permissionRequests.contains(uuid) else { return }
        guard join.timeoutDate > Date() else { owner?.finish("permissionRequired"); return }
        let media = answerModes[uuid] ?? "audio"
        switch owner?.permissionPlan(media) {
        case .foreground: permissionWaiting.insert(uuid); owner?.permissionPending(); return
        case .settings: owner?.permissionFailed(); return
        case .request:
            permissionRequests.insert(uuid); permissionWaiting.insert(uuid); owner?.permissionPending()
            NuwaxVoipBridge.requestPermissions(media) { [weak self] granted in
                Task { @MainActor in
                    guard let self else { return }
                    self.permissionRequests.remove(uuid)
                    guard self.owner?.ownsSystemManager(self) == true, self.owner?.validatedSystemUUID(uuid) == true, self.joining[uuid] != nil, !self.registry.hasEnded(uuid) else { return }
                    if granted { self.invitationReady(uuid: uuid) } else { self.owner?.permissionFailed() }
                }
            }
            return
        case .ready: break
        case nil: return
        }
        answering.insert(uuid); permissionWaiting.remove(uuid)
        answerModes.removeValue(forKey: uuid)
        Task {
            guard owner?.validatedSystemUUID(uuid) == true else { joining.removeValue(forKey: uuid)?.fail(); answering.remove(uuid); return }
            if await owner?.action("accept", answerMediaType: media) != true {
                joining.removeValue(forKey: uuid)?.fail(); answering.remove(uuid); answerRequested.remove(uuid)
                if owner?.validatedSystemUUID(uuid) == true { owner?.finish("actionFailed") }
            }
        }
    }
    func resumePendingAnswer() { for uuid in Array(joining.keys) { invitationReady(uuid: uuid) } }
    func conversationManager(_ manager: ConversationManager, perform action: ConversationAction) {
        if let end = action as? EndConversationAction {
            trace("end action received")
            registry.markEnded(end.conversationUUID)
            registry.systemEnded(end.conversationUUID)
            // Complete the OS action before any business/network work.
            end.fulfill(dateEnded: Date())
            trace("end action fulfilled")
            if owner?.ownsSystemManager(self) == true && owner?.ownsSystemUUID(end.conversationUUID) == true {
                owner?.endSystemCall(end.conversationUUID)
            }
            return
        }
        guard owner?.ownsSystemManager(self) == true, owner?.ownsSystemUUID(action.conversationUUID) == true, !registry.hasEnded(action.conversationUUID) else { action.fail(); return }
        if let join = action as? JoinConversationAction {
            trace("join action received")
            answerRequested.remove(join.conversationUUID)
            guard joining[join.conversationUUID] == nil, !answering.contains(join.conversationUUID) else { action.fail(); return }
            joining[join.conversationUUID] = join
            invitationReady(uuid: join.conversationUUID)
        } else if let start = action as? StartConversationAction { start.fulfill(dateStarted: Date()) }
        else if let mute = action as? MuteConversationAction { Task {
            guard owner?.ownsSystemUUID(action.conversationUUID) == true else { action.fail(); return }
            if await owner?.setMicrophone(!mute.isMuted) == true { action.fulfill() } else { action.fail() }
        } }
        else if let pause = action as? PauseConversationAction { owner?.pauseAudio(pause.isPaused); pause.fulfill() }
        else { action.fail() }
    }
    func conversationManager(_ manager: ConversationManager, conversationChanged conversation: Conversation) {
        trace("conversation changed")
        reconcileSystemConversations()
    }
    func conversationManagerDidBegin(_ manager: ConversationManager) { trace("system manager began"); reconcileSystemConversations() }
    func conversationManagerDidReset(_ manager: ConversationManager) { if owner?.ownsSystemManager(self) == true { owner?.systemReset() } }
    func conversationManager(_ manager: ConversationManager, timedOutPerforming action: ConversationAction) {
        let needsPermission = permissionWaiting.remove(action.conversationUUID) != nil
        action.fail(); joining.removeValue(forKey: action.conversationUUID)
        answering.remove(action.conversationUUID); answerRequested.remove(action.conversationUUID)
        if owner?.ownsSystemManager(self) == true && owner?.ownsSystemUUID(action.conversationUUID) == true { owner?.finish(needsPermission ? "permissionRequired" : "systemUnavailable") }
    }
    func conversationManager(_ manager: ConversationManager, didActivate audioSession: AVAudioSession) { if owner?.ownsSystemManager(self) == true { trace("audio activated"); owner?.audioActivated(true) } }
    func conversationManager(_ manager: ConversationManager, didDeactivate audioSession: AVAudioSession) { if owner?.ownsSystemManager(self) == true { trace("audio deactivated"); owner?.audioActivated(false) } }
}
