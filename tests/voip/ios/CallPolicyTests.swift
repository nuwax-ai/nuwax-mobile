import Foundation
import XCTest
@testable import VoipPush

final class CallPolicyTests: XCTestCase {
    func testSystemAnswerPreservesTheInvitationMediaUnlessAudioWasRequested() {
        XCTAssertEqual(NuwaxVoipCallPolicy.answerMediaType(invited: "video", requested: nil), "video")
        XCTAssertEqual(NuwaxVoipCallPolicy.answerMediaType(invited: "audio", requested: nil), "audio")
        XCTAssertEqual(NuwaxVoipCallPolicy.answerMediaType(invited: "video", requested: "video"), "video")
        XCTAssertEqual(NuwaxVoipCallPolicy.answerMediaType(invited: "video", requested: "audio"), "audio")
        XCTAssertEqual(NuwaxVoipCallPolicy.answerMediaType(invited: "audio", requested: "video"), "audio")
    }
    func testRingTimeUsesTheAcceptedInvitationAndDoesNotExtendExpiredRetries() {
        XCTAssertEqual(NuwaxVoipCallPolicy.ringDeadline(sendTime: 120_000, acknowledgedAt: 120_500), 180_000)
        XCTAssertEqual(NuwaxVoipCallPolicy.ringDeadline(sendTime: nil, acknowledgedAt: 120_500), 180_500)
        XCTAssertEqual(NuwaxVoipCallPolicy.ringDeadline(sendTime: 1_000_000, acknowledgedAt: 120_500), 180_500)
        XCTAssertLessThan(NuwaxVoipCallPolicy.ringDeadline(sendTime: 1000, acknowledgedAt: 120_500), 120_500)
    }
    func testActiveHangupDoesNotBecomeLegacyCancel() {
        XCTAssertNil(NuwaxVoipCallPolicy.businessEndAction(caller: true, state: "active", reason: "ended"))
        XCTAssertEqual(NuwaxVoipCallPolicy.businessEndAction(caller: true, state: "connecting", reason: "cancelled"), "ended")
        XCTAssertEqual(NuwaxVoipCallPolicy.businessEndAction(caller: true, state: "ringing", reason: "timeout"), "ended")
        XCTAssertEqual(NuwaxVoipCallPolicy.businessEndAction(caller: false, state: "ringing", reason: "rejected"), "declined")
        XCTAssertNil(NuwaxVoipCallPolicy.businessEndAction(caller: false, state: "connecting", reason: "rejected"))
        XCTAssertNil(NuwaxVoipCallPolicy.businessEndAction(caller: true, state: "ringing", reason: "remoteEnded"))
    }
    func testRemoteDepartureWaitsThroughReconnectAndRequiresActualPreviousPeer() {
        XCTAssertFalse(NuwaxVoipCallPolicy.shouldFinishRemoteLeft(everHadRemote: true, remoteCount: 0, reconnecting: true, graceElapsed: true))
        XCTAssertFalse(NuwaxVoipCallPolicy.shouldFinishRemoteLeft(everHadRemote: true, remoteCount: 1, reconnecting: false, graceElapsed: true))
        XCTAssertFalse(NuwaxVoipCallPolicy.shouldFinishRemoteLeft(everHadRemote: false, remoteCount: 0, reconnecting: false, graceElapsed: true))
        XCTAssertFalse(NuwaxVoipCallPolicy.shouldFinishRemoteLeft(everHadRemote: true, remoteCount: 0, reconnecting: false, graceElapsed: false))
        XCTAssertTrue(NuwaxVoipCallPolicy.shouldFinishRemoteLeft(everHadRemote: true, remoteCount: 0, reconnecting: false, graceElapsed: true))
    }
    func testAuthenticationFailureRemainsFatalUnlikeAnswerReportServiceFailure() {
        XCTAssertTrue(NuwaxVoipCallPolicy.isAuthenticationFailure(401)); XCTAssertTrue(NuwaxVoipCallPolicy.isAuthenticationFailure(403))
        XCTAssertFalse(NuwaxVoipCallPolicy.isAuthenticationFailure(500)); XCTAssertFalse(NuwaxVoipCallPolicy.isAuthenticationFailure(404))
    }
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
