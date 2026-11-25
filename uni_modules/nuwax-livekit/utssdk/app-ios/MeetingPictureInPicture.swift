import AVFoundation
import AVKit
import CoreMedia
import CoreVideo
import UIKit
import LiveKitClient

/// 系统视频通话画中画，不申请跨应用悬浮层权限，也不移动宫格中现有的 VideoView。
final class MeetingPictureInPicture: NSObject, AVPictureInPictureControllerDelegate {
  static let shared = MeetingPictureInPicture()
  private var controller: AVPictureInPictureController?
  private var content: AVPictureInPictureVideoCallViewController?
  private var video: VideoView?
  private var preview: MeetingPiPPreviewView?
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
  private var leavingForeground = false
  private var lifecycleID = 0
  private var startedDuringTransition = false
  private var startTrigger = "none"
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
      self.leavingForeground = true
      self.logState("didEnterBackground")
      self.observeAutomaticStart()
    }
    foregroundObserver = NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.leavingForeground = false
      self.lifecycleID += 1
      // 只在真正回到前台时收窗，页面轮询不能打断正在进入 PiP 的动画。
      if self.starting || self.controller?.isPictureInPictureActive == true {
        self.stoppingForForeground = true
        self.controller?.stopPictureInPicture()
      }
      self.setPresentation(pageVisible: self.pageVisible, foreground: true)
    }
    orientationObserver = NotificationCenter.default.addObserver(forName: UIDevice.orientationDidChangeNotification, object: nil, queue: .main) { [weak self] _ in
      self?.layoutEdgeHandle()
    }
    guard AVPictureInPictureController.isPictureInPictureSupported() else {
      lastFailure = "unsupported"
      refreshDiagnostics()
      return source
    }
    let content = AVPictureInPictureVideoCallViewController()
    content.preferredContentSize = CGSize(width: 320, height: 180)
    // 未挂到 PiP 窗口前 view 的 bounds 是零，子视图按零尺寸布局会导致内容层不可见。
    content.view.frame = CGRect(x: 0, y: 0, width: 320, height: 180)
    content.view.backgroundColor = UIColor(white: 0.12, alpha: 1)
    // 无远端视频时也必须提供可由系统合成的视频层；UIImageView 不是 PiP 媒体源。
    let preview = MeetingPiPPreviewView(frame: content.view.bounds)
    preview.clipsToBounds = true
    preview.backgroundColor = UIColor(white: 0.12, alpha: 1)
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
    // iOS 的“自动开启画中画”受系统设置影响；退后台时主动请求一次，
    // canStartPictureInPictureAutomaticallyFromInline 继续作为系统兜底。
    snapshotObserver = NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: .main) { [weak self] _ in
      guard let self else { return }
      self.lifecycleID += 1
      self.startedDuringTransition = self.controller?.isPictureInPictureActive == true
      self.lastFailure = ""
      self.leavingForeground = true
      self.capturePreviewSnapshot()
      self.preview?.redisplay()
      self.requestStartForBackground()
      self.logState("willResignActive")
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
        self?.logState("possibleChanged")
      }
    }
    return source
  }

  func setPresentation(pageVisible: Bool, foreground _: Bool) {
    let wasPageVisible = self.pageVisible
    if wasPageVisible && !pageVisible { capturePreviewSnapshot() }
    self.pageVisible = pageVisible
    // 业务 onHide 可能因页面/授权弹窗晚到；是否进入系统 PiP 以 OS 生命周期为准。
    let appState = UIApplication.shared.applicationState
    if source == nil { _ = makeSourceView() }
    guard let source else { return }
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }
    let hostWindow = scene?.windows.first(where: { $0.isKeyWindow })
      ?? UIApplication.shared.windows.first(where: { $0.isKeyWindow && !$0.isHidden })
    if appState == .active && !leavingForeground && !starting,
       controller?.isPictureInPictureActive != true,
       let window = hostWindow, source.window !== window {
      source.removeFromSuperview()
      window.addSubview(source)
    }
    guard let window = source.window else { return }
    if appState == .active && !leavingForeground && !starting && controller?.isPictureInPictureActive != true {
      source.isHidden = pageVisible
      layoutEdgeHandle()
      if !pageVisible { window.bringSubviewToFront(source) }
      // uni-app 页面可能由 presented/navigation 控制器承载；根视图挂在 window
      // 并不代表它可见。离开会议页后，以实际显示的返回会议入口作为来源。
      let anchor = pageVisible ? (visiblePageView(in: window) ?? source) : source
      let anchorChanged = sourceAnchor !== anchor
      updateSourceAnchor(anchor)
      if anchor === source { source.isHidden = false }
      if anchorChanged || !wasPageVisible || previewSnapshot == nil { capturePreviewSnapshot() }
      if preview?.hasFrame != true { preview?.displayPlaceholder() }
    }
    refreshDiagnostics()
  }

  func setCapturePromptVisible(_ visible: Bool) {
    capturePromptVisible = visible
    controller?.canStartPictureInPictureAutomaticallyFromInline = !visible
    logState(visible ? "capturePromptShown" : "capturePromptDismissed")
  }

  private func visiblePageView(in window: UIWindow) -> UIView? {
    var current = window.rootViewController
    while let candidate = current {
      if let presented = candidate.presentedViewController,
         !presented.isBeingDismissed, !(presented is UIAlertController) {
        current = presented
      } else if let navigation = candidate as? UINavigationController, let visible = navigation.visibleViewController {
        current = visible
      } else if let tabs = candidate as? UITabBarController, let selected = tabs.selectedViewController {
        current = selected
      } else {
        break
      }
    }
    guard let view = current?.viewIfLoaded, view.window === window,
          !view.isHidden, view.alpha > 0, !view.bounds.isEmpty else { return nil }
    return view
  }

  private func layoutEdgeHandle() {
    guard let source, let window = source.window else { return }
    let top = window.safeAreaInsets.top + 12
    let available = max(0, window.bounds.height - top - window.safeAreaInsets.bottom - 76)
    source.frame = CGRect(x: max(0, window.bounds.width - 36), y: top + available * edgePosition, width: 36, height: 64)
  }

  /// 只在来源真正变化时重建 contentSource；同一实例反复赋值会让系统丢掉 PiP 能力。
  private func updateSourceAnchor(_ anchor: UIView) {
    guard sourceAnchor !== anchor, let content, let controller else { return }
    controller.contentSource = .init(activeVideoCallSourceView: anchor, contentViewController: content)
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
    let trackChanged = video?.track !== track
    if trackChanged { video?.track = track }
    video?.isHidden = track == nil
    // 保留封面视频层在下方，避免切轨时异步创建的 LiveKit renderer 留出空白。
    if track == nil && (trackChanged || preview?.hasFrame != true) { preview?.redisplay() }
  }

  /// 只截会议页，离开会议后保留最后一帧，不能把聊天/设置页带进系统小窗。
  private func capturePreviewSnapshot() {
    guard pageVisible, !capturePromptVisible, UIApplication.shared.applicationState != .background,
          let anchor = sourceAnchor, anchor !== source, anchor.window != nil,
          !anchor.isHidden, !anchor.bounds.isEmpty else { return }
    let scale = min(1, 640 / max(anchor.bounds.width, anchor.bounds.height))
    let size = CGSize(width: anchor.bounds.width * scale, height: anchor.bounds.height * scale)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let renderer = UIGraphicsImageRenderer(size: size, format: format)
    let image = renderer.image { context in
      context.cgContext.scaleBy(x: scale, y: scale)
      context.cgContext.translateBy(x: -anchor.bounds.minX, y: -anchor.bounds.minY)
      anchor.layer.render(in: context.cgContext)
    }
    guard image.size.width > 0, image.size.height > 0 else { return }
    previewSnapshot = image
    preview?.display(image)
  }

  /// 自动 PiP 只是“允许系统启动”，用户关闭系统自动画中画后不会触发任何 delegate。
  /// 在 willResignActive 的前台退出窗口主动请求，避免进入 background 后再调用被 AVKit 拒绝。
  private func requestStartForBackground() {
    guard !capturePromptVisible, let controller else {
      lastFailure = capturePromptVisible ? "capture_prompt" : "controller_missing"
      return
    }
    if controller.isPictureInPictureActive || starting { return }
    guard controller.isPictureInPicturePossible else {
      lastFailure = "not_possible_at_resign"
      return
    }
    starting = true
    startTrigger = "manual"
    lastFailure = ""
    controller.startPictureInPicture()
    let expectedLifecycle = lifecycleID
    DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self, weak controller] in
      guard let self, let controller, self.controller === controller,
            self.lifecycleID == expectedLifecycle, self.starting,
            !self.startedDuringTransition, !controller.isPictureInPictureActive else { return }
      self.starting = false
      if self.lastFailure.isEmpty { self.lastFailure = "manual_start_timeout" }
      self.logState("manualStartNotObserved")
    }
  }

  /// 观察主动请求和系统自动兜底的最终结果。
  private func observeAutomaticStart() {
    guard let expectedController = controller, !capturePromptVisible else { return }
    let expectedLifecycle = lifecycleID
    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self, weak expectedController] in
      guard let self, let expectedController, self.controller === expectedController,
            self.lifecycleID == expectedLifecycle, UIApplication.shared.applicationState == .background,
            !self.capturePromptVisible, !self.startedDuringTransition,
            !expectedController.isPictureInPictureActive else { return }
      if self.lastFailure.isEmpty {
        self.lastFailure = expectedController.isPictureInPicturePossible ? "auto_start_timeout" : "not_possible"
      }
      self.starting = false
      self.logState("autoStartNotObserved")
    }
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
    leavingForeground = false
    lifecycleID += 1
    startedDuringTransition = false
    startTrigger = "none"
    refreshDiagnostics()
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
    let anchor = controller?.contentSource?.activeVideoCallSourceView
    let value = "pip[build=ios-pip-20261125-p12,possible=\(controller?.isPictureInPicturePossible == true ? 1 : 0),active=\(controller?.isPictureInPictureActive == true ? 1 : 0),starting=\(starting ? 1 : 0),trigger=\(startTrigger),source=\(anchor?.window == nil ? 0 : 1),hidden=\(anchor?.isHidden == true ? 1 : 0),frame=\(preview?.hasFrame == true ? 1 : 0),previewStatus=\(preview?.displayLayer.status.rawValue ?? -1),videoLayer=\(video?.avSampleBufferDisplayLayer == nil ? 0 : 1),app=\(UIApplication.shared.applicationState.rawValue),auto=\(controller?.canStartPictureInPictureAutomaticallyFromInline == true ? 1 : 0),prompt=\(capturePromptVisible ? 1 : 0),err=\(lastFailure)]"
    diagnosticLock.lock()
    diagnosticSnapshot = value
    diagnosticLock.unlock()
  }

  private func logState(_ event: String) {
    refreshDiagnostics()
    let anchor = controller?.contentSource?.activeVideoCallSourceView
    NSLog("[MeetingPiP] %@ %@ anchor=%@ rect=%@ audio=%@", event, diag(),
      anchor.map { String(describing: type(of: $0)) } ?? "nil",
      NSCoder.string(for: anchor.map { $0.convert($0.bounds, to: $0.window) } ?? .zero),
      AVAudioSession.sharedInstance().category.rawValue)
  }

  func pictureInPictureControllerWillStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
    starting = true
    startedDuringTransition = true
    if startTrigger == "none" { startTrigger = "automatic" }
    lastFailure = ""
    logState("willStart")
  }

  func pictureInPictureControllerDidStartPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
    starting = false
    startedDuringTransition = true
    lastFailure = ""
    logState("didStart")
    // 快速切回 App 时，didBecomeActive 可能早于启动动画完成。
    if stoppingForForeground { pictureInPictureController.stopPictureInPicture() }
  }

  func pictureInPictureControllerDidStopPictureInPicture(_ pictureInPictureController: AVPictureInPictureController) {
    starting = false
    startTrigger = "none"
    stoppingForForeground = false
    logState("didStop")
    if UIApplication.shared.applicationState == .active && !leavingForeground {
      setPresentation(pageVisible: pageVisible, foreground: true)
    }
  }

  func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
    failedToStartPictureInPictureWithError error: Error) {
    starting = false
    stoppingForForeground = false
    let failure = error as NSError
    lastFailure = "\(failure.domain):\(failure.code)"
    let underlying = failure.userInfo[NSUnderlyingErrorKey] as? NSError
    NSLog("[MeetingPiP] failed: %@ description=%@ underlying=%@", lastFailure,
      failure.localizedDescription, underlying.map { "\($0.domain):\($0.code) \($0.localizedDescription)" } ?? "none")
    logState("failed")
  }

  func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
    // 原页面可能已返回退栈；交给业务层恢复路由，复用原 Room 而不是重新入会。
    if !stoppingForForeground { restoreRequested = true }
    completionHandler(source?.window != nil)
  }
}

