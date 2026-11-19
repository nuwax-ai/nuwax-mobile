import Foundation
import Security

enum NuwaxVoipSessionStorage {
    static func write(_ data: Data, service: String) -> Bool {
        let query = [kSecClass: kSecClassGenericPassword, kSecAttrService: service] as [CFString: Any]
        let attributes: [CFString: Any] = [kSecValueData: data, kSecAttrAccessible: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        return upsert(update: { SecItemUpdate(query as CFDictionary, attributes as CFDictionary) }, add: {
            var item = query
            for (key, value) in attributes { item[key] = value }
            return SecItemAdd(item as CFDictionary, nil)
        })
    }

    /// Never delete the last usable cold-start context before a replacement succeeds.
    static func upsert(update: () -> OSStatus, add: () -> OSStatus) -> Bool {
        let result = update()
        if result == errSecItemNotFound { return add() == errSecSuccess }
        return result == errSecSuccess
    }
}
