import Foundation

enum NuwaxVoipPermission: String { case authorized, notDetermined, denied }
enum NuwaxVoipPermissionPlan: Equatable { case ready, request, foreground, settings }

enum NuwaxVoipClientPolicy {
    /// Cloud packages do not inject build-specific plist metadata. The embedded
    /// provisioning profile supplies the APNs environment; App Store installs
    /// have no embedded profile and use production. An unreadable profile fails closed.
    static func pushEnvironment(profile: Data?, explicit: String?) -> String? {
        if let explicit {
            return ["development", "production"].contains(explicit) ? explicit : nil
        }
        guard let profile else { return "production" }
        guard let start = profile.range(of: Data("<?xml".utf8))?.lowerBound,
              let end = profile.range(of: Data("</plist>".utf8), in: start..<profile.endIndex)?.upperBound,
              let plist = try? PropertyListSerialization.propertyList(from: profile.subdata(in: start..<end), format: nil),
              let dict = plist as? [String: Any], let entitlements = dict["Entitlements"] as? [String: Any],
              let environment = entitlements["aps-environment"] as? String,
              ["development", "production"].contains(environment) else { return nil }
        return environment
    }

    static func sharesTransport(_ previous: [String: Any], _ next: [String: Any]) -> Bool {
        guard let token = previous["accessToken"] as? String, !token.isEmpty else { return false }
        let transportKeys = ["apiBaseUrl", "userId", "deviceId", "accessToken", "protocol", "pushBusinessEnvironment"]
        return transportKeys.allSatisfy { previous[$0] as? String == next[$0] as? String }
    }

    static func allowsOrigin(_ origin: String, pinnedOrigin: String?) -> Bool {
        guard let pinnedOrigin else { return true }
        return !pinnedOrigin.isEmpty && origin == pinnedOrigin
    }

    static func avatarURL(_ value: Any?) -> String? {
        guard let url = (value as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !url.isEmpty else { return nil }
        return url
    }

    static func backfillCallerAvatar(_ call: [String: Any], callID: String, callerID: String,
                                     contacts: [[String: Any]]) -> [String: Any]? {
        guard call["callId"] as? String == callID, call["callerId"] as? String == callerID,
              call["state"] as? String != "ended", avatarURL(call["callerAvatar"]) == nil,
              let version = call["version"] as? Int,
              let contact = contacts.first(where: {
                  String(describing: $0["userId"] ?? "") == callerID &&
                      $0["subjectType"] as? Int == 1 && $0["status"] as? Int == 1
              }),
              let avatar = avatarURL(contact["avatar"]) else { return nil }
        var updated = call
        updated["callerAvatar"] = avatar
        updated["version"] = version + 1
        return updated
    }

    static func permissionPlan(microphone: NuwaxVoipPermission, camera: NuwaxVoipPermission, video: Bool, foreground: Bool) -> NuwaxVoipPermissionPlan {
        let required = video ? [microphone, camera] : [microphone]
        if required.contains(.denied) { return .settings }
        if required.allSatisfy({ $0 == .authorized }) { return .ready }
        return foreground ? .request : .foreground
    }
    static func canRunAudio(state: String?, outgoing: Bool, terminal: Bool, active: Bool, paused: Bool, interrupted: Bool) -> Bool {
        active && !paused && !interrupted && NuwaxVoipCallPolicy.mayActivateAudio(state: state, outgoing: outgoing, terminal: terminal)
    }
}

/// Repeated reconnect callbacks cannot extend the original deadline.
struct NuwaxVoipReconnectWindow {
    private(set) var callID = ""
    private(set) var generation = -1
    private(set) var deadline: Double = 0
    mutating func begin(callID: String, generation: Int, now: Double) {
        guard self.callID != callID || self.generation != generation || deadline == 0 else { return }
        self.callID = callID; self.generation = generation; deadline = now + 30_000
    }
    func expired(callID: String, generation: Int, now: Double) -> Bool {
        !callID.isEmpty && self.callID == callID && self.generation == generation && deadline > 0 && now >= deadline
    }
    mutating func cancel() { callID = ""; generation = -1; deadline = 0 }
}
