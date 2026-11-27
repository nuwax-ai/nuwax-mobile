import Foundation
import CoreFoundation

/// PushKit display data is untrusted. Media/action authorization still comes from the authenticated API.
struct NuwaxVoipPushInvitation {
    let scene: String
    let callId: String
    let calleeId: String
    let expiresAt: Double
    let mediaType: String
    let displayName: String
    let convId: String?
    let msgId: String?
    /// Meeting-only fields. They never authorize media; they only locate the invite.
    let inviteId: String?
    let roomName: String?
    let title: String?

    var systemKey: String { inviteId.map(Self.meetingSystemKey) ?? callId }

    static func meetingSystemKey(_ inviteId: String) -> String { "meeting:\(inviteId)" }

    init?(_ raw: [AnyHashable: Any], userId: String, business: Bool, now: Double,
          requiredRegistrationId: String? = nil, pushBusinessEnvironment: String? = nil) {
        var payload = raw
        // Getui's VoIP custom payload can be a dictionary or a JSON string.
        if raw["callId"] == nil {
            if let nested = raw["payload"] as? [AnyHashable: Any] { payload = nested }
            else if let json = raw["payload"] as? String, let data = json.data(using: .utf8),
                    let nested = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { payload = nested }
        }
        if let requiredRegistrationId,
           requiredRegistrationId.isEmpty || payload["routeRegistrationId"] as? String != requiredRegistrationId { return nil }
        if let received = payload["pushEnvironment"],
           received as? String != pushBusinessEnvironment || pushBusinessEnvironment == nil { return nil }
        let scene = payload["scene"] as? String ?? "call"
        guard scene == "call" || scene == "meeting" else { return nil }
        let rawCallId = payload["callId"] as? String ?? (scene == "meeting" ? payload["inviteId"] as? String : nil)
        guard let id = rawCallId,
              id.range(of: "^[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil,
              !userId.isEmpty, let callee = payload["calleeId"] as? String, callee == userId,
              let expiry = payload["expiresAt"] as? NSNumber, CFGetTypeID(expiry) != CFBooleanGetTypeID(),
              expiry.doubleValue.isFinite, expiry.doubleValue.rounded() == expiry.doubleValue,
              expiry.doubleValue > now, expiry.doubleValue <= now + 65_000,
              let media = payload["mediaType"] as? String, ["audio", "video"].contains(media) else { return nil }
        // Transport int64 IDs as strings. Reject numbers that may already have been rounded by a sender.
        let conv = Self.locator(payload["convId"]), msg = Self.locator(payload["msgId"])
        guard !business || (conv != nil && msg != nil && payload["type"] as? String == "voip") else { return nil }
        var invite: String?
        var room: String?
        var meetingTitle: String?
        if scene == "meeting" {
            guard let value = payload["inviteId"] as? String,
                  value.range(of: "^[A-Za-z0-9._-]{1,128}\\z", options: .regularExpression) != nil,
                  let roomValue = payload["roomName"] as? String,
                  roomValue.range(of: "^[A-Za-z0-9._-]{1,128}\\z", options: .regularExpression) != nil,
                  let titleValue = payload["title"] as? String, !titleValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else { return nil }
            invite = value; room = roomValue; meetingTitle = titleValue
        }
        self.scene = scene
        callId = id; calleeId = callee; expiresAt = expiry.doubleValue; mediaType = media
        convId = conv; msgId = msg
        inviteId = invite; roomName = room; title = meetingTitle
        let name = (payload["displayName"] as? String ?? "Nuwax").trimmingCharacters(in: .whitespacesAndNewlines)
        displayName = name.isEmpty ? "Nuwax" : String(name.prefix(80))
    }

    init?(meetingMessage message: [String: Any], userId: String, now: Double) {
        guard let sender = Self.responseId(message["senderId"]), sender != userId,
              let conv = Self.responseId(message["convId"]), let msg = Self.responseId(message["msgId"]),
              let sent = message["sendTime"] as? NSNumber, let body = message["body"] as? [String: Any],
              let inviteId = body["inviteId"] as? String, let room = body["roomName"] as? String,
              let media = body["mediaType"] as? String, let title = body["title"] as? String else { return nil }
        self.init(["type": "voip", "scene": "meeting", "callId": "meeting-\(msg)", "calleeId": userId,
                   "convId": conv, "msgId": msg, "inviteId": inviteId, "roomName": room,
                   "mediaType": media, "title": String(title.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80)),
                   "displayName": message["senderName"] as? String ?? "Nuwax", "expiresAt": sent.doubleValue + 60_000],
                  userId: userId, business: true, now: now)
        guard matches(message, now: now) else { return nil }
    }

