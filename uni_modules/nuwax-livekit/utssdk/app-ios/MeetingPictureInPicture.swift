import AVKit
import UIKit
import LiveKitClient

/// 系统视频通话画中画，不申请跨应用悬浮层权限，也不移动宫格中现有的 VideoView。
final class MeetingPictureInPicture: NSObject, AVPictureInPictureControllerDelegate {
  static let shared = MeetingPictureInPicture()
  private var controller: AVPictureInPictureController?
  private var content: AVPictureInPictureVideoCallViewController?
  private var video: VideoView?
  private var placeholder: UILabel?
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
    source.backgroundColor = UIColor(white: 0.11, alpha: 0.96)
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
      self.foreground = false
      _ = self.start()
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
    content.view.backgroundColor = .black
    let label = UILabel()
    label.text = "会议进行中"
    label.textColor = .white
    label.textAlignment = .center
    label.frame = content.view.bounds
    label.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    content.view.addSubview(label)
    let video = VideoView()
    // PiP 使用 SampleBuffer 渲染，不能依赖进入后台后可能暂停的 Metal 视图。
    video.renderMode = .sampleBuffer
    video.layoutMode = .fit
    video.mirrorMode = .off
    video.frame = content.view.bounds
    video.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    content.view.addSubview(video)
    let controller = AVPictureInPictureController(contentSource: .init(
      activeVideoCallSourceView: source, contentViewController: content
    ))
    controller.delegate = self
    controller.canStartPictureInPictureAutomaticallyFromInline = true
    self.content = content
    self.video = video
    self.placeholder = label
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
    if source.window == nil, let window = hostWindow {
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
      // 在前台准备稳定、可见的来源。不能在 Home / onHide 时换来源，
      // 否则系统正在检查 PiP 能力时又重新初始化 contentSource，自动启动会失效。
      updateSourceAnchor(window.rootViewController?.view ?? window)
    } else if appState == .background {
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
    placeholder?.isHidden = track != nil
  }

  func start() -> Bool {
    guard UIApplication.shared.applicationState == .background, !capturePromptVisible,
          sourceAnchor?.window != nil, let controller else { return false }
    if controller.isPictureInPictureActive || starting { return true }
    guard controller.isPictureInPicturePossible else {
      if lastFailure != "not_possible" { NSLog("[MeetingPiP] not possible yet; %@", diag()) }
      lastFailure = "not_possible"
      return false
    }
    starting = true
    controller.startPictureInPicture()
    return true
  }

  func stop() {
    for observer in [backgroundObserver, foregroundObserver, orientationObserver].compactMap({ $0 }) {
      NotificationCenter.default.removeObserver(observer)
    }
    backgroundObserver = nil
    foregroundObserver = nil
    orientationObserver = nil
    possibilityObservation = nil
    controller?.delegate = nil
    controller?.stopPictureInPicture()
    video?.track = nil
    source?.removeFromSuperview()
    restoreRequested = false
    controller = nil
    content = nil
    video = nil
    placeholder = nil
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
    if UIApplication.shared.applicationState == .active {
      setPresentation(pageVisible: pageVisible, foreground: true)
    }
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

/// 与 static/icons/meeting-white.svg 同形，保持两端的会议入口一致。
private final class MeetingEdgeHandle: UIView {
  override func draw(_ rect: CGRect) {
    guard let context = UIGraphicsGetCurrentContext() else { return }
    context.saveGState()
    defer { context.restoreGState() }
    context.translateBy(x: bounds.midX - 11, y: bounds.midY - 11)
    context.scaleBy(x: 22 / 24, y: 22 / 24)
    UIColor.white.setStroke()
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
