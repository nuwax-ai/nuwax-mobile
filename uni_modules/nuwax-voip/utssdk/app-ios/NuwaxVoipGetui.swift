import Foundation
import ObjectiveC

/// The offline host already embeds GeTuiSdk in DCloudUTSExtAPI. Resolve the
/// documented class methods without linking or starting a second SDK.
@MainActor enum NuwaxVoipGetui {
    static func clientId() -> String? {
        let selector = NSSelectorFromString("clientId")
        guard let sdk = sdkClass, let method = class_getClassMethod(sdk, selector) else { return nil }
        typealias Call = @convention(c) (AnyClass, Selector) -> Unmanaged<AnyObject>?
        let result = unsafeBitCast(method_getImplementation(method), to: Call.self)(sdk, selector)
        return result?.takeUnretainedValue() as? String
    }

    static func bind(_ token: Data) -> Bool {
        let selector = NSSelectorFromString("registerVoipTokenCredentials:")
        guard let sdk = sdkClass, let method = class_getClassMethod(sdk, selector) else { return false }
        typealias Call = @convention(c) (AnyClass, Selector, NSData) -> ObjCBool
        return unsafeBitCast(method_getImplementation(method), to: Call.self)(sdk, selector, token as NSData).boolValue
    }

    static func recordReceipt(_ payload: [AnyHashable: Any]) {
        let selector = NSSelectorFromString("handleVoipNotification:")
        guard let sdk = sdkClass, let method = class_getClassMethod(sdk, selector) else { return }
        typealias Call = @convention(c) (AnyClass, Selector, NSDictionary) -> Void
        unsafeBitCast(method_getImplementation(method), to: Call.self)(sdk, selector, payload as NSDictionary)
    }

    private static var sdkClass: AnyClass? { NSClassFromString("GeTuiSdk") }
}
