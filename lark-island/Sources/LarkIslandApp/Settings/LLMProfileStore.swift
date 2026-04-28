// M4 task 4.1: persistent storage for VLM profiles.
//
// Two-tiered persistence:
//  - Non-secret metadata (name, baseURL, model, family, createdAt) →
//    JSON at ~/Library/Application Support/LarkIsland/llm-profiles.json.
//  - Secret apiKey → macOS Keychain via Security.framework, with
//    service = "ai.neolix.lark-island" and account = profile name.
//
// A `KeychainBackend` protocol is injected so unit tests can mock the
// Keychain without prompting the user for login. The default backend
// uses `SecItemAdd` / `SecItemCopyMatching` / `SecItemUpdate` /
// `SecItemDelete` directly — no third-party dependency.

import Foundation
import Observation
#if canImport(Security)
import Security
#endif

// MARK: - Model

struct VLMProfile: Codable, Identifiable, Hashable, Sendable {
    /// User-visible unique name; also doubles as the Keychain account.
    var name: String
    var baseURL: String
    var model: String
    /// Free-form family tag used by the runner to drive model-specific
    /// adapters ("qwen3vl", "doubao15", "claude-opus", etc.).
    var family: String
    var createdAt: Date

    var id: String { name }
}

// MARK: - Keychain backend

protocol KeychainBackend: Sendable {
    func storeAPIKey(_ key: String, for account: String) throws
    func loadAPIKey(for account: String) throws -> String?
    func deleteAPIKey(for account: String) throws
}

enum KeychainError: Error, CustomStringConvertible {
    case osStatus(OSStatus, operation: String)
    case unexpectedData

    var description: String {
        switch self {
        case .osStatus(let status, let op):
            return "Keychain \(op) failed: OSStatus \(status)"
        case .unexpectedData:
            return "Keychain data was not UTF-8 string"
        }
    }
}

#if canImport(Security)
struct SystemKeychainBackend: KeychainBackend {
    static let service = "ai.neolix.lark-island"

    func storeAPIKey(_ key: String, for account: String) throws {
        let data = Data(key.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
        ]
        let attrs: [String: Any] = [
            kSecValueData as String: data,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
        ]

        let status = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add.merge(attrs) { _, new in new }
            let addStatus = SecItemAdd(add as CFDictionary, nil)
            if addStatus != errSecSuccess {
                throw KeychainError.osStatus(addStatus, operation: "add")
            }
        } else if status != errSecSuccess {
            throw KeychainError.osStatus(status, operation: "update")
        }
    }

    func loadAPIKey(for account: String) throws -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecItemNotFound {
            return nil
        }
        if status != errSecSuccess {
            throw KeychainError.osStatus(status, operation: "copy")
        }
        guard let data = result as? Data, let key = String(data: data, encoding: .utf8) else {
            throw KeychainError.unexpectedData
        }
        return key
    }

    func deleteAPIKey(for account: String) throws {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: Self.service,
            kSecAttrAccount as String: account,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status != errSecSuccess && status != errSecItemNotFound {
            throw KeychainError.osStatus(status, operation: "delete")
        }
    }
}
#else
struct SystemKeychainBackend: KeychainBackend {
    func storeAPIKey(_ key: String, for account: String) throws {}
    func loadAPIKey(for account: String) throws -> String? { nil }
    func deleteAPIKey(for account: String) throws {}
}
#endif

/// In-memory backend for tests.
final class InMemoryKeychainBackend: KeychainBackend, @unchecked Sendable {
    private var storage: [String: String] = [:]
    private let lock = NSLock()

    func storeAPIKey(_ key: String, for account: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage[account] = key
    }

    func loadAPIKey(for account: String) throws -> String? {
        lock.lock(); defer { lock.unlock() }
        return storage[account]
    }

    func deleteAPIKey(for account: String) throws {
        lock.lock(); defer { lock.unlock() }
        storage.removeValue(forKey: account)
    }
}

