import Foundation

enum NuwaxVoipPermission: String { case authorized, notDetermined, denied }
enum NuwaxVoipPermissionPlan: Equatable { case ready, request, foreground, settings }

enum NuwaxVoipClientPolicy {
    static func allowsOrigin(_ origin: String, pinnedOrigin: String?) -> Bool {
        guard let pinnedOrigin else { return true }
        return !pinnedOrigin.isEmpty && origin == pinnedOrigin
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
