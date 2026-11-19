import Foundation

/// The async PushKit delegate may return as soon as the system report finishes.
/// Network verification has a separately owned, cancellable background lifetime.
@MainActor final class NuwaxVoipPushWork {
    private var task: Task<Void, Never>?
    private var cancelled = false
    private var released = false
    private let finished: @MainActor () -> Void

    init(finished: @escaping @MainActor () -> Void) { self.finished = finished }

    func reportThenValidate(report: @MainActor () async throws -> Void,
                            validate: @escaping @MainActor () async -> Void) async throws {
        do { try await report() }
        catch { release(); throw error }
        guard !cancelled else { release(); return }
        task = Task { @MainActor in
            guard !self.cancelled else { self.release(); return }
            await validate()
            self.release()
        }
        // No await on task: returning completes PushKit, independently of HTTP.
    }

    func cancel() {
        cancelled = true
        task?.cancel()
        release()
    }

    private func release() {
        guard !released else { return }
        released = true; finished()
    }
}