/// 无远端画面时仍保留一个真正的媒体层。只缓存一张低分辨率会议封面，
/// 不启动摄像头、不发布本地轨道，也不依赖后台继续截图。
private final class MeetingPiPPreviewView: UIView {
  override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
  var displayLayer: AVSampleBufferDisplayLayer { layer as! AVSampleBufferDisplayLayer }
  private var pixelBuffer: CVPixelBuffer?
  private(set) var hasFrame = false

  override init(frame: CGRect) {
    super.init(frame: frame)
    displayLayer.videoGravity = .resizeAspect
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    displayLayer.videoGravity = .resizeAspect
  }

  func displayPlaceholder() {
    guard pixelBuffer == nil else { redisplay(); return }
    let size = CGSize(width: 320, height: 180)
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1
    format.opaque = true
    let image = UIGraphicsImageRenderer(size: size, format: format).image { context in
      UIColor(white: 0.12, alpha: 1).setFill()
      context.fill(CGRect(origin: .zero, size: size))
      UIImage(systemName: "person.2.fill")?.withTintColor(.lightGray, renderingMode: .alwaysOriginal)
        .draw(in: CGRect(x: 128, y: 66, width: 64, height: 48))
    }
    display(image)
  }

  func display(_ image: UIImage) {
    guard let cgImage = image.cgImage else { return }
    let attributes = [
      kCVPixelBufferCGImageCompatibilityKey as String: true,
      kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
      kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
    ] as CFDictionary
    var buffer: CVPixelBuffer?
    let result = CVPixelBufferCreate(kCFAllocatorDefault, cgImage.width, cgImage.height,
      kCVPixelFormatType_32BGRA, attributes, &buffer)
    guard result == kCVReturnSuccess, let buffer else {
      NSLog("[MeetingPiP] preview pixel buffer failed status=%d", result)
      return
    }
    do {
      guard CVPixelBufferLockBaseAddress(buffer, []) == kCVReturnSuccess else { return }
      defer { CVPixelBufferUnlockBaseAddress(buffer, []) }
      guard let address = CVPixelBufferGetBaseAddress(buffer),
            let context = CGContext(data: address, width: cgImage.width, height: cgImage.height,
              bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(buffer),
              space: CGColorSpaceCreateDeviceRGB(),
              bitmapInfo: CGBitmapInfo.byteOrder32Little.rawValue | CGImageAlphaInfo.premultipliedFirst.rawValue) else { return }
      context.draw(cgImage, in: CGRect(x: 0, y: 0, width: cgImage.width, height: cgImage.height))
    }
    pixelBuffer = buffer
    redisplay()
  }

