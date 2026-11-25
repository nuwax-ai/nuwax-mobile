import AVFoundation
import AVKit
import UIKit
import LiveKitClient

/// 系统视频通话画中画，不申请跨应用悬浮层权限，也不移动宫格中现有的 VideoView。
final class MeetingPictureInPicture: NSObject, AVPictureInPictureControllerDelegate {
  static let shared = MeetingPictureInPicture()
  private var controller: AVPictureInPictureController?
  private var content: AVPictureInPictureVideoCallViewController?
  private var video: VideoView?
  private var preview: UIImageView?
  private var previewSnapshot: UIImage?
  private var snapshotObserver: NSObjectProtocol?
  private var source: UIView?
  private weak var sourceAnchor: UIView?
  private var edgePosition: CGFloat = 0.68
  private var starting = false
  private var stoppingForForeground = false
  private var capturePromptVisible = false
  private var lastFailure = ""
  private let diagnosticLock = NSLock()
  private var diagnosticSnapshot = "pip[unprepared]"
  private var backgroundObserver: NSObjectProtocol?
  private var foregroundObserver: NSObjectProtocol?
  private var orientationObserver: NSObjectProtocol?
  private var restoreRequested = false
  private var pageVisible = true
  private var foreground = true
  private var possibilityObservation: NSKeyValueObservation?

