import Foundation

/// The call token namespace is independent of the ordinary UniPush CID/device registration.
struct NuwaxVoipApnsDevice: Equatable {
    let token: String
    let bundleId: String
    let environment: String
    let deviceId: String
    let registrationId: String
    let previousRegistrationId: String
    let cid: String?
    var provider: String { cid == nil ? "apns" : "unipush" }

    init?(token: Data, bundleId: String, environment: String, deviceId: String,
          registrationId: String = UUID().uuidString, previousRegistrationId: String = "", cid: String? = nil) {
        guard !token.isEmpty, token.count <= 1024, !deviceId.isEmpty, deviceId.count <= 255,
              bundleId.range(of: "^[A-Za-z0-9-]+(?:\\.[A-Za-z0-9-]+)+\\z", options: .regularExpression) != nil,
              ["development", "production"].contains(environment), UUID(uuidString: registrationId) != nil,
              previousRegistrationId.isEmpty || UUID(uuidString: previousRegistrationId) != nil,
              cid.map(Self.validCid) ?? true else { return nil }
        self.token = token.map { String(format: "%02x", $0) }.joined()
        self.bundleId = bundleId; self.environment = environment; self.deviceId = deviceId
        self.registrationId = registrationId.lowercased(); self.previousRegistrationId = previousRegistrationId.lowercased()
        self.cid = cid
    }

    init?(stored: [String: Any]) {
        guard let token = stored["token"] as? String, token.count <= 2048, token.count % 2 == 0,
              token.range(of: "^[0-9a-f]+\\z", options: .regularExpression) != nil,
              let bundle = stored["bundleId"] as? String, let env = stored["environment"] as? String,
              let device = stored["deviceId"] as? String, let id = stored["registrationId"] as? String else { return nil }
        var bytes = Data(); var index = token.startIndex
        while index < token.endIndex { let end = token.index(index, offsetBy: 2); guard let byte = UInt8(token[index..<end], radix: 16) else { return nil }; bytes.append(byte); index = end }
        self.init(token: bytes, bundleId: bundle, environment: env, deviceId: device, registrationId: id,
                  previousRegistrationId: stored["previousRegistrationId"] as? String ?? "", cid: stored["cid"] as? String)
    }

    static func validCid(_ cid: String) -> Bool {
        cid.range(of: "^[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil
    }

    func hasToken(_ data: Data) -> Bool {
        token == data.map { String(format: "%02x", $0) }.joined()
    }

    func sameNamespace(as other: Self) -> Bool {
        provider == other.provider && bundleId == other.bundleId && environment == other.environment && deviceId == other.deviceId
    }

    func replacing(_ previous: Self?, forceNew: Bool = false) -> Self {
        guard let previous, sameNamespace(as: previous) else { return self }
        if !forceNew && token == previous.token && cid == previous.cid { return previous }
        return Self(self, previousRegistrationId: previous.registrationId)
    }

    private init(_ device: Self, previousRegistrationId: String) {
        token = device.token
        bundleId = device.bundleId
        environment = device.environment
        deviceId = device.deviceId
        registrationId = device.registrationId
        cid = device.cid
        self.previousRegistrationId = previousRegistrationId
    }

    func body(_ action: String) -> [String: Any] {
        if let cid {
            return ["deviceId": deviceId, "platform": "ios", "pushToken": cid,
                    "iosVoip": ["registrationId": registrationId, "previousRegistrationId": previousRegistrationId,
                                "action": action]]
        }
        var result = stored
        result["action"] = action
        return result
    }

    var stored: [String: Any] {
        var result: [String: Any] = ["provider": provider, "channel": "pushKit", "platform": "ios", "deviceId": deviceId,
         "bundleId": bundleId, "environment": environment, "registrationId": registrationId,
         "previousRegistrationId": previousRegistrationId, "action": "register", "token": token]
        if let cid { result["cid"] = cid }
        return result
    }

    func acknowledgement(_ response: [String: Any]) -> [String: Any]? {
        guard response["deviceId"] as? String == deviceId else { return nil }
        if cid != nil {
            guard response["platform"] as? String == "ios" else { return nil }
            return response["iosVoip"] as? [String: Any]
        }
        guard response["provider"] as? String == "apns", response["channel"] as? String == "pushKit",
              response["bundleId"] as? String == bundleId, response["environment"] as? String == environment else { return nil }
        return response
    }

    func acknowledges(_ response: [String: Any], registered: Bool = true) -> Bool {
        guard let acknowledgement = acknowledgement(response) else { return false }
        return (acknowledgement["registrationId"] as? String)?.lowercased() == registrationId
            && acknowledgement["registered"] as? Bool == registered
    }
}

/// Main-actor ownership, cancellable retries, and captured transport make account changes testable without UIKit.
@MainActor final class NuwaxVoipApnsRegistration {
    typealias Transport = @MainActor ([String: Any]) async throws -> [String: Any]
    private let transport: Transport
    private let sleep: @MainActor (UInt64) async throws -> Void
    private let changed: @MainActor (String, Bool) -> Void
    private var task: Task<Void, Never>?
    private var generation = 0
    private(set) var current: NuwaxVoipApnsDevice?
    private var inFlightOrRegistered = false

    func pause() {
        task?.cancel(); task = nil; generation += 1
        inFlightOrRegistered = false
    }

    init(restored: NuwaxVoipApnsDevice? = nil, transport: @escaping Transport,
         sleep: @escaping @MainActor (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) },
         changed: @escaping @MainActor (String, Bool) -> Void) {
        self.current = restored; self.transport = transport; self.sleep = sleep; self.changed = changed
    }
    func register(_ device: NuwaxVoipApnsDevice) {
        if current == device && inFlightOrRegistered { return }
        if let old = current, !old.sameNamespace(as: device) {
            stop(revoke: true)
        }
        task?.cancel(); generation += 1; let run = generation
        current = device; inFlightOrRegistered = true; changed("registering", false)
        task = Task { @MainActor in
            for attempt in 0..<5 {
                guard !Task.isCancelled, run == self.generation else { return }
                do {
                    if attempt > 0 { try await self.sleep(UInt64(1 << (attempt - 1)) * 1_000_000_000) }
                    try Task.checkCancellation()
                    let result = try await self.transport(device.body("register"))
                    guard !Task.isCancelled, run == self.generation else { return }
                    if device.acknowledges(result) {
                        // registered is storage acknowledgement; nativePush is the sender's declared readiness, not delivery.
                        self.changed("registered", device.acknowledgement(result)?["nativePush"] as? Bool == true); return
                    }
                } catch { if Task.isCancelled || run != self.generation { return } }
            }
            guard run == self.generation, !Task.isCancelled else { return }
            self.inFlightOrRegistered = false
            self.changed("unavailable", false)
        }
    }
    /// Best-effort conditional revoke, using this instance's captured former account transport.
    @discardableResult func stop(revoke: Bool) -> Task<Bool, Never>? {
        pause()
        let device = current; current = nil; changed("stopped", false)
        guard revoke, let device else { return nil }
        let transport = transport, sleep = sleep
        return Task { @MainActor in
            for attempt in 0..<3 {
                do {
                    if attempt > 0 { try await sleep(UInt64(1 << (attempt - 1)) * 1_000_000_000) }
                    let result = try await transport(device.body("revoke"))
                    if device.acknowledges(result, registered: false) { return true }
                } catch { /* bounded; backend logout/device revocation is the authoritative fallback */ }
            }
            return false
        }
    }
}
