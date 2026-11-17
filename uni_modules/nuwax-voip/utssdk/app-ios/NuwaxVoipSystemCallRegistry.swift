import Foundation

/// Tracks system registration independently of the business snapshot, which is
/// already cleared when an asynchronous system action completes.
struct NuwaxVoipSystemCallRegistry {
    private(set) var generation = 0
    private var registered = Set<UUID>()
    private var reported = Set<UUID>()
    private var ended = Set<UUID>()
    private var endedOrder: [UUID] = []

    mutating func beginRegistration(_ uuid: UUID) -> Int? {
        guard !ended.contains(uuid), registered.insert(uuid).inserted else { return nil }
        return generation
    }

    /// Every PushKit callback must attempt a system report, even when the
    /// online route already registered this UUID or the call is terminal.
    mutating func beginIncomingReport(_ uuid: UUID, requiredByPushKit: Bool) -> Int? {
        if requiredByPushKit {
            if !ended.contains(uuid) { registered.insert(uuid) }
            return generation
        }
        return beginRegistration(uuid)
    }

    func registrationIsCurrent(_ uuid: UUID, generation: Int) -> Bool {
        self.generation == generation && registered.contains(uuid) && !ended.contains(uuid)
    }

    mutating func registrationFailed(_ uuid: UUID, generation: Int) {
        guard self.generation == generation else { return }
        registered.remove(uuid)
    }

    /// A late successful report still needs closure after an earlier local end.
    mutating func registrationReported(_ uuid: UUID, generation: Int) {
        guard self.generation == generation else { return }
        reported.insert(uuid)
    }

    func isReported(_ uuid: UUID) -> Bool { reported.contains(uuid) }
    mutating func systemEnded(_ uuid: UUID) { reported.remove(uuid) }

    mutating func markEnded(_ uuid: UUID) {
        registered.remove(uuid)
        if ended.insert(uuid).inserted {
            endedOrder.append(uuid)
            if endedOrder.count > 128 { ended.remove(endedOrder.removeFirst()) }
        }
    }

    func hasEnded(_ uuid: UUID) -> Bool { ended.contains(uuid) }

    mutating func reset() {
        generation += 1
        registered.removeAll(); reported.removeAll(); ended.removeAll(); endedOrder.removeAll()
    }
}
