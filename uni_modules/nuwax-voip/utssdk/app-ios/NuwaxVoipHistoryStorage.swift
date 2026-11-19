import Foundation
import Security

/// Separate encrypted namespaces retain a user's own local history across login.
struct NuwaxVoipHistoryStorage {
    private let service = "com.nuwax.voip.call-history"
    private let account: String
    init(origin: String, userID: String) {
        account = ((try? JSONSerialization.data(withJSONObject: [origin, userID])) ?? Data()).base64EncodedString()
    }
    private var query: [CFString: Any] { [kSecClass: kSecClassGenericPassword, kSecAttrService: service, kSecAttrAccount: account] }
    func read() -> Data? {
        var q = query; q[kSecReturnData] = true; q[kSecMatchLimit] = kSecMatchLimitOne
        var value: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &value) == errSecSuccess else { return nil }
        return value as? Data
    }
    @discardableResult func write(_ data: Data) -> Bool {
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData: data] as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else { return false }
        var q = query; q[kSecValueData] = data; q[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(q as CFDictionary, nil) == errSecSuccess
    }
}
