// Copyright Nuwax. All rights reserved.
//
// KeychainBridge.swift
// nuwax-device-identity (iOS 混编 Swift 文件)
//
// IM deviceId 的 baseId 在 iOS 侧的稳定来源：Keychain（kSecClassGenericPassword）。
// App 卸载只清沙盒与 storage，Keychain 条目保留，重装后 SecItemCopyMatching
// 仍能读回同一值——这是「卸载重装 deviceId 不变」的关键（storage 方案做不到）。
// 只有「抹掉所有内容与设置」才会清 Keychain（此时等同新设备，符合预期）。
//
// 混编约定（同 nuwax-esp-provisioning / nuwax-ios-file-picker）：本文件的
// public 类对同目录 index.uts 直接可见（无需 import）；桥接方法无参，规避
// UTS↔Swift 参数标签映射问题。Security 为系统框架，config.json 无需 pod。

import Security

public class KeychainBridge {
    /// Keychain 条目归属域。与 App 其他 Keychain 用途（如有）隔离。
    private static let service = "com.nuwax.im.device"
    /// 条目账号名。固定值：一个 App 装机只存一个 baseId。
    private static let account = "im-device-base-id"

    /// 读 Keychain 里的 baseId；没有则生成 UUID 写入后返回。
    ///
    /// 调用方（servers/im.uts getImDeviceId）会把返回值落 storage——Keychain
    /// 读取只在 storage 为空（新装/重装）时发生一次，不在热路径上。
    /// UUID().uuidString 为 36 位含 '-' 的大写 hex，满足服务端
    /// ImProtocol.isValidDeviceId 字符白名单（a-zA-Z0-9 与 - _ .）。
    public static func getOrCreateBaseId() -> String {
        if let existing = readBaseId() {
            return existing
        }
        let newId = UUID().uuidString
        if addBaseId(newId) {
            return newId
        }
        // add 失败多半是 errSecDuplicateItem（并发/残留条目）：改走 update 后重读。
        if updateBaseId(newId), let reread = readBaseId() {
            return reread
        }
        // Keychain 完全不可写（受控设备等极端场景）：返回内存值，调用方落 storage
        // 后本机仍稳定；不抛异常（本函数被设计为绝不失败）。
        return newId
    }

    // MARK: - SecItem 三件套

    private static func baseQuery() -> [String: Any] {
        return [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }

    private static func readBaseId() -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &out)
        guard status == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func addBaseId(_ value: String) -> Bool {
        var add = baseQuery()
        add[kSecValueData as String] = Data(value.utf8)
        // ThisDeviceOnly：不随 iCloud 钥匙串同步到用户其他设备（那是别的"设备"）；
        // AfterFirstUnlock：App 冷启动即可读，不受设备锁定时机影响。
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        return SecItemAdd(add as CFDictionary, nil) == errSecSuccess
    }

    private static func updateBaseId(_ value: String) -> Bool {
        let update: [String: Any] = [kSecValueData as String: Data(value.utf8)]
        return SecItemUpdate(baseQuery() as CFDictionary, update as CFDictionary) == errSecSuccess
    }
}