  func redisplay() {
    guard let pixelBuffer else { return }
    var description: CMVideoFormatDescription?
    let formatStatus = CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault,
      imageBuffer: pixelBuffer, formatDescriptionOut: &description)
    guard formatStatus == noErr, let description else {
      NSLog("[MeetingPiP] preview format failed status=%d", formatStatus)
      return
    }
    var timing = CMSampleTimingInfo(duration: .invalid,
      presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    let sampleStatus = CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault,
      imageBuffer: pixelBuffer, formatDescription: description, sampleTiming: &timing, sampleBufferOut: &sample)
    guard sampleStatus == noErr, let sample else {
      NSLog("[MeetingPiP] preview sample failed status=%d", sampleStatus)
      return
    }
    guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true),
          CFArrayGetCount(attachments) > 0 else { return }
    let attachment = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
    CFDictionarySetValue(attachment,
      Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(),
      Unmanaged.passUnretained(kCFBooleanTrue).toOpaque())
    if displayLayer.status == .failed {
      NSLog("[MeetingPiP] preview renderer failed: %@", displayLayer.error?.localizedDescription ?? "unknown")
      displayLayer.flush()
      hasFrame = false
    }
    guard displayLayer.isReadyForMoreMediaData else { return }
    displayLayer.enqueue(sample)
    hasFrame = true
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