  func makeSourceView() -> UIView {
    stop()
    let source = MeetingEdgeHandle(frame: CGRect(x: 0, y: 0, width: 36, height: 64))
    source.backgroundColor = .white
    source.layer.borderColor = UIColor(white: 232.0 / 255.0, alpha: 1).cgColor
    source.layer.borderWidth = 1
    source.layer.cornerRadius = 16
    source.layer.maskedCorners = [.layerMinXMinYCorner, .layerMinXMaxYCorner]
    source.clipsToBounds = true
    source.autoresizingMask = [.flexibleLeftMargin, .flexibleTopMargin, .flexibleBottomMargin]
    source.isAccessibilityElement = true
    source.accessibilityLabel = "返回会议"
    source.accessibilityHint = "可上下拖动"
    source.accessibilityTraits = .button
    let tap = UITapGestureRecognizer(target: self, action: #selector(restoreMeeting))
    let pan = UIPanGestureRecognizer(target: self, action: #selector(dragWindow(_:)))
    tap.require(toFail: pan)
    source.addGestureRecognizer(tap)
    source.addGestureRecognizer(pan)
    self.source = source
    backgroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didEnterBackgroundNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      NSLog("[MeetingPiP] didEnterBackground")
      self.foreground = false
      _ = self.start()
      // 系统刚切后台时 contentSource 的可见性可能还没结算，补一次重试。
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
        guard let self, UIApplication.shared.applicationState == .background else { return }
        _ = self.start()
      }
    }
    foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.setPresentation(pageVisible: self.pageVisible, foreground: true)
    }
    orientationObserver = NotificationCenter.default.addObserver(forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
      self?.layoutEdgeHandle()
    }
    guard AVPictureInPictureController.isPictureInPictureSupported() else { return source }
    let content = AVPictureInPictureVideoCallViewController()
    content.preferredContentSize = CGSize(width: 320, height: 180)
    // 未挂到 PiP 窗口前 view 的 bounds 是零，子视图按零尺寸布局会导致内容层不可见。
    content.view.frame = CGRect(x: 0, y: 0, width: 320, height: 180)
    content.view.backgroundColor = UIColor(white: 0.12, alpha: 1)
    // 没有远端视频轨时用退后台前的会议画面快照兜底，不显示黑底文案。
    let preview = UIImageView()
    preview.contentMode = .scaleAspectFill
    preview.clipsToBounds = true
    preview.backgroundColor = UIColor(white: 0.12, alpha: 1)
    preview.frame = content.view.bounds
    preview.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    content.view.addSubview(preview)
    let video = VideoView()
    // PiP 使用 SampleBuffer 渲染，不能依赖进入后台后可能暂停的 Metal 视图。
    video.renderMode = .sampleBuffer
    video.layoutMode = .fit
    video.mirrorMode = .off
    // 没有轨道时先藏起来，否则空白视频层会盖住封面，也让系统看不到有效内容。
    video.isHidden = true
    video.frame = content.view.bounds
    video.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    content.view.addSubview(video)
    // 系统在 App 真正进入后台前就会截走 PiP 内容，必须在失活前把会议画面抓下来。
    snapshotObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.capturePreviewSnapshot()
      self.source?.isHidden = false
      self.foreground = false
      // 必须同步调用：等一次 runloop 后 applicationState 已经变成 .inactive，
      // 那时再调 startPictureInPicture 会被 AVKit 直接拒绝（-1001）。
      _ = self.startForBackground()
    }
    let controller = AVPictureInPictureController(contentSource: .init(
      activeVideoCallSourceView: source, contentViewController: content
    ))
    controller.delegate = self
    controller.canStartPictureInPictureAutomaticallyFromInline = true
    self.content = content
    self.video = video
    self.preview = preview
    self.controller = controller
    sourceAnchor = source
    possibilityObservation = controller.observe(\.isPictureInPicturePossible, options: [.new]) { [weak self] _, _ in
      DispatchQueue.main.async {
        guard let self, !self.foreground, UIApplication.shared.applicationState == .background else { return }
        _ = self.start()
      }
    }
    return source
  }

  func setPresentation(pageVisible: Bool, foreground: Bool) {
    self.pageVisible = pageVisible
    // 业务 onHide 可能因页面/授权弹窗晚到；是否进入系统 PiP 以 OS 生命周期为准。
    let appState = UIApplication.shared.applicationState
    self.foreground = appState != .background
    if source == nil { _ = makeSourceView() }
    guard let source else { return }
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }
    let hostWindow = scene?.windows.first(where: { $0.isKeyWindow })
      ?? UIApplication.shared.windows.first(where: { $0.isKeyWindow && !$0.isHidden })
    if let window = hostWindow, source.window !== window {
      source.removeFromSuperview()
      window.addSubview(source)
    }
    guard let window = source.window else { return }
    if appState == .active {
      starting = false
      if controller?.isPictureInPictureActive == true {
        stoppingForForeground = true
        controller?.stopPictureInPicture()
      }
      source.isHidden = pageVisible
      layoutEdgeHandle()
      if !pageVisible { window.bringSubviewToFront(source) }
      // 来源优先用根视图：系统拿它的布局区域判断视频通话在屏幕上的位置，
      // 36x64 的把手太小。updateSourceAnchor 内部只在变化时重建一次。
      if let root = window.rootViewController?.view, root.window != nil, !root.isHidden {
        updateSourceAnchor(root)
      } else {
        sourceAnchor = source
      }
    } else if appState == .background {
      // 前台时把手按页面可见性隐藏；进后台必须让它重新可见，
      // 否则系统会把 video call 来源判为不可见，PiP 起不来。
      source.isHidden = false
      // willResignActive 偶发没赶上时在这里补一张，保证 PiP 不是黑块。
      if video?.track == nil { capturePreviewSnapshot() }
      _ = start()
    }
  }

  func setCapturePromptVisible(_ visible: Bool) {
    capturePromptVisible = visible
    controller?.canStartPictureInPictureAutomaticallyFromInline = !visible
  }

  private func layoutEdgeHandle() {
    guard let source, let window = source.window else { return }
    let top = window.safeAreaInsets.top + 12
    let available = max(0, window.bounds.height - top - window.safeAreaInsets.bottom - 76)
    source.frame = CGRect(x: max(0, window.bounds.width - 36), y: top + available * edgePosition, width: 36, height: 64)
  }

  /// 只在来源真正变化时重建 contentSource；同一实例反复赋值会让系统丢掉 PiP 能力。
  private func updateSourceAnchor(_ anchor: UIView) {
    guard sourceAnchor !== anchor, let content else { return }
    controller?.contentSource = .init(activeVideoCallSourceView: anchor, contentViewController: content)
    sourceAnchor = anchor
  }

  @objc private func restoreMeeting() { restoreRequested = true }
  func consumeRestoreRequest() -> Bool {
    let requested = restoreRequested
    restoreRequested = false
    return requested
  }
  @objc private func dragWindow(_ recognizer: UIPanGestureRecognizer) {
    guard let source, let window = source.window else { return }
    let delta = recognizer.translation(in: window)
    let top = window.safeAreaInsets.top + 12
    let available = max(1, window.bounds.height - top - window.safeAreaInsets.bottom - 76)
    edgePosition = min(1, max(0, (source.frame.minY + delta.y - top) / available))
    layoutEdgeHandle()
    recognizer.setTranslation(.zero, in: window)
  }

  func update(_ track: (any VideoTrack)?) {
    if video?.track !== track { video?.track = track }
    video?.isHidden = track == nil
    // 没有可订阅的画面时退回静态会议快照；两者都没有才露出深色底。
    preview?.isHidden = track != nil || previewSnapshot == nil
  }

  /// 抓一眼当前窗口画面给 PiP 当封面。会议室里通常没有远端视频，
  /// 靠黑底文案会让后台浮窗看起来像坏了。
  private func capturePreviewSnapshot() {
    guard previewSnapshot == nil || video?.track == nil,
          let window = source?.window ?? UIApplication.shared.windows.first(where: { $0.isKeyWindow }) else { return }
    let renderer = UIGraphicsImageRenderer(bounds: window.bounds)
    let image = renderer.image { context in
      window.layer.render(in: context.cgContext)
    }
    guard image.size.width > 0, image.size.height > 0 else { return }
    previewSnapshot = image
    preview?.image = image
    preview?.isHidden = video?.track != nil
  }

  /// 退后台前的最后一帧前台时机。系统要求 PiP 在前台发起，
  /// 进入 .background 再调会被静默忽略（连失败回调都没有）。
  private func startForBackground() -> Bool {
    // 退后台前只做准备，真正启动交给系统自动 PiP：
    // startPictureInPicture() 在 .inactive/.background 调用会被 AVKit 以 -1001 拒绝。
    guard let source else { return false }
    source.isHidden = false
    let state = UIApplication.shared.applicationState
    let handleIsAnchor = controller?.contentSource?.activeVideoCallSourceView === source
    NSLog("[MeetingPiP] resign state=%d anchorWindow=%d possible=%d handleAnchor=%d hidden=%d audio=%@",
      state.rawValue, sourceAnchor?.window != nil ? 1 : 0,
      controller?.isPictureInPicturePossible == true ? 1 : 0,
      handleIsAnchor ? 1 : 0, source.isHidden ? 1 : 0,
      AVAudioSession.sharedInstance().category.rawValue)
    guard !capturePromptVisible, let controller else {
      NSLog("[MeetingPiP] resign blocked prompt=%d ctrl=%d",
        capturePromptVisible ? 1 : 0, self.controller == nil ? 0 : 1)
      return false
    }
    guard controller.canStartPictureInPictureAutomaticallyFromInline else {
      NSLog("[MeetingPiP] auto PiP disabled")
      return false
    }
    // 仍处于前台活跃时才允许手动补一次；其余交给系统。
    guard state == .active, controller.isPictureInPicturePossible else {
      NSLog("[MeetingPiP] resign skip state=%d possible=%d preview=%d",
        state.rawValue, controller.isPictureInPicturePossible ? 1 : 0,
        previewSnapshot == nil ? 0 : 1)
      return false
    }
    if controller.isPictureInPictureActive || starting { return true }
    starting = true
    controller.startPictureInPicture()
    NSLog("[MeetingPiP] startPictureInPicture requested state=%d preview=%d",
      state.rawValue, previewSnapshot == nil ? 0 : 1)
    // 系统静默拒绝时没有 delegate 回调，超时复位避免 starting 卡死。
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
      guard let self, let controller = self.controller, !controller.isPictureInPictureActive else { return }
      self.starting = false
      NSLog("[MeetingPiP] start timeout possible=%d", controller.isPictureInPicturePossible ? 1 : 0)
    }
    return true
  }

  func start() -> Bool {
    let appState = UIApplication.shared.applicationState
    source?.isHidden = false
    let anchorAlive = sourceAnchor?.window != nil
    NSLog("[MeetingPiP] start state=%d prompt=%d anchor=%d ctrl=%d possible=%d",
      appState.rawValue, capturePromptVisible ? 1 : 0, anchorAlive ? 1 : 0,
      self.controller == nil ? 0 : 1,
      controller?.isPictureInPicturePossible == true ? 1 : 0)
    // 后台/失活状态调用 startPictureInPicture 必被 AVKit 以 -1001 拒绝，
    // 这里只落状态；起 PiP 由 canStartPictureInPictureAutomaticallyFromInline 交给系统。
    guard appState == .active, !capturePromptVisible,
          anchorAlive, let controller else { return false }
    if controller.isPictureInPictureActive || starting { return true }
    guard controller.isPictureInPicturePossible else {
      lastFailure = "not_possible"
      return false
    }
    starting = true
    controller.startPictureInPicture()
    return true
  }

  func stop() {
    for observer in [backgroundObserver, foregroundObserver, orientationObserver, snapshotObserver].compactMap({ $0 }) {
      NotificationCenter.default.removeObserver(observer)
    }
    backgroundObserver = nil
    foregroundObserver = nil
    orientationObserver = nil
    snapshotObserver = nil
    possibilityObservation = nil
    controller?.delegate = nil
    controller?.stopPictureInPicture()
    video?.track = nil
    source?.removeFromSuperview()
    restoreRequested = false
    controller = nil
    content = nil
    video = nil
    preview = nil
    previewSnapshot = nil
    source = nil
    sourceAnchor = nil
    starting = false
    stoppingForForeground = false
    capturePromptVisible = false
    lastFailure = ""
  }

  func diag() -> String {
    // 诊断轮询不能同步等待主线程，避免日志本身卡住会议页面/媒体桥接。
    if Thread.isMainThread { refreshDiagnostics() }
    else { DispatchQueue.main.async { [weak self] in self?.refreshDiagnostics() } }
    diagnosticLock.lock()
    defer { diagnosticLock.unlock() }
    return diagnosticSnapshot
  }

  private func refreshDiagnostics() {
    let value = "pip[possible=\(controller?.isPictureInPicturePossible == true ? 1 : 0),active=\(controller?.isPictureInPictureActive == true ? 1 : 0),source=\(sourceAnchor?.window == nil ? 0 : 1),err=\(lastFailure)]"
    diagnosticLock.lock()
    diagnosticSnapshot = value
    diagnosticLock.unlock()
  }

  func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
    starting = false
    lastFailure = ""
    // 这里不能再回调 setPresentation：前台分支会把刚落地的 PiP 立刻停掉。
    NSLog("[MeetingPiP] didStart")
  }

  func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
    stoppingForForeground = false
  }

  func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
    failedToStartPictureInPictureWithError error: Error) {
    starting = false
    let failure = error as NSError
    lastFailure = "\(failure.domain):\(failure.code)"
    NSLog("[MeetingPiP] failed: %@", lastFailure)
  }

  func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
    // 原页面可能已返回退栈；交给业务层恢复路由，复用原 Room 而不是重新入会。
    if !stoppingForForeground { restoreRequested = true }
    completionHandler(source?.window != nil)
  }
}

