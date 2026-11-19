import Foundation

struct NuwaxVoipCallRecord: Codable, Equatable {
    var callId: String
    var convId: String
    var peerId: String
    var peerName: String
    var direction: String
    var mediaType: String
    var startedAt: Double
    var connectedAt: Double = 0
    var endedAt: Double = 0
    var reason: String = ""
    var missed: Bool {
        direction == "incoming" && connectedAt == 0 && endedAt > 0 && !["rejected", "answeredElsewhere", "incomingDisabled"].contains(reason)
    }
    var payload: [String: Any] {
        ["callId": callId, "convId": convId, "peerId": peerId, "peerName": peerName, "direction": direction,
         "mediaType": mediaType, "startedAt": startedAt, "connectedAt": connectedAt, "endedAt": endedAt,
         "reason": reason, "missed": missed, "durationMs": connectedAt > 0 && endedAt > 0 ? max(0, endedAt - connectedAt) : 0]
    }
    var valid: Bool {
        [callId, convId, peerId].allSatisfy { $0.range(of: "^[A-Za-z0-9_-]{1,128}\\z", options: .regularExpression) != nil }
            && ["incoming", "outgoing"].contains(direction) && ["audio", "video"].contains(mediaType)
            && [startedAt, connectedAt, endedAt].allSatisfy { $0.isFinite && $0 >= 0 }
            && (connectedAt == 0 || connectedAt >= startedAt) && (endedAt == 0 || endedAt >= startedAt)
    }
}

/// Device-local observations only. Never represents server or other-device history.
struct NuwaxVoipCallHistory {
    private(set) var records: [NuwaxVoipCallRecord] = []
    init() {}
    init(data: Data?, recoveringAt now: Double) {
        guard let data, data.count <= 262_144, let decoded = try? JSONDecoder().decode([NuwaxVoipCallRecord].self, from: data) else { return }
        var seen = Set<String>()
        records = Array(decoded.filter { $0.valid }.sorted { $0.startedAt > $1.startedAt }.filter { seen.insert($0.callId).inserted }.prefix(100))
        for index in records.indices {
            records[index].peerName = Self.cleanName(records[index].peerName)
            if records[index].endedAt == 0 { records[index].endedAt = max(now, records[index].startedAt); records[index].reason = "processInterrupted" }
        }
    }
    static func cleanName(_ value: String) -> String {
        let clean = String(String.UnicodeScalarView(value.unicodeScalars.filter { !CharacterSet.controlCharacters.contains($0) }))
        return String(clean.trimmingCharacters(in: .whitespacesAndNewlines).prefix(80))
    }
    mutating func observe(_ record: NuwaxVoipCallRecord) {
        guard record.valid else { return }
        if let index = records.firstIndex(where: { $0.callId == record.callId }) {
            guard records[index].endedAt == 0, records[index].convId == record.convId, records[index].peerId == record.peerId else { return }
            records[index].peerName = Self.cleanName(record.peerName); records[index].mediaType = record.mediaType
            if record.connectedAt > 0 && records[index].connectedAt == 0 { records[index].connectedAt = record.connectedAt }
        } else {
            var safe = record; safe.peerName = Self.cleanName(record.peerName)
            records.insert(safe, at: 0); records = Array(records.prefix(100))
        }
    }
    mutating func end(callID: String, reason: String, now: Double) {
        guard let index = records.firstIndex(where: { $0.callId == callID }), records[index].endedAt == 0 else { return }
        records[index].endedAt = max(now, records[index].startedAt); records[index].reason = reason
    }
    mutating func clear() { records = [] }
    func encode() -> Data? { try? JSONEncoder().encode(records) }
}
