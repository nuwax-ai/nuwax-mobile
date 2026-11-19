#if DEBUG
import Foundation
import CallKit

/// Debug-only observation. It never creates a provider or controls a call.
@MainActor final class NuwaxVoipSystemDiagnostics: NSObject, @preconcurrency CXCallObserverDelegate {
    private let observer = CXCallObserver()
    private let ownedUUIDs: () -> Set<UUID>

    init(ownedUUIDs: @escaping () -> Set<UUID>) {
        self.ownedUUIDs = ownedUUIDs
        super.init()
        observer.setDelegate(self, queue: .main)
        report()
        Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            self?.report()
        }
    }

    func report() {
        let known = ownedUUIDs()
        let active = observer.calls.filter { !$0.hasEnded }
        let owned = active.filter { known.contains($0.uuid) }
        NSLog("[NuwaxVoipSystemObserver] active=%ld owned=%ld knownUUIDs=%ld", active.count, owned.count, known.count)
        for call in owned {
            NSLog("[NuwaxVoipSystemObserver] owned connected=%d outgoing=%d onHold=%d", call.hasConnected, call.isOutgoing, call.isOnHold)
        }
    }

    func callObserver(_ callObserver: CXCallObserver, callChanged call: CXCall) { report() }
}
#endif
