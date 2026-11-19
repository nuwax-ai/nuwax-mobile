import Foundation
import XCTest
@testable import VoipPush

@MainActor final class PushWorkTests: XCTestCase {
    private func until(_ predicate: () -> Bool) async {
        for _ in 0..<2000 { if predicate() { return }; await Task.yield() }
        XCTFail("Expected push processing stage was not reached")
    }

    func testPushKitReturnsAfterSystemReportWhileNetworkIsStillBlocked() async throws {
        var report: CheckedContinuation<Void, Never>?, network: CheckedContinuation<Void, Never>?
        var returned = false, released = 0
        let work = NuwaxVoipPushWork(finished: { released += 1 })
        let delivery = Task { @MainActor in
            try await work.reportThenValidate(report: { await withCheckedContinuation { report = $0 } },
                validate: { await withCheckedContinuation { network = $0 } })
            returned = true
        }
        await until { report != nil }
        XCTAssertFalse(returned); XCTAssertNil(network)
        report?.resume()
        await until { returned && network != nil }
        XCTAssertEqual(released, 0) // HTTP keeps its own lease, not the PushKit callback.
        network?.resume()
        try await delivery.value
        await until { released == 1 }
    }

    func testReportFailureDoesNotVerifyOrLeakBackgroundTime() async {
        var verified = false, released = 0
        let work = NuwaxVoipPushWork(finished: { released += 1 })
        do {
            try await work.reportThenValidate(report: { throw URLError(.cancelled) }, validate: { verified = true })
            XCTFail("System report failure was swallowed")
        } catch { }
        work.cancel(); work.cancel()
        XCTAssertFalse(verified); XCTAssertEqual(released, 1)
    }

    func testExpiryDuringReportClosesLeaseAndCannotStartLateVerification() async throws {
        var report: CheckedContinuation<Void, Never>?, verified = false, released = 0
        let work = NuwaxVoipPushWork(finished: { released += 1 })
        let delivery = Task { @MainActor in
            try await work.reportThenValidate(report: { await withCheckedContinuation { report = $0 } },
                validate: { verified = true })
        }
        await until { report != nil }
        work.cancel()
        XCTAssertEqual(released, 1)
        report?.resume(); try await delivery.value
        XCTAssertFalse(verified); XCTAssertEqual(released, 1)
    }

    func testLogoutOrExpiryCancelsHttpAndReleasesExactlyOnce() async throws {
        var network: CheckedContinuation<Void, Never>?, adopted = false, released = 0, finished = false
        let work = NuwaxVoipPushWork(finished: { released += 1 })
        try await work.reportThenValidate(report: {}, validate: {
            await withCheckedContinuation { network = $0 }
            if !Task.isCancelled { adopted = true }
            finished = true
        })
        await until { network != nil }
        work.cancel(); work.cancel()
        XCTAssertEqual(released, 1)
        network?.resume(); await until { finished }
        XCTAssertFalse(adopted); XCTAssertEqual(released, 1)
    }

    func testCancellingAnOldDeliveryDoesNotCancelAnotherPush() async throws {
        var oldNetwork: CheckedContinuation<Void, Never>?, received = false, oldReleased = 0, newReleased = 0
        let old = NuwaxVoipPushWork(finished: { oldReleased += 1 })
        let next = NuwaxVoipPushWork(finished: { newReleased += 1 })
        try await old.reportThenValidate(report: {}, validate: { await withCheckedContinuation { oldNetwork = $0 } })
        await until { oldNetwork != nil }
        old.cancel()
        try await next.reportThenValidate(report: {}, validate: { received = true })
        await until { received && newReleased == 1 }
        oldNetwork?.resume(); await Task.yield()
        XCTAssertEqual(oldReleased, 1); XCTAssertEqual(newReleased, 1)
    }
}
