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
  private var inlineVideo: VideoView?
  private var inlineLabel: UILabel?
  private var restoreRequested = false
  private var pageVisible = true
  private var foreground = true
  private var possibilityObservation: NSKeyValueObservation?

  func makeSourceView() -> UIView {
    stop()
    let source = UIView(frame: CGRect(x: 0, y: 0, width: 160, height: 100))
    source.backgroundColor = .black
    source.layer.cornerRadius = 12
    source.clipsToBounds = true
    source.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(restoreMeeting)))
    source.addGestureRecognizer(UIPanGestureRecognizer(target: self, action: #selector(dragWindow(_:))))
    self.source = source
    let inlineLabel = UILabel(frame: source.bounds)
    inlineLabel.text = "会议进行中"
    inlineLabel.textColor = .white
    inlineLabel.font = .systemFont(ofSize: 13)
    inlineLabel.textAlignment = .center
    inlineLabel.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    source.addSubview(inlineLabel)
    self.inlineLabel = inlineLabel
    let inlineVideo = VideoView()
    inlineVideo.frame = source.bounds
    inlineVideo.layoutMode = .fit
    inlineVideo.mirrorMode = .off
    inlineVideo.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    inlineVideo.isUserInteractionEnabled = false
    source.addSubview(inlineVideo)
    self.inlineVideo = inlineVideo
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
        guard let self, !self.foreground else { return }
        _ = self.start()
      }
    }
    return source
  }

  func setPresentation(pageVisible: Bool, foreground: Bool) {
    self.pageVisible = pageVisible
    self.foreground = foreground
    if source == nil { _ = makeSourceView() }
    guard let source else { return }
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive || $0.activationState == .foregroundInactive }
    if source.window == nil, let window = scene?.windows.first(where: { $0.isKeyWindow }) {
      window.addSubview(source)
    }
    guard let window = source.window else { return }
    if foreground && pageVisible {
      controller?.stopPictureInPicture()
      // 来源必须是真正可见的视图，不能用 1px 隐藏占位造成 isPictureInPicturePossible=false。
      source.isHidden = true
      updateSourceAnchor(window.rootViewController?.view ?? window)
    } else {
      source.isHidden = false
      source.frame = CGRect(x: max(12, window.bounds.width - 172),
        y: max(window.safeAreaInsets.top + 12, window.bounds.height - window.safeAreaInsets.bottom - 210), width: 160, height: 100)
      source.isUserInteractionEnabled = true
      window.bringSubviewToFront(source)
      updateSourceAnchor(source)
      if !foreground { _ = start() }
    }
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
    source.frame.origin = CGPoint(
      x: min(max(0, source.frame.minX + delta.x), window.bounds.width - source.bounds.width),
      y: min(max(window.safeAreaInsets.top, source.frame.minY + delta.y), window.bounds.height - window.safeAreaInsets.bottom - source.bounds.height))
    recognizer.setTranslation(.zero, in: window)
  }

  func update(_ track: (any VideoTrack)?) {
    if video?.track !== track { video?.track = track }
    video?.isHidden = track == nil
    placeholder?.isHidden = track != nil
    if inlineVideo?.track !== track { inlineVideo?.track = track }
    inlineVideo?.isHidden = track == nil
    inlineLabel?.isHidden = track != nil
  }

  func start() -> Bool {
    guard source?.window != nil, let controller, controller.isPictureInPicturePossible else { return false }
    controller.startPictureInPicture()
    return true
  }

  func stop() {
    possibilityObservation = nil
    controller?.stopPictureInPicture()
    video?.track = nil
    inlineVideo?.track = nil
    inlineVideo = nil
    inlineLabel = nil
    source?.removeFromSuperview()
    restoreRequested = false
    controller = nil
    content = nil
    video = nil
    placeholder = nil
    source = nil
    sourceAnchor = nil
  }

  func pictureInPictureController(_ pictureInPictureController: AVPictureInPictureController,
    restoreUserInterfaceForPictureInPictureStopWithCompletionHandler completionHandler: @escaping (Bool) -> Void) {
    // 原页面可能已返回退栈；交给业务层恢复路由，复用原 Room 而不是重新入会。
    restoreRequested = true
    completionHandler(source?.window != nil)
  }
}
