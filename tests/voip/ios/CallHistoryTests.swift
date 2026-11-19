import XCTest
@testable import VoipPush

final class CallHistoryTests: XCTestCase {
    private func record(_ id: String = "a", direction: String = "incoming") -> NuwaxVoipCallRecord {
        NuwaxVoipCallRecord(callId: id, convId: "chat", peerId: "bob", peerName: "Bob\n", direction: direction, mediaType: "audio", startedAt: 100)
    }
    func testTerminalCannotReviveOrChangePeer() {
        var history = NuwaxVoipCallHistory(); history.observe(record())
        var other = record(); other.peerId = "mallory"; other.connectedAt = 200
        history.observe(other); XCTAssertEqual(history.records[0].connectedAt, 0)
        history.end(callID: "a", reason: "timeout", now: 300)
        var late = record(); late.connectedAt = 250
        history.observe(late); history.end(callID: "a", reason: "rejected", now: 400)
        XCTAssertTrue(history.records[0].missed); XCTAssertEqual(history.records[0].reason, "timeout")
        XCTAssertEqual(history.records[0].peerName, "Bob")
    }
    func testAnsweredAndDeclinedAreNotMissed() {
        var history = NuwaxVoipCallHistory(); history.observe(record())
        var active = record(); active.connectedAt = 200; history.observe(active)
        history.end(callID: "a", reason: "ended", now: 500)
        XCTAssertFalse(history.records[0].missed); XCTAssertEqual(history.records[0].payload["durationMs"] as? Double, 300)
        for reason in ["rejected", "answeredElsewhere", "incomingDisabled"] {
            var h = NuwaxVoipCallHistory(); h.observe(record()); h.end(callID: "a", reason: reason, now: 200)
            XCTAssertFalse(h.records[0].missed)
        }
    }
    func testRecoveryClosesInterruptedCallAndBoundsRecords() {
        var history = NuwaxVoipCallHistory()
        for index in 0..<120 { history.observe(record("call-\(index)")) }
        XCTAssertEqual(history.records.count, 100)
        let restored = NuwaxVoipCallHistory(data: history.encode(), recoveringAt: 1000)
        XCTAssertTrue(restored.records.allSatisfy { $0.endedAt == 1000 && $0.reason == "processInterrupted" })
        XCTAssertEqual(NuwaxVoipCallHistory(data: Data("not json".utf8), recoveringAt: 1000).records.count, 0)
        XCTAssertEqual(NuwaxVoipCallHistory(data: Data(repeating: 0, count: 262_145), recoveringAt: 1000).records.count, 0)
    }
    func testRejectsInvalidIdentifiersAndSanitizesNames() {
        var history = NuwaxVoipCallHistory()
        var invalid = record(); invalid.convId = "../chat"; history.observe(invalid)
        invalid = record(); invalid.startedAt = .nan; history.observe(invalid)
        XCTAssertTrue(history.records.isEmpty)
        XCTAssertEqual(NuwaxVoipCallHistory.cleanName(" \u{0}Bob\n "), "Bob")
        XCTAssertEqual(NuwaxVoipCallHistory.cleanName(String(repeating: "a", count: 120)).count, 80)
    }
}
