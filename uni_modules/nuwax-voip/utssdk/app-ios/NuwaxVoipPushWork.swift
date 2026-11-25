import Foundation

/// PushKit may complete as soon as the system report finishes.
/// Network verification has a separately owned, cancellable background lifetime.
@MainActor final class NuwaxVoipPushWork {
    private var task: Task<Void, Never>?
    private var cancelled = false
    private var released = false
    private let finished: @MainActor () -> Void

    init(finished: @escaping @MainActor () -> Void) { self.finished = finished }

    typealias ReportCompletion = @MainActor (Result<Void, Error>) -> Void

    func reportThenValidate(report: @MainActor (@escaping ReportCompletion) -> Void,
                            validate: @escaping @MainActor () async -> Void,
                            completion: @escaping ReportCompletion) {
        report { result in
            switch result {
            case .success where !self.cancelled:
                self.task = Task { @MainActor in
                    guard !self.cancelled else { self.release(); return }
                    await validate()
                    self.release()
                }
            default:
                self.release()
            }
            completion(result)
        }
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
