import Foundation

/// Protocol policy only; no system UI, capture or network side effects.
enum NuwaxVoipCallPolicy {
    static let prepareTimeout: Double = 30_000
    static let remoteLeftGrace: UInt64 = 3_000_000_000
    static func ringDeadline(sendTime: Double?, acknowledgedAt: Double) -> Double {
        let sent = sendTime.flatMap { $0.isFinite && $0 > 0 ? $0 : nil } ?? acknowledgedAt
        return min(sent, acknowledgedAt) + 60_000
    }
    static func isAuthenticationFailure(_ status: Int) -> Bool { status == 401 || status == 403 }
    static func businessEndAction(caller: Bool, state: String, reason: String) -> String? {
        if ["remoteEnded", "remoteCancelled", "answeredElsewhere", "sessionChanged"].contains(reason) { return nil }
        if caller && ["ringing", "connecting"].contains(state) { return "ended" }
        return !caller && canDecline(reason: reason, state: state) ? "declined" : nil
    }
    static func shouldFinishRemoteLeft(everHadRemote: Bool, remoteCount: Int, reconnecting: Bool, graceElapsed: Bool) -> Bool {
        everHadRemote && remoteCount == 0 && !reconnecting && graceElapsed
    }
    static func mayWatch(callID: String, currentID: String?, pendingIDs: [String]) -> Bool {
        guard !callID.isEmpty else { return false }
        if let currentID, currentID != callID { return false }
        return !pendingIDs.contains { $0 != callID }
    }
    static func terminalHistory(_ values: [String]) -> [String] {
        var seen = Set<String>(), result: [String] = []
        for id in values.reversed() where id.range(of: "^[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil {
            if seen.insert(id).inserted { result.append(id) }
            if result.count == 128 { break }
        }
        return Array(result.reversed())
    }
    static func mayActivateAudio(state: String?, outgoing: Bool, terminal: Bool) -> Bool {
        guard !terminal else { return false }
        return state == "connecting" || state == "active" || (state == "ringing" && outgoing)
    }
    static func isDuplicateIncomingReport(_ error: Error) -> Bool {
        let value = error as NSError
        return value.domain == "com.apple.CallKit.error.incomingcall" && value.code == 2
    }
    static let readyTopic = "nuwax.voip.media-ready.v1"
    static func isPeerReady(_ data: Data, topic: String, callID: String) -> Bool {
        guard topic == readyTopic, !callID.isEmpty, data.count <= 256,
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return false }
        return body["v"] as? Int == 1 && body["type"] as? String == "ready" && body["callId"] as? String == callID
    }
    static func matches(signalID: String, messageID: String, callID: String, callMessageID: String) -> Bool {
        if !signalID.isEmpty { return signalID == callID }
        return !messageID.isEmpty && !callMessageID.isEmpty && messageID == callMessageID
    }

    static func canDecline(reason: String, state: String) -> Bool { reason == "rejected" && state == "ringing" }

    static func endReason(action: String, state: String, callee: Bool) -> String {
        if state != "ringing" { return "ended" }
        return callee ? "rejected" : "cancelled"
    }

    static func signalEndReason(type: String, state: String) -> String? {
        if type == "voip:cancel" { return state == "ringing" ? "remoteCancelled" : "remoteEnded" }
        if type == "voip:timeout" && state == "ringing" { return "timeout" }
        if type == "voip:decline" && state == "ringing" { return "rejected" }
        return nil
    }
}

struct NuwaxVoipIncomingFailure {
    let reason: String
    let code: String
    init(_ error: Error) {
        let value = error as NSError
        if value.domain == "com.apple.CallKit.error.incomingcall" {
            switch value.code {
            case 3: reason = "systemFocusFiltered"; code = "CALL_SYSTEM_FOCUS_FILTERED"; return
            case 4: reason = "systemBlocked"; code = "CALL_SYSTEM_BLOCKED"; return
            case 5, 7: reason = "systemRestricted"; code = "CALL_SYSTEM_RESTRICTED"; return
            default: break
            }
        }
        reason = "systemUnavailable"; code = "CALL_SYSTEM_UNAVAILABLE"
    }
}
