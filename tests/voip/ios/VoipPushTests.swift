import Foundation
import XCTest
@testable import VoipPush

final class VoipPushTests: XCTestCase {
    private let now = 1_793_000_000_000.0
    private var payload: [AnyHashable: Any] {
        ["type": "voip", "callId": "call-123", "calleeId": "bob", "expiresAt": now + 45_000,
         "mediaType": "audio", "displayName": "Alice", "convId": "245475557381246976", "msgId": "9223372036854775807"]
    }
    private var message: [String: Any] {
        ["msgType": "voip", "convId": "245475557381246976", "msgId": "9223372036854775807", "sendTime": now - 1_000,
         "body": ["callId": "call-123", "mediaType": "audio", "roomName": "voip-call-123"]]
    }
    private var meetingMessage: [String: Any] {
        ["msgType": "meeting_invite", "senderId": "123", "senderName": "Alice",
         "convId": "245475557381246976", "msgId": NSNumber(value: Int64.max), "sendTime": now - 1_000,
         "body": ["inviteId": "invite.123", "roomName": "room-123", "title": "Meeting", "mediaType": "video"]]
    }
    private func parse(_ raw: [AnyHashable: Any]) -> NuwaxVoipPushInvitation? {
        NuwaxVoipPushInvitation(raw, userId: "bob", business: true, now: now)
    }
    func testFullInvitationAndGetuiWrappers() throws {
        XCTAssertEqual(parse(payload)?.callId, "call-123")
        XCTAssertNotNil(parse(["payload": payload]))
        let data = try JSONSerialization.data(withJSONObject: payload)
        XCTAssertNotNil(parse(["payload": String(decoding: data, as: UTF8.self)]))
    }
    func testPushRetainsOnlyShortAvatarReferencesForAppDisplay() throws {
        let avatar = "/api/user/avatar/10001/profile-hash"
        var fields = payload
        fields["senderAvatar"] = " \(avatar) "
        let invitation = try XCTUnwrap(parse(["payload": fields]))
        XCTAssertEqual(invitation.senderAvatar, avatar)
        XCTAssertNil(invitation.report(labels: [:])["senderAvatar"])

        for unsafe in ["https://images.example.test/avatar?token=secret", "//example.test/avatar", "/api/f/%2e%2e/private"] {
            fields["senderAvatar"] = unsafe
            XCTAssertNotNil(parse(fields))
            XCTAssertNil(parse(fields)?.senderAvatar)
        }
    }
    func testSystemReportDoesNotDisplayTheCallIdentifier() throws {
        var fields = payload
        fields["displayName"] = "call-123"
        fields["senderName"] = "  Alice  "
        let named = try XCTUnwrap(parse(["payload": fields])).report(labels: [:])
        XCTAssertEqual(named["displayName"] as? String, "Alice")
        XCTAssertEqual(named["handle"] as? String, "Alice")
        XCTAssertEqual(named["callId"] as? String, "call-123")

        fields["senderName"] = " "
        let unnamed = try XCTUnwrap(parse(fields)).report(labels: [:])
        XCTAssertEqual(unnamed["displayName"] as? String, "Nuwax")
        XCTAssertEqual(unnamed["handle"] as? String, "Nuwax")
    }

