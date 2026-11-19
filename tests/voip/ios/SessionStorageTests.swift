import Foundation
import Security
import XCTest
@testable import VoipPush

final class SessionStorageTests: XCTestCase {
    func testExistingColdStartContextIsUpdatedWithoutAddingOrDeleting() {
        var stored = "previous", added = false
        XCTAssertTrue(NuwaxVoipSessionStorage.upsert(update: { stored = "refreshed"; return errSecSuccess },
            add: { added = true; return errSecDuplicateItem }))
        XCTAssertEqual(stored, "refreshed"); XCTAssertFalse(added)
    }

    func testLockedKeychainOrWriteFailurePreservesLastUsableContext() {
        for failure in [errSecInteractionNotAllowed, errSecAuthFailed, errSecNotAvailable] {
            var stored = "previous", added = false
            XCTAssertFalse(NuwaxVoipSessionStorage.upsert(update: { failure },
                add: { added = true; stored = "replacement"; return errSecSuccess }))
            XCTAssertEqual(stored, "previous"); XCTAssertFalse(added)
        }
    }

    func testMissingItemAddsTheFirstConsentedSession() {
        var added = false
        XCTAssertTrue(NuwaxVoipSessionStorage.upsert(update: { errSecItemNotFound },
            add: { added = true; return errSecSuccess }))
        XCTAssertTrue(added)
    }

    func testFirstWriteFailureIsNotReportedAsPersisted() {
        XCTAssertFalse(NuwaxVoipSessionStorage.upsert(update: { errSecItemNotFound }, add: { errSecNotAvailable }))
    }
}