// MARK: - Store

@MainActor
@Observable
final class LLMProfileStore {
    private(set) var profiles: [VLMProfile] = []
    private(set) var defaultProfileName: String?

    /// Last error from disk / keychain operations, surfaced to UI.
    private(set) var lastError: String?

    @ObservationIgnored
    private let storeURL: URL
    @ObservationIgnored
    private let keychain: KeychainBackend

    init(storeURL: URL? = nil, keychain: KeychainBackend = SystemKeychainBackend()) {
        self.storeURL = storeURL ?? Self.defaultStoreURL()
        self.keychain = keychain
        load()
        if profiles.isEmpty {
            seedDefaultProfile()
        }
    }

    // MARK: - Public API

    var defaultProfile: VLMProfile? {
        guard let name = defaultProfileName else {
            return profiles.first
        }
        return profiles.first(where: { $0.name == name }) ?? profiles.first
    }

    func save(_ profile: VLMProfile, apiKey: String?) {
        if let idx = profiles.firstIndex(where: { $0.name == profile.name }) {
            profiles[idx] = profile
        } else {
            profiles.append(profile)
        }
        if defaultProfileName == nil {
            defaultProfileName = profile.name
        }
        if let apiKey, !apiKey.isEmpty {
            do {
                try keychain.storeAPIKey(apiKey, for: profile.name)
            } catch {
                lastError = "Failed to save API key for \(profile.name): \(error)"
            }
        }
        flush()
    }

    func delete(name: String) {
        profiles.removeAll(where: { $0.name == name })
        if defaultProfileName == name {
            defaultProfileName = profiles.first?.name
        }
        do {
            try keychain.deleteAPIKey(for: name)
        } catch {
            lastError = "Failed to delete API key for \(name): \(error)"
        }
        flush()
    }

    func setDefault(_ name: String) {
        guard profiles.contains(where: { $0.name == name }) else { return }
        defaultProfileName = name
        flush()
    }

    func apiKey(for name: String) -> String? {
        do {
            return try keychain.loadAPIKey(for: name)
        } catch {
            lastError = "Failed to load API key for \(name): \(error)"
            return nil
        }
    }

    // MARK: - Persistence

    private struct DiskShape: Codable {
        var profiles: [VLMProfile]
        var defaultProfileName: String?
    }

    private func load() {
        guard FileManager.default.fileExists(atPath: storeURL.path) else { return }
        do {
            let data = try Data(contentsOf: storeURL)
            let decoded = try Self.decoder.decode(DiskShape.self, from: data)
            profiles = decoded.profiles
            defaultProfileName = decoded.defaultProfileName
        } catch {
            lastError = "Failed to load llm-profiles.json: \(error)"
        }
    }

    private func flush() {
        do {
            try FileManager.default.createDirectory(
                at: storeURL.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let payload = DiskShape(profiles: profiles, defaultProfileName: defaultProfileName)
            let data = try Self.encoder.encode(payload)
            try data.write(to: storeURL, options: [.atomic])
        } catch {
            lastError = "Failed to save llm-profiles.json: \(error)"
        }
    }

    private func seedDefaultProfile() {
        let qwen = VLMProfile(
            name: "qwen-default",
            baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
            model: "qwen3-vl-plus",
            family: "qwen3vl",
            createdAt: Date()
        )
        profiles = [qwen]
        defaultProfileName = qwen.name
        flush()
    }

    private static func defaultStoreURL() -> URL {
        let home = FileManager.default.homeDirectoryForCurrentUser
        return home
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("LarkIsland", isDirectory: true)
            .appendingPathComponent("llm-profiles.json", isDirectory: false)
    }

    private static let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.outputFormatting = [.prettyPrinted, .sortedKeys]
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    private static let decoder: JSONDecoder = {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .iso8601
        return d
    }()
}
