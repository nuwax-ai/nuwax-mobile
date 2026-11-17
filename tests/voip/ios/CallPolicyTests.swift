import Foundation
import XCTest
@testable import VoipPush

final class CallPolicyTests: XCTestCase {
    func testPendingColdIncomingReservesTheOnlyCallSlot() {
        XCTAssertFalse(NuwaxVoipCallPolicy.mayWatch(callID: "outgoing", currentID: nil, pendingIDs: ["incoming"]))
        XCTAssertFalse(NuwaxVoipCallPolicy.mayWatch(callID: "outgoing", currentID: "active", pendingIDs: []))
        XCTAssertTrue(NuwaxVoipCallPolicy.mayWatch(callID: "incoming", currentID: nil, pendingIDs: ["incoming"]))
        XCTAssertTrue(NuwaxVoipCallPolicy.mayWatch(callID: "active", currentID: "active", pendingIDs: []))
        XCTAssertFalse(NuwaxVoipCallPolicy.mayWatch(callID: "", currentID: nil, pendingIDs: []))
    }
    func testLateSystemAudioActivationCannotRestartAnEndedOrMissingCall() {
        XCTAssertFalse(NuwaxVoipCallPolicy.mayActivateAudio(state: nil, outgoing: true, terminal: false))
        XCTAssertFalse(NuwaxVoipCallPolicy.mayActivateAudio(state: "ended", outgoing: true, terminal: false))
        XCTAssertFalse(NuwaxVoipCallPolicy.mayActivateAudio(state: "active", outgoing: true, terminal: true))
    }
    func testIncomingAudioOnlyActivatesAfterAnswering() {
        XCTAssertFalse(NuwaxVoipCallPolicy.mayActivateAudio(state: "ringing", outgoing: false, terminal: false))
        XCTAssertTrue(NuwaxVoipCallPolicy.mayActivateAudio(state: "connecting", outgoing: false, terminal: false))
        XCTAssertTrue(NuwaxVoipCallPolicy.mayActivateAudio(state: "ringing", outgoing: true, terminal: false))
    }
    func testTerminalHistorySurvivesSerializationWithoutOldDuplicates() throws {
        let saved = NuwaxVoipCallPolicy.terminalHistory(["ended-call", "other", "ended-call"])
        let data = try JSONSerialization.data(withJSONObject: saved)
        let restored = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String])
        XCTAssertEqual(NuwaxVoipCallPolicy.terminalHistory(restored), ["other", "ended-call"])
    }
    func testTerminalHistoryRetainsTheNewestBoundedCalls() {
        let ids = (0..<140).map { "call-\($0)" }
        let kept = NuwaxVoipCallPolicy.terminalHistory(ids)
        XCTAssertEqual(kept.count, 128)
        XCTAssertEqual(kept.first, "call-12")
        XCTAssertEqual(kept.last, "call-139")
    }
    func testStoredTerminalHistoryCannotIntroduceUnsafeCallIdentifiers() {
        XCTAssertEqual(NuwaxVoipCallPolicy.terminalHistory(["", "../route", "x\n", String(repeating: "x", count: 129), "valid-call"]), ["valid-call"])
    }
    func testOnlyTheIncomingUUIDExistsErrorIsADuplicateReport() {
        XCTAssertTrue(NuwaxVoipCallPolicy.isDuplicateIncomingReport(NSError(domain: "com.apple.CallKit.error.incomingcall", code: 2)))
        XCTAssertFalse(NuwaxVoipCallPolicy.isDuplicateIncomingReport(NSError(domain: "com.apple.CallKit.error.incomingcall", code: 3)))
        XCTAssertFalse(NuwaxVoipCallPolicy.isDuplicateIncomingReport(NSError(domain: "com.apple.CallKit.error.requesttransaction", code: 2)))
    }
    func testMutedPeerCanAnnounceReadinessOnlyForTheCurrentCall() {
        let packet = Data(#"{"v":1,"type":"ready","callId":"current"}"#.utf8)
        XCTAssertTrue(NuwaxVoipCallPolicy.isPeerReady(packet, topic: NuwaxVoipCallPolicy.readyTopic, callID: "current"))
        XCTAssertFalse(NuwaxVoipCallPolicy.isPeerReady(packet, topic: "other-topic", callID: "current"))
        XCTAssertFalse(NuwaxVoipCallPolicy.isPeerReady(packet, topic: NuwaxVoipCallPolicy.readyTopic, callID: "replacement"))
        XCTAssertFalse(NuwaxVoipCallPolicy.isPeerReady(Data(repeating: 0, count: 257), topic: NuwaxVoipCallPolicy.readyTopic, callID: "current"))
    }
    func testIncomingFilteringUsesDomainAndCodeTogether() {
        let focus = NuwaxVoipIncomingFailure(NSError(domain: "com.apple.CallKit.error.incomingcall", code: 3))
        XCTAssertEqual(focus.reason, "systemFocusFiltered")
        XCTAssertEqual(focus.code, "CALL_SYSTEM_FOCUS_FILTERED")
        XCTAssertEqual(NuwaxVoipIncomingFailure(NSError(domain: "com.apple.CallKit.error.requesttransaction", code: 3)).reason, "systemUnavailable")
        XCTAssertEqual(NuwaxVoipIncomingFailure(NSError(domain: "com.apple.CallKit.error.incomingcall", code: 4)).reason, "systemBlocked")
    }

    func testOnlyAnExplicitRejectionCanProduceDeclined() {
        for reason in ["timeout", "systemFocusFiltered", "systemUnavailable", "mediaFailed", "busy", "connectionTimeout", "ended"] {
            XCTAssertFalse(NuwaxVoipCallPolicy.canDecline(reason: reason, state: "ringing"), reason)
        }
        XCTAssertTrue(NuwaxVoipCallPolicy.canDecline(reason: "rejected", state: "ringing"))
        XCTAssertFalse(NuwaxVoipCallPolicy.canDecline(reason: "rejected", state: "active"))
    }

    func testAConflictingCallIDCannotFallBackToTheMessageID() {
        XCTAssertFalse(NuwaxVoipCallPolicy.matches(signalID: "old", messageID: "m1", callID: "current", callMessageID: "m1"))
        XCTAssertTrue(NuwaxVoipCallPolicy.matches(signalID: "", messageID: "m1", callID: "current", callMessageID: "m1"))
        XCTAssertFalse(NuwaxVoipCallPolicy.matches(signalID: "", messageID: "", callID: "current", callMessageID: ""))
    }

    func testLateDeclineOrTimeoutCannotTerminateAnAcceptedCall() {
        for state in ["connecting", "active"] {
            XCTAssertNil(NuwaxVoipCallPolicy.signalEndReason(type: "voip:decline", state: state))
            XCTAssertNil(NuwaxVoipCallPolicy.signalEndReason(type: "voip:timeout", state: state))
            XCTAssertEqual(NuwaxVoipCallPolicy.signalEndReason(type: "voip:cancel", state: state), "remoteEnded")
        }
        XCTAssertEqual(NuwaxVoipCallPolicy.signalEndReason(type: "voip:decline", state: "ringing"), "rejected")
    }
}