    func report(labels: [String: Any]) -> [String: Any] {
        // 系统接听布局不可定制；显示会议语义和会议号，不把业务 inviteId 当电话号码。
        let meetingLabel = labels["meetingInvitation"] as? String ?? "会议邀请"
        let numberLabel = labels["meetingNumber"] as? String ?? "会议号"
        let meeting = scene == "meeting"
        return ["callId": callId,
                "displayName": meeting ? "\(meetingLabel) · \(title ?? displayName)" : displayName,
                "handle": meeting ? "\(numberLabel) \(roomName ?? "")" : callId,
                "mediaType": mediaType, "scene": scene]
    }

    func matches(_ message: [String: Any], now: Double) -> Bool {
        scene == "meeting" ? matchesMeeting(message, now: now) : matchesCall(message, now: now)
    }

    func matchesCallSignal(callID: String, conversationID: String, messageID: String) -> Bool {
        scene == "call" && convId == conversationID && NuwaxVoipCallPolicy.matches(
            signalID: callID, messageID: messageID, callID: callId, callMessageID: msgId ?? ""
        )
    }

    private func matchesCall(_ message: [String: Any], now: Double) -> Bool {
        guard let body = message["body"] as? [String: Any], body["callId"] as? String == callId,
              body["mediaType"] as? String == mediaType, message["msgType"] as? String == "voip",
              Self.responseId(message["convId"]) == convId, Self.responseId(message["msgId"]) == msgId,
              let sent = message["sendTime"] as? NSNumber else { return false }
        return expiresAt > now && sent.doubleValue > 0 && sent.doubleValue <= now + 5_000
            && sent.doubleValue + 60_000 > now && expiresAt <= sent.doubleValue + 60_000
    }

    /// Meeting invites are ordinary `meeting_invite` messages; the push is only a locator.
    private func matchesMeeting(_ message: [String: Any], now: Double) -> Bool {
        guard let body = message["body"] as? [String: Any],
              message["msgType"] as? String == "meeting_invite",
              (message["senderType"] as? Int ?? 1) == 1, (message["msgStatus"] as? Int ?? 1) == 1,
              body["silent"] as? Bool != true, body["silent"] as? String != "true",
              let expectedInvite = inviteId, body["inviteId"] as? String == expectedInvite,
              let expectedRoom = roomName, body["roomName"] as? String == expectedRoom,
              Self.responseId(message["convId"]) == convId, Self.responseId(message["msgId"]) == msgId,
              let sent = message["sendTime"] as? NSNumber else { return false }
        return expiresAt > now && sent.doubleValue > 0 && sent.doubleValue <= now + 5_000
            && sent.doubleValue + 60_000 > now && expiresAt <= sent.doubleValue + 60_000
    }

    private static func locator(_ raw: Any?) -> String? {
        guard let value = raw as? String, value.range(of: "^[1-9][0-9]{0,18}$", options: .regularExpression) != nil,
              Int64(value) != nil else { return nil }
        return value
    }
    private static func responseId(_ raw: Any?) -> String? {
        if let value = raw as? String { return locator(value) }
        if let value = raw as? NSNumber, CFGetTypeID(value) != CFBooleanGetTypeID(),
           !["f", "d"].contains(String(cString: value.objCType)) { return locator(value.stringValue) }
        return nil
    }
}