    func testVerifiedCallerNameIgnoresMissingNamesAndIdentifiers() {
        let call: [AnyHashable: Any] = ["callId": "call-123", "callerId": "42", "callerDisplayName": "42", "displayName": "call-123"]
        XCTAssertNil(NuwaxVoipPushInvitation.systemCallerName(call))
        XCTAssertEqual(NuwaxVoipPushInvitation.systemCallerName(call.merging(["senderName": " Alice "]) { _, new in new }), "Alice")
    }
    func testOrdinaryUniPushLocatorCannotBecomePushKitAuthorization() {
        XCTAssertNil(parse(["type": "voip", "convId": "245475557381246976", "msgId": "123"]))
        var wrong = payload; wrong["calleeId"] = "another-account"; XCTAssertNil(parse(wrong))
        XCTAssertNil(NuwaxVoipPushInvitation(payload, userId: "", business: true, now: now))
    }
    func testUniPushRejectsStaleOrMissingRouteEvenForSameAccount() {
        func parseRoute(_ fields: [AnyHashable: Any], required: String) -> NuwaxVoipPushInvitation? {
            NuwaxVoipPushInvitation(fields, userId: "bob", business: true, now: now, requiredRegistrationId: required)
        }
        var fields = payload
        XCTAssertNil(parseRoute(fields, required: "route-new"))
        fields["routeRegistrationId"] = "route-old"
        XCTAssertNil(parseRoute(fields, required: "route-new"))
        XCTAssertNil(parseRoute(fields, required: ""))
        fields["routeRegistrationId"] = "route-new"
        XCTAssertNotNil(parseRoute(["payload": fields], required: "route-new"))
    }
    func testRejectsUnsafeIdsAndMalformedPayloads() {
        for id: Any in [245475557381246976 as Int64, "9223372036854775808", "../123", "1?token=x", "0", true] {
            var wrong = payload; wrong["convId"] = id; XCTAssertNil(parse(wrong))
        }
        var wrong = payload; wrong["callId"] = "../call"; XCTAssertNil(parse(wrong))
        wrong = payload; wrong["callId"] = "call\n"; XCTAssertNil(parse(wrong))
        wrong = payload; wrong["mediaType"] = "screen"; XCTAssertNil(parse(wrong))
    }
    func testExpiredFutureAndBooleanDeadlinesCannotRing() {
        for deadline: Any in [now, now - 1, now + 65_001, true, Double.infinity] {
            var wrong = payload; wrong["expiresAt"] = deadline; XCTAssertNil(parse(wrong))
        }
    }
    func testMessageMustMatchEveryLocatorAndMediaField() throws {
        let invitation = try XCTUnwrap(parse(payload))
        XCTAssertTrue(invitation.matches(message, now: now))
        for key in ["convId", "msgId", "msgType"] {
            var wrong = message; wrong[key] = "other"; XCTAssertFalse(invitation.matches(wrong, now: now))
        }
        var wrong = message; wrong["body"] = ["callId": "other", "mediaType": "audio"]
        XCTAssertFalse(invitation.matches(wrong, now: now))
        wrong["body"] = ["callId": "call-123", "mediaType": "video"]
        XCTAssertFalse(invitation.matches(wrong, now: now))
    }
    func testPendingCallSignalCanMatchByMessageWhenTheCallIdIsOmitted() throws {
        let invitation = try XCTUnwrap(parse(payload))
        let conversationID = try XCTUnwrap(invitation.convId)
        let messageID = try XCTUnwrap(invitation.msgId)
        XCTAssertTrue(invitation.matchesCallSignal(callID: "call-123", conversationID: conversationID, messageID: messageID))
        XCTAssertTrue(invitation.matchesCallSignal(callID: "", conversationID: conversationID, messageID: messageID))
        XCTAssertFalse(invitation.matchesCallSignal(callID: "", conversationID: conversationID, messageID: "123"))
        XCTAssertFalse(invitation.matchesCallSignal(callID: "", conversationID: "123", messageID: messageID))
        XCTAssertFalse(invitation.matchesCallSignal(callID: "call-123", conversationID: "123", messageID: messageID))
        XCTAssertFalse(invitation.matchesCallSignal(callID: "another-call", conversationID: conversationID, messageID: messageID))
    }
    func testNoLateMessageOrDeadlineExtension() throws {
        let invitation = try XCTUnwrap(parse(payload))
        XCTAssertFalse(invitation.matches(message, now: now + 45_000))
        var wrong = message; wrong["sendTime"] = now - 61_000; XCTAssertFalse(invitation.matches(wrong, now: now))
        wrong["sendTime"] = now + 6_000; XCTAssertFalse(invitation.matches(wrong, now: now))
        wrong["sendTime"] = now - 20_000; XCTAssertFalse(invitation.matches(wrong, now: now))
    }
    func testServerInt64ResponseRetainsPrecision() throws {
        let invitation = try XCTUnwrap(parse(payload))
        var numeric = message; numeric["msgId"] = NSNumber(value: Int64.max)
        XCTAssertTrue(invitation.matches(numeric, now: now))
        numeric["msgId"] = NSNumber(value: Double(Int64.max))
        XCTAssertFalse(invitation.matches(numeric, now: now))
    }
    func testLegacyDevelopmentProtocolDoesNotRequireImLocator() {
        var legacy = payload; legacy.removeValue(forKey: "convId"); legacy.removeValue(forKey: "msgId")
        XCTAssertNotNil(NuwaxVoipPushInvitation(legacy, userId: "bob", business: false, now: now))
        XCTAssertNil(parse(legacy))
    }

    func testMeetingMessageAndPushUseTheSameSystemIdentity() throws {
        let online = try XCTUnwrap(NuwaxVoipPushInvitation(meetingMessage: meetingMessage, userId: "456", now: now))
        var fields = payload
        fields["scene"] = "meeting"; fields["inviteId"] = "invite.123"
        fields["roomName"] = "room-123"; fields["title"] = "Meeting"; fields["mediaType"] = "video"
        let pushed = try XCTUnwrap(parse(fields))
        XCTAssertEqual(online.systemKey, pushed.systemKey)
        XCTAssertEqual(online.msgId, "9223372036854775807")
        XCTAssertEqual(online.expiresAt, now + 59_000)
        XCTAssertEqual(online.mediaType, "video")
        XCTAssertTrue(pushed.matches(meetingMessage, now: now))
    }

    func testMeetingMessageIgnoresSelfEchoExpiredAndSilentInvitations() throws {
        XCTAssertNil(NuwaxVoipPushInvitation(meetingMessage: meetingMessage, userId: "123", now: now))
        XCTAssertNil(NuwaxVoipPushInvitation(meetingMessage: meetingMessage, userId: "456", now: now + 59_000))
        let audible = try XCTUnwrap(NuwaxVoipPushInvitation(meetingMessage: meetingMessage, userId: "456", now: now))
        var silent = meetingMessage
        var body = try XCTUnwrap(silent["body"] as? [String: Any])
        for value: Any in [true, "true"] {
            body["silent"] = value; silent["body"] = body
            XCTAssertNil(NuwaxVoipPushInvitation(meetingMessage: silent, userId: "456", now: now))
            XCTAssertFalse(audible.matches(silent, now: now))
        }
    }
}
