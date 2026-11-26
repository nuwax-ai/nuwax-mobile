import AVFoundation
import UIKit

/// Observes system-owned audio. Never activates a session or replaces UniPush's notification delegate.
@MainActor final class NuwaxVoipAudioLifecycle {
    private var observers: [NSObjectProtocol] = []
    init(routeChanged: @escaping @MainActor () -> Void,
         interrupted: @escaping @MainActor (Bool, Bool, UInt?) -> Void,
         mediaReset: @escaping @MainActor () -> Void,
         foreground: @escaping @MainActor () -> Void,
         background: @escaping @MainActor () -> Void) {
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in routeChanged() }
        })
        observers.append(center.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: raw) else { return }
            let options = AVAudioSession.InterruptionOptions(rawValue: note.userInfo?[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0)
            let resume = options.contains(.shouldResume)
            let reason = note.userInfo?[AVAudioSessionInterruptionReasonKey] as? UInt
            Task { @MainActor in interrupted(type == .began, resume, reason) }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in mediaReset() }
        })
        observers.append(center.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in foreground() }
        })
        observers.append(center.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in background() }
        })
    }
    func stop() { for observer in observers { NotificationCenter.default.removeObserver(observer) }; observers = [] }
}
