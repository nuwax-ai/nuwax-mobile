import XCTest
@testable import VoipPush

final class ClientStateTests: XCTestCase {
    func testNativeRestoreAndUiBootstrapShareTransportOnlyForTheSameCredentials() {
        let native = [
            "apiBaseUrl": "https://test.example", "userId": "user-a", "deviceId": "phone-a",
            "accessToken": "test-token", "protocol": "im-voip-v1", "pushBusinessEnvironment": "test",
            "scope": "native-restore"
        ]
        var ui = native
        ui["scope"] = "app-ui"
        XCTAssertTrue(NuwaxVoipClientPolicy.sharesTransport(native, ui))
        for key in ["apiBaseUrl", "userId", "deviceId", "accessToken", "protocol", "pushBusinessEnvironment"] {
            var changed = ui
            changed[key] = "different"
            XCTAssertFalse(NuwaxVoipClientPolicy.sharesTransport(native, changed), key)
        }
        XCTAssertFalse(NuwaxVoipClientPolicy.sharesTransport([:], [:]))
    }

    func testQASignedHostRejectsStoredProductionContext() {
        let testOrigin = "https://testagent.xspaceagi.com"
        XCTAssertTrue(NuwaxVoipClientPolicy.allowsOrigin(testOrigin, pinnedOrigin: testOrigin))
        XCTAssertFalse(NuwaxVoipClientPolicy.allowsOrigin("https://agent.nuwax.com", pinnedOrigin: testOrigin))
        XCTAssertFalse(NuwaxVoipClientPolicy.allowsOrigin(testOrigin + ".untrusted", pinnedOrigin: testOrigin))
        XCTAssertFalse(NuwaxVoipClientPolicy.allowsOrigin(testOrigin, pinnedOrigin: ""))
        XCTAssertTrue(NuwaxVoipClientPolicy.allowsOrigin("https://enterprise.example", pinnedOrigin: nil))
    }

    func testMissingCallerAvatarUsesTheMatchedActiveContactWithoutChangingCallState() throws {
        let call: [String: Any] = ["callId": "call-a", "callerId": "42", "state": "active",
                                   "version": 3, "callerAvatar": " "]
        let contacts: [[String: Any]] = [
            ["userId": 18, "subjectType": 1, "status": 1, "avatar": "/api/f/other.png"],
            ["userId": "42", "subjectType": 2, "status": 1, "avatar": "/api/f/agent.png"],
            ["userId": "42", "subjectType": 1, "status": 2, "avatar": "/api/f/pending.png"],
            ["userId": 42, "subjectType": 1, "status": 1, "avatar": " /api/f/caller.png "]
        ]
        let updated = try XCTUnwrap(NuwaxVoipClientPolicy.backfillCallerAvatar(call, callID: "call-a", callerID: "42", contacts: contacts))
        XCTAssertEqual(updated["callerAvatar"] as? String, "/api/f/caller.png")
        XCTAssertEqual(updated["state"] as? String, "active")
        XCTAssertEqual(updated["version"] as? Int, 4)
        XCTAssertNil(NuwaxVoipClientPolicy.backfillCallerAvatar(updated, callID: "call-a", callerID: "42", contacts: contacts))
        XCTAssertNil(NuwaxVoipClientPolicy.backfillCallerAvatar(call, callID: "call-b", callerID: "42", contacts: contacts))
        XCTAssertNil(NuwaxVoipClientPolicy.backfillCallerAvatar(call, callID: "call-a", callerID: "18", contacts: contacts))
        XCTAssertNil(NuwaxVoipClientPolicy.backfillCallerAvatar(call, callID: "call-a", callerID: "42", contacts: Array(contacts.dropLast())))
    }

    func testFirstAnswerRequiresForegroundOnlyWhenPermissionUndetermined() {
        XCTAssertEqual(NuwaxVoipClientPolicy.permissionPlan(microphone: .notDetermined, camera: .denied, video: false, foreground: false), .foreground)
        XCTAssertEqual(NuwaxVoipClientPolicy.permissionPlan(microphone: .notDetermined, camera: .denied, video: false, foreground: true), .request)
        XCTAssertEqual(NuwaxVoipClientPolicy.permissionPlan(microphone: .authorized, camera: .denied, video: false, foreground: false), .ready)
        XCTAssertEqual(NuwaxVoipClientPolicy.permissionPlan(microphone: .authorized, camera: .denied, video: true, foreground: true), .settings)
        XCTAssertEqual(NuwaxVoipClientPolicy.permissionPlan(microphone: .denied, camera: .notDetermined, video: false, foreground: true), .settings)
    }
    func testAudioRequiresSystemActivationAndStopsForHoldOrInterruption() {
        for (paused, interrupted, active, terminal, expected) in [
            (false, false, true, false, true), (true, false, true, false, false),
            (false, true, true, false, false), (false, false, false, false, false), (false, false, true, true, false)
        ] {
            XCTAssertEqual(NuwaxVoipClientPolicy.canRunAudio(state: "active", outgoing: false, terminal: terminal, active: active, paused: paused, interrupted: interrupted), expected)
        }
        XCTAssertFalse(NuwaxVoipClientPolicy.canRunAudio(state: "ringing", outgoing: false, terminal: false, active: true, paused: false, interrupted: false))
    }
    func testReconnectDeadlineDoesNotExtendOrAffectReplacementCall() {
        var window = NuwaxVoipReconnectWindow()
        window.begin(callID: "a", generation: 1, now: 100)
        window.begin(callID: "a", generation: 1, now: 5000)
        XCTAssertFalse(window.expired(callID: "a", generation: 1, now: 30_099))
        XCTAssertTrue(window.expired(callID: "a", generation: 1, now: 30_100))
        XCTAssertFalse(window.expired(callID: "b", generation: 1, now: 50_000))
        XCTAssertFalse(window.expired(callID: "a", generation: 2, now: 50_000))
        window.cancel()
        XCTAssertFalse(window.expired(callID: "a", generation: 1, now: 50_000))
    }
}