/// 与 static/icons/meeting-gray.svg 同形，保持两端的会议入口一致。
private final class MeetingEdgeHandle: UIView {
  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    context.saveGState()
    defer { context.restoreGState() }
    context.translateBy(x: bounds.midX - 11, y: bounds.midY - 11)
    context.scaleBy(x: 22 / 24, y: 22 / 24)
    UIColor(white: 128.0 / 255.0, alpha: 1).setStroke()
    let head = UIBezierPath(ovalIn: CGRect(x: 5, y: 3, width: 8, height: 8))
    head.lineWidth = 1.8
    head.stroke()
    let path = UIBezierPath()
    path.lineWidth = 1.8
    path.lineCapStyle = .round
    path.lineJoinStyle = .round
    path.move(to: CGPoint(x: 16, y: 21))
    path.addLine(to: CGPoint(x: 16, y: 19))
    path.addCurve(to: CGPoint(x: 12, y: 15), controlPoint1: CGPoint(x: 16, y: 16.79), controlPoint2: CGPoint(x: 14.21, y: 15))
    path.addLine(to: CGPoint(x: 6, y: 15))
    path.addCurve(to: CGPoint(x: 2, y: 19), controlPoint1: CGPoint(x: 3.79, y: 15), controlPoint2: CGPoint(x: 2, y: 16.79))
    path.addLine(to: CGPoint(x: 2, y: 21))
    path.move(to: CGPoint(x: 22, y: 21))
    path.addLine(to: CGPoint(x: 22, y: 19))
    path.addCurve(to: CGPoint(x: 19, y: 15.13), controlPoint1: CGPoint(x: 22, y: 17.17), controlPoint2: CGPoint(x: 20.77, y: 15.58))
    path.move(to: CGPoint(x: 16, y: 3.13))
    path.addCurve(to: CGPoint(x: 16, y: 10.87), controlPoint1: CGPoint(x: 20, y: 4.16), controlPoint2: CGPoint(x: 20, y: 9.84))
    path.stroke()
  }
}
