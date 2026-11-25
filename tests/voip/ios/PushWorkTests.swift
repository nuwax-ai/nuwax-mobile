import Foundation
import XCTest
@testable import VoipPush

@MainActor final class PushWorkTests: XCTestCase {
    private func until(_ predicate: () -> Bool) async {
        for _ in 0..<2000 { if predicate() { return }; await Task.yield() }
        XCTFail("Expected push processing stage was not reached")
    }

    func testPushKitStartsSystemReportInlineAndCompletesBeforeNetworkReturns() async {
        var report: NuwaxVoipPushWork.ReportCompletion?
        var network: CheckedContinuation<Void, Never>?
        var completed = false, released = 0
        let work = NuwaxVoipPushWork(finished: { released += 1 })
        work.reportThenValidate(report: { report = $0 },
            validate: { await withCheckedContinuation { network = $0 } },
            completion: { _ in completed = true })
        XCTAssertNotNil(report, "CallKit reporting must begin before the delegate returns")
        XCTAssertFalse(completed); XCTAssertNil(network)
        report?(.success(()))
        XCTAssertTrue(completed)
        await until { network != nil }
        XCTAssertEqual(released, 0) // HTTP keeps its own lease, not the PushKit callback.
        network?.resume()
        await until { released == 1 }
    }

    func testReportFailureDoesNotVerifyOrLeakBackgroundTime() async {
        var verified = false, released = 0
        var failure: URLError.Code?
        let work = NuwaxVoipPushWork(finished: { released += 1 })
        work.reportThenValidate(report: { $0(.failure(URLError(.cancelled))) }, validate: { verified = true },
            completion: { if case .failure(let error) = $0 { failure = (error as? URLError)?.code } })
        work.cancel(); work.cancel()
        await Task.yield()
        XCTAssertFalse(verified); XCTAssertEqual(released, 1); XCTAssertEqual(failure, .cancelled)
    }

    func testExpiryDuringReportClosesLeaseAndCannotStartLateVerification() async {
        var report: NuwaxVoipPushWork.ReportCompletion?
        var verified = false, completed = false, released = 0
        let work = NuwaxVoipPushWork(finished: { released += 1 })
        work.reportThenValidate(report: { report = $0 }, validate: { verified = true },
            completion: { _ in completed = true })
        work.cancel()
        XCTAssertEqual(released, 1)
        report?(.success(()))
        await Task.yield()
        XCTAssertTrue(completed); XCTAssertFalse(verified); XCTAssertEqual(released, 1)
    }

    func testLogoutOrExpiryCancelsHttpAndReleasesExactlyOnce() async {
        var network: CheckedContinuation<Void, Never>?, adopted = false, released = 0, finished = false
        let work = NuwaxVoipPushWork(finished: { released += 1 })
        work.reportThenValidate(report: { $0(.success(())) }, validate: {
            await withCheckedContinuation { network = $0 }
            if !Task.isCancelled { adopted = true }
            finished = true
        }, completion: { _ in })
        await until { network != nil }
        work.cancel(); work.cancel()
        XCTAssertEqual(released, 1)
        network?.resume(); await until { finished }
        XCTAssertFalse(adopted); XCTAssertEqual(released, 1)
    }

    func testCancellingAnOldDeliveryDoesNotCancelAnotherPush() async {
        var oldNetwork: CheckedContinuation<Void, Never>?, received = false, oldReleased = 0, newReleased = 0
        let old = NuwaxVoipPushWork(finished: { oldReleased += 1 })
        let next = NuwaxVoipPushWork(finished: { newReleased += 1 })
        old.reportThenValidate(report: { $0(.success(())) },
            validate: { await withCheckedContinuation { oldNetwork = $0 } }, completion: { _ in })
        await until { oldNetwork != nil }
        old.cancel()
        next.reportThenValidate(report: { $0(.success(())) }, validate: { received = true }, completion: { _ in })
        await until { received && newReleased == 1 }
        oldNetwork?.resume(); await Task.yield()
        XCTAssertEqual(oldReleased, 1); XCTAssertEqual(newReleased, 1)
    }
}
