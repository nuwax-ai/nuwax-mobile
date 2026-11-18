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
    private func parse(_ raw: [AnyHashable: Any]) -> NuwaxVoipPushInvitation? {
        NuwaxVoipPushInvitation(raw, userId: "bob", business: true, now: now)
    }
    func testFullInvitationAndGetuiWrappers() throws {
        XCTAssertEqual(parse(payload)?.callId, "call-123")
        XCTAssertNotNil(parse(["payload": payload]))
        let data = try JSONSerialization.data(withJSONObject: payload)
        XCTAssertNotNil(parse(["payload": String(decoding: data, as: UTF8.self)]))
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
}
