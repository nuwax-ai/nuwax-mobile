import Foundation
import UIKit
import AuthenticationServices
import Security
import CryptoKit

/// UTS 薄桥只传 JSON 字符串；凭证始终留在 ThisDeviceOnly Keychain 中。
public final class NativeAuthBridgeSwift: NSObject, ASWebAuthenticationPresentationContextProviding {
    private static let callback = "com.nuwax.app.auth://oauth/callback"
    private static let service = "com.nuwax.nativeauth.transaction.v1"
    private static let shared = NativeAuthBridgeSwift()
    private static let lock = NSRecursiveLock()
    private var session: ASWebAuthenticationSession?
    private var activeId = ""
    private var anchor: UIWindow?

    private static func locked<T>(_ body: () -> T) -> T { lock.lock(); defer { lock.unlock() }; return body() }
    private static func b64(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
    public static func randomToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = bytes.withUnsafeMutableBytes { buffer in SecRandomCopyBytes(kSecRandomDefault, buffer.count, buffer.baseAddress!) }
        return status == errSecSuccess ? b64(Data(bytes)) : ""
    }
    public static func sha256(_ value: String) -> String { b64(Data(SHA256.hash(data: Data(value.utf8)))) }
    public static func available() -> Bool {
        guard let types = Bundle.main.object(forInfoDictionaryKey: "CFBundleURLTypes") as? [[String: Any]] else { return false }
        return types.contains { ($0["CFBundleURLSchemes"] as? [String] ?? []).contains("com.nuwax.app.auth") }
    }

    private static func query() -> [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "active-auth"]
    }
    private static func readVault() -> [String: String]? {
        var q = query(); q[kSecReturnData as String] = true; q[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(q as CFDictionary, &result)
        if status == errSecItemNotFound { return [:] }
        guard status == errSecSuccess, let data = result as? Data,
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: String] else { return nil }
        return object
    }
    private static func writeVault(_ vault: [String: String]) -> Bool {
        guard let data = try? JSONSerialization.data(withJSONObject: vault) else { return false }
        let update = [kSecValueData as String: data]
        let status = SecItemUpdate(query() as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var q = query(); q[kSecValueData as String] = data
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
    private static func object(_ value: String) -> [String: Any]? {
        guard let data = value.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
    private static func json(_ object: [String: String]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: object) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    public static func read() -> String {
        locked { guard let vault = readVault() else { return "!secure_storage_unavailable" }; return vault["transaction"] ?? "" }
    }
    public static func write(_ value: String) -> Bool {
        locked {
            guard value.utf8.count <= 16384, let tx = object(value), var vault = readVault() else { return false }
            if object(vault["transaction"] ?? "")?["id"] as? String != tx["id"] as? String { vault.removeValue(forKey: "result") }
            vault["transaction"] = value
            return writeVault(vault)
        }
    }
    public static func clear() -> Bool {
        locked { let status = SecItemDelete(query() as CFDictionary); return status == errSecSuccess || status == errSecItemNotFound }
    }
    public static func takeResult() -> String {
        locked {
            guard var vault = readVault(), let result = vault["result"], !result.isEmpty else { return "" }
            vault.removeValue(forKey: "result")
            return writeVault(vault) ? result : ""
        }
    }
    private static func storeResult(_ id: String, _ kind: String, _ uri: String = "") -> Bool {
        guard var vault = readVault(), let raw = vault["transaction"], let tx = object(raw),
              tx["id"] as? String == id, tx["phase"] as? String == "authorizing",
              ((tx["expiresAt"] as? NSNumber)?.doubleValue ?? 0) > Date().timeIntervalSince1970 * 1000,
              vault["result"] == nil else { return false }
        vault["result"] = json(["requestId": id, "kind": kind, "uri": uri])
        return writeVault(vault)
    }
    /// 同时供 ASWebAuthenticationSession 和冷启动 URL hook 使用，统一去重。
    public static func receive(_ uri: String) -> Bool {
        locked {
            guard uri.utf8.count <= 8192, let parts = URLComponents(string: uri), parts.fragment == nil,
                  "\(parts.scheme ?? "")://\(parts.host ?? "")\(parts.path)" == callback,
                  parts.user == nil, parts.password == nil, parts.port == nil,
                  let raw = readVault()?["transaction"], let tx = object(raw),
                  let id = tx["id"] as? String else { return false }
            let states = (parts.queryItems ?? []).filter { $0.name == "state" }
            guard states.count == 1, states[0].value == tx["state"] as? String else { return false }
            return storeResult(id, "callback", uri)
        }
    }
    public static func open(_ payload: String) -> Bool {
        if !Thread.isMainThread {
            var started = false
            DispatchQueue.main.sync { started = shared.start(payload) }
            return started
        }
        return shared.start(payload)
    }
    private func start(_ payload: String) -> Bool {
        guard let request = Self.object(payload), let id = request["requestId"] as? String,
              let raw = Self.readVault()?["transaction"], let tx = Self.object(raw),
              tx["id"] as? String == id, tx["phase"] as? String == "authorizing",
              request["callbackUrl"] as? String == Self.callback, tx["callbackUrl"] as? String == Self.callback,
              let origin = tx["origin"] as? String, let target = request["authorizeUrl"] as? String,
              target.hasPrefix(origin + "/"), let url = URL(string: target), url.scheme == "https",
              url.user == nil, url.password == nil, url.fragment == nil else { return false }
        let window = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            .filter { $0.activationState == .foregroundActive }.flatMap { $0.windows }.first { $0.isKeyWindow }
        guard let window = window, session == nil else { return false }
        anchor = window; activeId = id
        let auth = ASWebAuthenticationSession(url: url, callbackURLScheme: "com.nuwax.app.auth") { [weak self] callback, error in
            Self.locked {
                if let callback = callback { _ = Self.receive(callback.absoluteString) }
                else {
                    let nsError = error as NSError?
                    let cancelled = nsError?.domain == ASWebAuthenticationSessionError.errorDomain && nsError?.code == ASWebAuthenticationSessionError.canceledLogin.rawValue
                    _ = Self.storeResult(id, cancelled ? "cancelled" : "failed")
                }
            }
            if self?.activeId == id { self?.session = nil; self?.activeId = ""; self?.anchor = nil }
        }
        auth.presentationContextProvider = self
        auth.prefersEphemeralWebBrowserSession = false
        session = auth
        if !auth.start() { session = nil; activeId = ""; anchor = nil; return false }
        return true
    }
    public static func cancel(_ requestId: String) {
        let cancelSession = {
            guard shared.activeId == requestId else { return }
            shared.session?.cancel(); shared.session = nil; shared.activeId = ""; shared.anchor = nil
        }
        if Thread.isMainThread { cancelSession() } else { DispatchQueue.main.async(execute: cancelSession) }
    }
    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { anchor ?? ASPresentationAnchor() }
}
