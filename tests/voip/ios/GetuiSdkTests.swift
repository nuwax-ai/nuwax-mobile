import Foundation
import XCTest
@testable import VoipPush

@MainActor @objc(GeTuiSdk) private final class GetuiSdkFixture: NSObject {
    static var token: Data?
    static var receipt: NSDictionary?

    @objc class func clientId() -> NSString { "fixture-cid" }

    @objc class func registerVoipTokenCredentials(_ token: NSData) -> Bool {
        self.token = token as Data
        return token.length > 0
    }

    @objc class func handleVoipNotification(_ payload: NSDictionary) {
        receipt = payload
    }
}

@MainActor final class GetuiSdkTests: XCTestCase {
    func testCallsExistingObjectiveCBindingAndReceiptSelectors() {
        XCTAssertNotNil(NSClassFromString("GeTuiSdk"))
        XCTAssertEqual(NuwaxVoipGetui.clientId(), "fixture-cid")
        XCTAssertFalse(NuwaxVoipGetui.bind(Data()))
        let token = Data([0, 1, 255])
        XCTAssertTrue(NuwaxVoipGetui.bind(token))
        XCTAssertEqual(GetuiSdkFixture.token, token)
        NuwaxVoipGetui.recordReceipt(["aps": ["fixture": true]])
        XCTAssertNotNil(GetuiSdkFixture.receipt?["aps"])
    }
}
