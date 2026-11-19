import Foundation
import XCTest
@testable import VoipPush

@MainActor final class ApnsRegistrationTests: XCTestCase {
    private func device(_ byte: UInt8 = 1, environment: String = "development", previous: String = "") -> NuwaxVoipApnsDevice {
        NuwaxVoipApnsDevice(token: Data([0, byte, 255]), bundleId: "com.nuwax.app", environment: environment,
                            deviceId: "phone", previousRegistrationId: previous)!
    }
    private func ack(_ body: [String: Any], ready: Bool = false, registered: Bool = true) -> [String: Any] {
        var result = body; result.removeValue(forKey: "token"); result["registered"] = registered; result["nativePush"] = ready; return result
    }
    private func until(_ predicate: () -> Bool) async {
        for _ in 0..<2000 { if predicate() { return }; await Task.yield() }
        XCTFail("Expected registration state was not reached")
    }
    func testExplicitSignedEnvironmentAndNamespace() {
        XCTAssertNil(NuwaxVoipApnsDevice(token: Data([1]), bundleId: "com.nuwax.app", environment: "", deviceId: "phone"))
        XCTAssertNil(NuwaxVoipApnsDevice(token: Data(), bundleId: "com.nuwax.app", environment: "development", deviceId: "phone"))
        let record = device()
        XCTAssertEqual(record.token, "0001ff")
        XCTAssertEqual(record.body("register")["provider"] as? String, "apns")
        XCTAssertEqual(record.body("register")["channel"] as? String, "pushKit")
        XCTAssertEqual(NuwaxVoipApnsDevice(stored: record.body("register")), record)
    }
    func testOldGenericRegistrationResponseCannotClaimApnsSupport() {
        let record = device()
        XCTAssertFalse(record.acknowledges(["registered": true]))
        var wrong = ack(record.body("register")); wrong["environment"] = "production"
        XCTAssertFalse(record.acknowledges(wrong))
        wrong = ack(record.body("register")); wrong["registrationId"] = UUID().uuidString
        XCTAssertFalse(record.acknowledges(wrong))
        XCTAssertTrue(record.acknowledges(ack(record.body("register"))))
    }
    func testUniPushRegistrationKeepsTokenOnDeviceAndVersionsCidAndTokenChanges() throws {
        func candidate(_ byte: UInt8, _ cid: String, environment: String = "development") throws -> NuwaxVoipApnsDevice {
            try XCTUnwrap(NuwaxVoipApnsDevice(token: Data([byte]), bundleId: "com.nuwax.app", environment: environment,
                                             deviceId: "phone", cid: cid))
        }
        let old = try candidate(1, "cid-one")
        let same = try candidate(1, "cid-one")
        let changedCid = try candidate(1, "cid-two")
        let changedToken = try candidate(2, "cid-one")
        let changedEnvironment = try candidate(1, "cid-one", environment: "production")
        XCTAssertEqual(same.replacing(old), old)
        XCTAssertEqual(changedCid.replacing(old).previousRegistrationId, old.registrationId)
        XCTAssertEqual(changedToken.replacing(old).previousRegistrationId, old.registrationId)
        XCTAssertEqual(changedEnvironment.replacing(old).previousRegistrationId, "")
        XCTAssertEqual(same.replacing(old, forceNew: true).registrationId, same.registrationId)
        XCTAssertEqual(NuwaxVoipApnsDevice(stored: old.stored), old)
        for action in ["register", "revoke"] {
            let body = old.body(action)
            XCTAssertEqual(body["provider"] as? String, "unipush")
            XCTAssertEqual(body["cid"] as? String, "cid-one")
            XCTAssertNil(body["token"])
        }
        var response = ack(old.body("register"), ready: true)
        XCTAssertTrue(old.acknowledges(response))
        response["cid"] = "wrong"
        XCTAssertFalse(old.acknowledges(response))
        XCTAssertFalse(old.acknowledges(ack(device().body("register"), ready: true)))
    }
    func testBackendAcknowledgementIsSeparateFromDeliveryReadiness() async {
        var states: [(String, Bool)] = []
        let registration = NuwaxVoipApnsRegistration(transport: { self.ack($0) }, changed: { states.append(($0, $1)) })
        registration.register(device())
        await until { states.last?.0 == "registered" }
        XCTAssertEqual(states.last?.1, false)
        registration.stop(revoke: false)
    }
    func testMissingBackendRetriesFiveTimesWithoutGetuiOrMediaDependency() async {
        var requests = 0, delays: [UInt64] = [], states: [String] = []
        let registration = NuwaxVoipApnsRegistration(transport: { _ in requests += 1; throw URLError(.cannotConnectToHost) },
            sleep: { delays.append($0) }, changed: { states.append($0); XCTAssertFalse($1) })
        registration.register(device())
        await until { states.last == "unavailable" }
        XCTAssertEqual(requests, 5)
        XCTAssertEqual(delays, [1, 2, 4, 8].map { UInt64($0) * 1_000_000_000 })
    }
    func testLogoutRevokesCapturedRegistrationAndIgnoresLateSuccess() async {
        var pending: CheckedContinuation<Void, Never>?
        var requests: [[String: Any]] = [], states: [String] = []
        let registration = NuwaxVoipApnsRegistration(transport: { body in
            requests.append(body)
            if body["action"] as? String == "register" { await withCheckedContinuation { pending = $0 }; return self.ack(body, ready: true) }
            return self.ack(body, registered: false)
        }, changed: { state, _ in states.append(state) })
        let record = device(); registration.register(record)
        await until { pending != nil }
        let revoke = registration.stop(revoke: true)
        await revoke?.value
        pending?.resume()
        await Task.yield()
        XCTAssertEqual(states.last, "stopped")
        XCTAssertFalse(states.contains("registered"))
        XCTAssertEqual(requests.last?["registrationId"] as? String, record.registrationId)
        XCTAssertEqual(requests.last?["token"] as? String, record.token)
        XCTAssertEqual(requests.last?["action"] as? String, "revoke")
    }
    func testRestoredTokenCanBeRevokedBeforeFirstRegistryUpdate() async {
        let record = device(); var sent: [String: Any] = [:]
        let registration = NuwaxVoipApnsRegistration(restored: record, transport: { sent = $0; return self.ack($0, registered: false) }, changed: { _, _ in })
        await registration.stop(revoke: true)?.value
        XCTAssertEqual(sent["registrationId"] as? String, record.registrationId)
        XCTAssertNil(registration.current)
    }
    func testTokenRotationIgnoresPriorResponseAndKeepsNewRegistration() async {
        let old = device(), new = device(2)
        var pending: CheckedContinuation<Void, Never>?, states: [String] = []
        let registration = NuwaxVoipApnsRegistration(transport: { body in
            if body["registrationId"] as? String == old.registrationId { await withCheckedContinuation { pending = $0 } }
            return self.ack(body)
        }, changed: { state, _ in states.append(state) })
        registration.register(old); await until { pending != nil }
        registration.register(new); await until { states.last == "registered" }
        pending?.resume(); await Task.yield()
        XCTAssertEqual(registration.current, new)
        XCTAssertEqual(states.filter { $0 == "registered" }.count, 1)
        registration.stop(revoke: false)
    }
}
