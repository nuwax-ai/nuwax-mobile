import Foundation
import XCTest
@testable import VoipPush

final class SystemCallRegistryTests: XCTestCase {
    func testDuplicatePushKitStillRequiresAReportAfterOnlineRegistration() throws {
        var registry = NuwaxVoipSystemCallRegistry(); let id = UUID()
        let run = try XCTUnwrap(registry.beginRegistration(id))
        registry.registrationReported(id, generation: run)
        XCTAssertNil(registry.beginIncomingReport(id, requiredByPushKit: false))
        XCTAssertEqual(registry.beginIncomingReport(id, requiredByPushKit: true), run)
        XCTAssertTrue(registry.isReported(id))
    }
    func testTerminalPushKitReportDoesNotReviveBusinessRegistration() throws {
        var registry = NuwaxVoipSystemCallRegistry(); let id = UUID()
        registry.markEnded(id)
        let run = try XCTUnwrap(registry.beginIncomingReport(id, requiredByPushKit: true))
        XCTAssertFalse(registry.registrationIsCurrent(id, generation: run))
        registry.registrationReported(id, generation: run)
        XCTAssertTrue(registry.isReported(id)) // closes the late system call
        registry.systemEnded(id)
        XCTAssertNil(registry.beginIncomingReport(id, requiredByPushKit: false))
    }
    func testFilteredReportsHaveNoSystemCallToEnd() throws {
        var registry = NuwaxVoipSystemCallRegistry(); let id = UUID()
        let run = try XCTUnwrap(registry.beginRegistration(id))
        registry.registrationFailed(id, generation: run); registry.markEnded(id)
        XCTAssertFalse(registry.isReported(id))
    }
    func testLateReportedCallStillNeedsCleanupAfterLocalEnd() throws {
        var registry = NuwaxVoipSystemCallRegistry(); let id = UUID()
        let run = try XCTUnwrap(registry.beginRegistration(id))
        registry.markEnded(id); registry.registrationReported(id, generation: run)
        XCTAssertFalse(registry.registrationIsCurrent(id, generation: run))
        XCTAssertTrue(registry.isReported(id))
        registry.systemEnded(id)
        XCTAssertFalse(registry.isReported(id))
    }
    func testOldManagerCannotReportIntoANewGeneration() throws {
        var registry = NuwaxVoipSystemCallRegistry(); let id = UUID()
        let old = try XCTUnwrap(registry.beginRegistration(id)); registry.reset()
        registry.registrationReported(id, generation: old)
        XCTAssertFalse(registry.isReported(id))
    }
    func testAnEndedCallCannotRegisterLater() {
        var registry = NuwaxVoipSystemCallRegistry()
        let id = UUID()
        registry.markEnded(id)
        XCTAssertNil(registry.beginRegistration(id))
    }

    func testEndDuringSystemRegistrationRejectsLateCompletion() throws {
        var registry = NuwaxVoipSystemCallRegistry()
        let id = UUID()
        let run = try XCTUnwrap(registry.beginRegistration(id))
        registry.markEnded(id)
        XCTAssertFalse(registry.registrationIsCurrent(id, generation: run))
        XCTAssertTrue(registry.hasEnded(id))
    }

    func testDuplicateRegistrationIsSuppressedAndFailedAttemptCanRetry() throws {
        var registry = NuwaxVoipSystemCallRegistry()
        let id = UUID()
        let run = try XCTUnwrap(registry.beginRegistration(id))
        XCTAssertNil(registry.beginRegistration(id))
        registry.registrationFailed(id, generation: run)
        XCTAssertNotNil(registry.beginRegistration(id))
    }

    func testOldSessionCompletionCannotClearNewRegistration() throws {
        var registry = NuwaxVoipSystemCallRegistry()
        let id = UUID()
        let old = try XCTUnwrap(registry.beginRegistration(id))
        registry.reset()
        let current = try XCTUnwrap(registry.beginRegistration(id))
        registry.registrationFailed(id, generation: old)
        XCTAssertFalse(registry.registrationIsCurrent(id, generation: old))
        XCTAssertTrue(registry.registrationIsCurrent(id, generation: current))
    }
}
