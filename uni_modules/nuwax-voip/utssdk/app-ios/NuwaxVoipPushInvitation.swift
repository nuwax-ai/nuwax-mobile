import Foundation
import CoreFoundation

/// PushKit display data is untrusted. Media/action authorization still comes from the authenticated API.
struct NuwaxVoipPushInvitation {
    let callId: String
    let calleeId: String
    let expiresAt: Double
    let mediaType: String
    let displayName: String
    let convId: String?
    let msgId: String?

    init?(_ raw: [AnyHashable: Any], userId: String, business: Bool, now: Double) {
        var payload = raw
        // Getui's VoIP custom payload can be a dictionary or a JSON string.
        if raw["callId"] == nil {
            if let nested = raw["payload"] as? [AnyHashable: Any] { payload = nested }
            else if let json = raw["payload"] as? String, let data = json.data(using: .utf8),
                    let nested = try? JSONSerialization.jsonObject(with: data) as? [String: Any] { payload = nested }
        }
        guard let id = payload["callId"] as? String,
              id.range(of: "^[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil,
              !userId.isEmpty, let callee = payload["calleeId"] as? String, callee == userId,
              let expiry = payload["expiresAt"] as? NSNumber, CFGetTypeID(expiry) != CFBooleanGetTypeID(),
              expiry.doubleValue.isFinite, expiry.doubleValue.rounded() == expiry.doubleValue,
              expiry.doubleValue > now, expiry.doubleValue <= now + 65_000,
              let media = payload["mediaType"] as? String, ["audio", "video"].contains(media) else { return nil }
        // Transport int64 IDs as strings. Reject numbers that may already have been rounded by a sender.
        let conv = Self.locator(payload["convId"]), msg = Self.locator(payload["msgId"])
        guard !business || (conv != nil && msg != nil && payload["type"] as? String == "voip") else { return nil }
        callId = id; calleeId = callee; expiresAt = expiry.doubleValue; mediaType = media
        convId = conv; msgId = msg
        let name = (payload["displayName"] as? String ?? "Nuwax").trimmingCharacters(in: .whitespacesAndNewlines)
        displayName = name.isEmpty ? "Nuwax" : String(name.prefix(80))
    }

    var report: [AnyHashable: Any] { ["callId": callId, "displayName": displayName, "mediaType": mediaType] }

    func matches(_ message: [String: Any], now: Double) -> Bool {
        guard let body = message["body"] as? [String: Any], body["callId"] as? String == callId,
              body["mediaType"] as? String == mediaType, message["msgType"] as? String == "voip",
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
