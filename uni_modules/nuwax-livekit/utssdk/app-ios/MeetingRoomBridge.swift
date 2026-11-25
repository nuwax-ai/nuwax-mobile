import AVFoundation
import Foundation
import UIKit
// CocoaPods 的 pod 名是 LiveKitClient，Swift 模块名随之也是 LiveKitClient
// （`import LiveKit` 是 SPM 的模块名，云打包实测解析不到）
import LiveKitClient
import ReplayKit
import Combine

/**
 * 会议房间桥（iOS，LiveKit Swift SDK 2.19.x）。
 *
 * <h2>与 Android 同名同序</h2>
 * <p>UTS 侧（`index.uts`）只做转发，业务层（`utils/meeting/meetingMedia.uts`）两端一致。</p>
 *
 * <h2>★Swift SDK 的真实 API（文档容易写错的地方，按实测/源码修正）</h2>
 * <ul>
 *   <li>开关设备：`localParticipant.setMicrophone(enabled:)` / `setCamera(enabled:)`
 *       —— **不是** `setMicrophoneEnabled`（那是 JS SDK）。</li>
 *   <li>`VideoView` 的镜像属性叫 `mirrorMode`（`.auto/.off/.mirror`）；
 *       填充策略叫 `layoutMode`（`.fit/.fill`），**不是** `mirror`。</li>
 *   <li>UTS 的 `number` 在 Swift 侧是 `NSNumber`：回调用 `NSNumber`、返回值也返回 `NSNumber`。</li>
 *   <li>`RoomDelegate` 只用于可靠 DataChannel 会中聊天/弹幕；连接结果仍以
 *       `connect` 是否抛错 + 轮询人数为准，避免把连接状态回调跨到 UTS。</li>
 * </ul>
 *
 * <h2>当前限制</h2>
 * <p>切前后摄像头（`CameraCapturer`/`LocalVideoTrack` 的入口名待核实）、远端画面订阅、
 * 音量（`audioLevel`）—— 这三项目前返回"无操作/0"，不影响入会与互相看见。
 * 整屏共享使用 ReplayKit Broadcast Upload Extension；扩展源码在 native/ios-broadcast，
 * 签名与云打包配置见 docs/engineering/meeting-whole-screen-sharing.md。</p>
 */
public class MeetingRoomBridge: NSObject {
  /// 与页面诊断配套；只有重新制作原生基座才会更新。
  private static let probeBuild = "ios-meeting-20261125-p13"
  private static var broadcastConfigurationText = "unchecked"
  /// iOS → Android 共享流参数。写入 diag，方便仅凭真机日志确认新基座是否生效。
  private static let screenSharePublishProfile = "bounded720p30-3Mbps-single-h264"

  private static var room: Room?
  private static var audioSessionRequirement: SessionRequirementHandle?
  private static var micChangePending = false
  private static var videoView: VideoView?
  /// 连接状态由业务层轮询（UTS 回调类型跨到 Swift 会变成 UTSCallback，编译不过）
  private static var connectedFlag = false
  private static var connectionGeneration = 0
  private static var lastErrorText = ""
  /// 设备层失败原因（`mic_denied` / `camera_denied` / `set_device`；空串=无错）。
  /// ★与 `lastErrorText` 分开：那个只表达「连不上」，设备失败不该让页面以为入会失败。
  private static var deviceErrorText = ""
  /// 远端成员 identity → 当前渲染视图（重新挂载 native-view 时替换）
  private static var remoteViews: [String: VideoView] = [:]
  /// 远端成员 identity → 当前轨道对象标识；防止轮询时重复赋同一 track 导致画面抖动。
  private static var remoteTrackIDs: [String: ObjectIdentifier] = [:]
  /// 防止每次 3 秒轮询都对同一条尚未订阅的 publication 重复发订阅请求。
  private static var pendingVideoSubscriptions: Set<ObjectIdentifier> = []
  private static let pendingVideoSubscriptionsLock = NSLock()
  private static var meetingMessages: [[String: Any]] = []
  private static let meetingMessagesLock = NSLock()
  private static var screenShareTrack: LocalVideoTrack?
  // SDK 的 processor 是弱引用；共享期间必须由桥接层持有。
  private static var screenShareProcessor: MeetingScreenShareProcessor?
  private static var screenShareErrorText = ""
  private static var screenShareRequestID = 0
  private static var broadcastPending = false
  private static var usingBroadcastExtension = false
  private static weak var shareScopeAlert: UIAlertController?
  private static var broadcastObserver: AnyCancellable?
  private static var broadcastTimeout: DispatchWorkItem?
  private static let screenShareLock = NSLock()
  private static var dataDelegate: MeetingDataDelegate?

  private final class MeetingDataDelegate: NSObject, RoomDelegate, @unchecked Sendable {
    func room(_ current: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) {
      MeetingRoomBridge.updatePictureInPicture()
    }

    func room(_ current: Room, participant: RemoteParticipant, didUnsubscribeTrack publication: RemoteTrackPublication) {
      MeetingRoomBridge.updatePictureInPicture()
    }
    func room(_ current: Room, didUpdateMetadata metadata: String?) {
      MeetingRoomBridge.onMain {
        guard MeetingRoomBridge.room === current,
              let data = metadata?.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let holder = object["shareHolder"] as? String,
              holder != current.localParticipant.identity?.stringValue else { return }
        if MeetingRoomBridge.broadcastPending || MeetingRoomBridge.screenShareTrack != nil {
          MeetingRoomBridge.stopScreenShare()
          MeetingRoomBridge.screenShareErrorText = "taken_over"
        }
      }
    }

    func room(_ current: Room, didDisconnectWithError error: LiveKitError?) {
      MeetingRoomBridge.onMain {
        guard MeetingRoomBridge.room === current else { return }
        MeetingRoomBridge.connectedFlag = false
        MeetingRoomBridge.releaseAudioSession()
        MeetingRoomBridge.stopScreenShare()
        MeetingPictureInPicture.shared.stop()
      }
    }
    func room(
      _ room: Room,
      participant: RemoteParticipant?,
      didReceiveData data: Data,
      forTopic topic: String,
      encryptionType: EncryptionType
    ) {
      guard topic == "meeting-chat" || topic == "danmaku" else { return }
      MeetingRoomBridge.receiveMeetingData(data, topic: topic, participant: participant)
    }
  }

  // MARK: - 线程

  /// 异步收敛到主线程（设备开关、断连这类不需要返回值/顺序的调用）。
  /// <p>调用线程不固定；已有真机诊断出现 main=1。LiveKit 的 VideoView 是 UIView，
  /// track 的 didSet 会 add/remove 渲染子视图；这些 UI 操作必须在主线程执行。
  /// 需要拿返回值的「创建视图」用 `makeOnMain`，不能走这里（异步会丢顺序）。</p>
  private static func onMain(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
    } else {
      DispatchQueue.main.async(execute: block)
    }
  }

  /// 原生侧日志：HX 控制台 / 系统 Console 都能看到（真机排查设备开关失败用）。
  private static func bridgeLog(_ message: String) {
    NSLog("[MeetingBridge] \(message)")
  }

  /// 把「创建 UIView」搬到主线程，并等它建好再返回。
  ///
  /// <p>调用方若不在主线程，就把 UIKit 视图创建调度到主线程。页面最后一条
  /// createVideoView 日志不足以判定崩溃发生在 VideoView 构造、原生桥接还是绑定阶段。</p>
  ///
  /// <p>★为什么不用 `DispatchQueue.main.sync`：万一主线程此刻正在同步等 JS 线程
  /// （事件派发的实现细节），`main.sync` 会互相等成死锁（表现为卡死后被系统杀掉）；
  /// 这里改成异步投递 + 超时，最坏结果是拿不到视图（页面保留头像占位），不会卡死。</p>
  private static func makeOnMain(_ block: @escaping () -> UIView?) -> UIView? {
    if Thread.isMainThread {
      return block()
    }
    let semaphore = DispatchSemaphore(value: 0)
    var made: UIView?
    DispatchQueue.main.async {
      made = block()
      semaphore.signal()
    }
    if semaphore.wait(timeout: .now() + 2) == .timedOut {
      bridgeLog("makeOnMain timeout: main thread busy")
      return nil
    }
    return made
  }

  /// 同上，只是没有返回值（销毁视图、挂轨道这类，不需要等结果但要求主线程执行）。
  private static func doOnMainSync(_ block: @escaping () -> Void) {
    if Thread.isMainThread {
      block()
      return
    }
    let semaphore = DispatchSemaphore(value: 0)
    DispatchQueue.main.async {
      block()
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 2)
  }

  // MARK: - 能力

  public static func isSupported() -> Bool {
    bridgeLog("probe=\(probeBuild) isSupported main=\(Thread.isMainThread ? 1 : 0)")
    return true
  }

  // MARK: - 连接 / 断开

  /// 连接已有房间（不建房）。入会即按口径开麦/开摄像头（默认都关）。
  /// ★不接回调：连接结果由业务层轮询 `isConnected()` / `lastError()`。
  public static func connect(
    _ serverUrl: String,
    _ token: String,
    _ micOn: Bool,
    _ cameraOn: Bool
  ) {
    connectedFlag = false
    lastErrorText = ""
    deviceErrorText = ""
    onMain {
      connectionGeneration += 1
      micChangePending = false
      let generation = connectionGeneration
      // 上一场没断干净时先收尾（业务层一般会先 disconnect，这里兜底防两个 Room 抢音频会话）
      if let stale = room {
        room = nil
        Task { await stale.disconnect() }
      }
      bridgeLog("connect start host=\(URL(string: serverUrl)?.host ?? "?") mic=\(micOn) cam=\(cameraOn)")
      Task { @MainActor in
        guard generation == connectionGeneration else { return }
        do {
          try activateAudioSession()
          bridgeLog("audio session active cat=\(AVAudioSession.sharedInstance().category.rawValue)")
          let delegate = MeetingDataDelegate()
          dataDelegate = delegate
          let created = Room(delegate: delegate)
          room = created
          try await created.connect(url: serverUrl, token: token)
          guard generation == connectionGeneration, room === created else {
            await created.disconnect()
            return
          }
          // ★先置 connected：设备开关可能弹权限框停留十几秒，不能让它把「入会成功」拖成超时
          connectedFlag = true
          bridgeLog("connect ok people=\(debugSnapshot())")
          if micOn {
            if await LiveKitSDK.ensureDeviceAccess(for: [.audio]) {
              do { try await created.localParticipant.setMicrophone(enabled: true) }
              catch { deviceErrorText = "set_device"; bridgeLog("join setMicrophone failed: \(error)") }
            } else {
              deviceErrorText = "mic_denied"
              bridgeLog("join microphone permission denied")
            }
          }
          if cameraOn {
            if await LiveKitSDK.ensureDeviceAccess(for: [.video]) {
              do { try await created.localParticipant.setCamera(enabled: true) }
              catch { deviceErrorText = "set_device"; bridgeLog("join setCamera failed: \(error)") }
              attachLocalVideo()
            } else {
              deviceErrorText = "camera_denied"
              bridgeLog("join camera permission denied")
            }
          }
        } catch {
          guard generation == connectionGeneration else { return }
          connectedFlag = false
          releaseAudioSession()
          lastErrorText = "connect"
          bridgeLog("connect failed: \(error)")
        }
      }
    }
  }

  /// 最近一次连接失败原因（空串=无错）。
  public static func lastError() -> String {
    return lastErrorText
  }

  /// 设备层失败原因（空串=无错）：`mic_denied` / `camera_denied` / `set_device`。
  public static func deviceError() -> String {
    return deviceErrorText
  }

  /// 排查用短串（业务层经既有导出 `sdkVersion()` 取回，避免给插件加新导出）：
  /// main = **调用线程是否主线程**（0/1 均可能）、view / cam / connected。
  public static func diag() -> String {
    let main = Thread.isMainThread ? 1 : 0
    let view = videoView != nil ? 1 : 0
    let cam = (room?.localParticipant.firstCameraVideoTrack != nil) ? 1 : 0
    let conn = connectedFlag ? 1 : 0
    let pip = MeetingPictureInPicture.shared.diag()
    // 原生基座版本标记：页面据此避开旧基座的 UIView 返回值桥接路径。
    return "bridge=ios-native-view-v2 probe=\(probeBuild) main=\(main) view=\(view) cam=\(cam) conn=\(conn) remotes=\(remoteViews.count) remotePub=\(remoteVideoPublicationDiag()) broadcastCfg=\(broadcastConfigurationText) shareCfg=\(screenSharePublishProfile) \(localScreenShareDiag()) \(pip) dev=\(deviceErrorText)"
  }

  /// 配置值不能代表实际编码结果；输出 SDK 统计中的真实尺寸、帧率、编码器和限速原因。
  private static func localScreenShareDiag() -> String {
    screenShareLock.lock()
    let track = screenShareTrack
    let processor = screenShareProcessor
    screenShareLock.unlock()
    guard let track else { return "shareTx=off" }
    let capture = processor?.diag() ?? "unavailable"
    guard let stats = track.statistics, let tx = stats.outboundRtpStream.first else {
      return "shareCapture[\(capture)] shareTx=waiting-stats"
    }
    let codec = stats.codec.first(where: { $0.id == tx.codecId })?.mimeType ?? "unknown"
    let width = tx.frameWidth.map { String($0) } ?? "na"
    let height = tx.frameHeight.map { String($0) } ?? "na"
    let fps = tx.framesPerSecond.map { String(format: "%.1f", $0) } ?? "na"
    let frames = tx.framesEncoded.map { String($0) } ?? "na"
    let bytes = tx.bytesSent.map { String($0) } ?? "na"
    let limit = tx.qualityLimitationReason?.rawValue ?? "unknown"
    let encoder = tx.encoderImplementation ?? "unknown"
    return "shareCapture[\(capture)] shareTx[codec=\(codec),size=\(width)x\(height),fps=\(fps),frames=\(frames),bytes=\(bytes),limit=\(limit),encoder=\(encoder)]"
  }

  /// 一行式诊断快照（页面每 3 秒打一次，闪退时看最后一行就知道卡在哪一步）。
  /// <p>字段：`conn` 已连接 / `room` Room 是否存在 / `view` 本机渲染视图是否创建 /
  /// `cam` 摄像头轨道是否已发布 / `speak` 是否在说话 / `people` 房间人数 /
  /// `remoteViews` 远端渲染视图数 / `authVideo|authAudio` 系统授权状态
  /// （0 未决定 / 1 受限 / 2 已拒绝 / 3 已授权）/ `cat` 音频会话 category / `err` 设备层错误。</p>
  public static func debugSnapshot() -> String {
    let authVideo = AVCaptureDevice.authorizationStatus(for: .video).rawValue
    let authAudio = AVCaptureDevice.authorizationStatus(for: .audio).rawValue
    let viewOn = videoView != nil ? 1 : 0
    let camTrack = (room?.localParticipant.firstCameraVideoTrack != nil) ? 1 : 0
    let speaking = (room?.localParticipant.isSpeaking == true) ? 1 : 0
    let people = room.map { $0.remoteParticipants.count + 1 } ?? 0
    let category = AVAudioSession.sharedInstance().category.rawValue
    let conn = connectedFlag ? 1 : 0
    let hasRoom = room != nil ? 1 : 0
    return "conn=\(conn) room=\(hasRoom) view=\(viewOn) cam=\(camTrack) speak=\(speaking) people=\(people) remoteViews=\(remoteViews.count) authVideo=\(authVideo) authAudio=\(authAudio) cat=\(category) err=\(deviceErrorText)"
  }

  /// 离开：只断本端，不删房。
  public static func disconnect() {
    bridgeLog("disconnect \(debugSnapshot())")
    screenShareLock.lock()
    screenShareRequestID += 1
    screenShareLock.unlock()
    onMain {
      connectionGeneration += 1
      releaseVideoView()
      releaseRemoteVideoViews()
      stopScreenShareInternal(room: room)
      MeetingPictureInPicture.shared.stop()
      MeetingShareLease.shared.clear()
      meetingMessagesLock.lock()
      meetingMessages.removeAll()
      meetingMessagesLock.unlock()
      // Room.disconnect() 在 Swift SDK 里是 async：必须放进 Task 里跑
      if let current = room {
        Task { await current.disconnect() }
      }
      room = nil
      connectedFlag = false
      lastErrorText = ""
      deviceErrorText = ""
      micChangePending = false
      releaseAudioSession()
    }
  }

  // MARK: - 会中聊天 / 弹幕

  private static func receiveMeetingData(_ data: Data, topic: String, participant: RemoteParticipant?) {
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let text = object["text"] as? String else { return }
    let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !cleanText.isEmpty else { return }
    let item: [String: Any] = [
      "text": String(cleanText.prefix(120)),
      "name": (object["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? participant?.name ?? "参会人",
      "identity": participant?.identity?.stringValue ?? "",
      "self": false,
      "topic": topic,
      "at": Int64(Date().timeIntervalSince1970 * 1000),
    ]
    meetingMessagesLock.lock()
    defer { meetingMessagesLock.unlock() }
    meetingMessages.append(item)
    if meetingMessages.count > 100 { meetingMessages.removeFirst(meetingMessages.count - 100) }
  }

  public static func sendMeetingMessage(_ text: String, _ displayName: String, _ danmaku: Bool) {
    guard connectedFlag, let current = room else { return }
    let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !cleanText.isEmpty, cleanText.count <= 120 else { return }
    let topic = danmaku ? "danmaku" : "meeting-chat"
    let payloadObject: [String: String] = ["text": cleanText, "name": displayName]
    guard let payload = try? JSONSerialization.data(withJSONObject: payloadObject) else { return }
    Task { @MainActor in
      do {
        try await current.localParticipant.publish(
          data: payload,
          options: DataPublishOptions(topic: topic, reliable: true)
        )
        let item: [String: Any] = [
          "text": cleanText,
          "name": displayName,
          "identity": current.localParticipant.identity?.stringValue ?? "",
          "self": true,
          "topic": topic,
          "at": Int64(Date().timeIntervalSince1970 * 1000),
        ]
        meetingMessagesLock.lock()
        defer { meetingMessagesLock.unlock() }
        meetingMessages.append(item)
        if meetingMessages.count > 100 { meetingMessages.removeFirst(meetingMessages.count - 100) }
      } catch {
        bridgeLog("meeting message publish failed: \(error)")
      }
    }
  }

  public static func drainMeetingMessages() -> String {
    meetingMessagesLock.lock()
    defer { meetingMessagesLock.unlock() }
    var result = "[]"
    if let data = try? JSONSerialization.data(withJSONObject: meetingMessages),
       let json = String(data: data, encoding: .utf8) {
      result = json
      meetingMessages.removeAll()
    }
    return result
  }

  // MARK: - ReplayKit 跨 App 广播

  public static func configureBackgroundSession(_ releaseURL: String, _ token: String) {
    onMain { MeetingShareLease.shared.configure(releaseURL, token: token) }
  }

  public static func setMeetingPresentation(_ pageVisible: Bool, _ foreground: Bool) {
    onMain {
      guard connectedFlag else { return }
      MeetingPictureInPicture.shared.setPresentation(pageVisible: pageVisible, foreground: foreground)
      updatePictureInPicture()
    }
  }

  public static func consumeMeetingRestoreRequest() -> Bool {
    var restore = false
    doOnMainSync { restore = MeetingPictureInPicture.shared.consumeRestoreRequest() }
    return restore
  }

  private static func updatePictureInPicture() {
    onMain {
      guard let current = room else { return }
      let participants = current.remoteParticipants.values.filter {
        !($0.identity?.stringValue ?? "").hasPrefix("EG_")
      }
      let sharer = participants.first { participant in
        participant.trackPublications.values.contains { $0.source == .screenShareVideo && !$0.isMuted }
      }
      let track = sharer.flatMap { firstVideoTrack($0) } ?? participants.compactMap { firstVideoTrack($0) }.first
      MeetingPictureInPicture.shared.update(track)
    }
  }

  public static func requestScreenShare() {
    onMain {
      guard connectedFlag, room != nil else {
        screenShareErrorText = "not_connected"
        return
      }
      if broadcastPending || screenShareTrack != nil { return }
      screenShareLock.lock()
      screenShareRequestID += 1
      let requestID = screenShareRequestID
      screenShareLock.unlock()
      MeetingShareLease.shared.acquired()
      guard let extensionID = Bundle.main.object(forInfoDictionaryKey: "RTCScreenSharingExtension") as? String, !extensionID.isEmpty,
            let groupID = Bundle.main.object(forInfoDictionaryKey: "RTCAppGroupIdentifier") as? String, !groupID.isEmpty else {
        broadcastConfigurationText = "missing_plist_keys"
        bridgeLog("broadcast unavailable: missing_plist_keys")
        offerInAppScreenShare()
        return
      }
      let extensions = Bundle.main.builtInPlugInsURL.flatMap {
        try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil)
      } ?? []
      let hasExtension = extensions.contains(where: { Bundle(url: $0)?.bundleIdentifier == extensionID })
      let hasGroup = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: groupID) != nil
      guard hasExtension && hasGroup else {
        broadcastConfigurationText = !hasExtension ? "missing_extension" : "missing_app_group"
        bridgeLog("broadcast unavailable: \(broadcastConfigurationText)")
        offerInAppScreenShare()
        return
      }
      broadcastConfigurationText = "ready"
      screenShareErrorText = ""
      usingBroadcastExtension = true
      broadcastPending = true
      MeetingPictureInPicture.shared.setCapturePromptVisible(true)
      // SDK 自动发布会跳过本项目的缩放/编码策略，因此由桥接层按真实广播状态发布。
      BroadcastManager.shared.shouldPublishTrack = false
      if broadcastObserver == nil {
        broadcastObserver = BroadcastManager.shared.isBroadcastingPublisher
          .removeDuplicates().dropFirst().receive(on: DispatchQueue.main)
          .sink { started in
            if started {
              guard usingBroadcastExtension, broadcastPending, connectedFlag else {
                BroadcastManager.shared.requestStop()
                return
              }
              publishScreenTrack(useBroadcastExtension: true)
            } else if usingBroadcastExtension && (broadcastPending || screenShareTrack != nil) {
              stopScreenShare()
              screenShareErrorText = "stopped"
            }
          }
      }
      // 系统 picker 没有取消回调；原生超时收回占位，晚到的广播事件也不能误发布。
      let timeout = DispatchWorkItem {
        if requestID == screenShareRequestID && broadcastPending {
          stopScreenShare()
          screenShareErrorText = "cancelled"
        }
      }
      broadcastTimeout = timeout
      DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: timeout)
      BroadcastManager.shared.requestActivation()
    }
  }

  /// 未嵌入扩展的云基座仍可使用原来的应用内录屏；先说明范围，不能冒充整屏共享。
  private static func offerInAppScreenShare(attempt: Int = 0) {
    let requestID = screenShareRequestID
    broadcastPending = true
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
      .first { $0.activationState == .foregroundActive }
    // HX 宿主可能仍使用 AppDelegate 窗口，不能只查 UIScene 而丢失授权提示。
    let window = scene?.windows.first(where: { $0.isKeyWindow })
      ?? UIApplication.shared.windows.first(where: { $0.isKeyWindow && !$0.isHidden })
    var presenter = window?.rootViewController
    while let next = presenter?.presentedViewController { presenter = next }
    guard UIApplication.shared.applicationState == .active, let presenter,
          !presenter.isBeingDismissed, presenter.viewIfLoaded?.window != nil else {
      if attempt < 3 {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
          guard requestID == screenShareRequestID, broadcastPending, connectedFlag else { return }
          offerInAppScreenShare(attempt: attempt + 1)
        }
        return
      }
      broadcastPending = false
      screenShareErrorText = "share_ui_unavailable"
      MeetingShareLease.shared.release()
      return
    }
    broadcastPending = true
    usingBroadcastExtension = false
    MeetingPictureInPicture.shared.setCapturePromptVisible(true)
    screenShareErrorText = ""
    let alert = UIAlertController(title: "共享当前应用", message: "当前安装包暂不支持共享整个手机屏幕。可继续共享本应用中的画面；切换到桌面或其他应用后，对方看不到这些内容。", preferredStyle: .alert)
    alert.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in
      guard requestID == screenShareRequestID else { return }
      stopScreenShare()
      screenShareErrorText = "cancelled"
    })
    alert.addAction(UIAlertAction(title: "共享本应用", style: .default) { _ in
      guard requestID == screenShareRequestID, broadcastPending, connectedFlag else { return }
      shareScopeAlert = nil
      publishScreenTrack(useBroadcastExtension: false)
    })
    shareScopeAlert = alert
    presenter.present(alert, animated: true)
    let timeout = DispatchWorkItem {
      guard requestID == screenShareRequestID, broadcastPending, !usingBroadcastExtension else { return }
      stopScreenShare()
      screenShareErrorText = "cancelled"
    }
    broadcastTimeout = timeout
    DispatchQueue.main.asyncAfter(deadline: .now() + 60, execute: timeout)
  }

  private static func publishScreenTrack(useBroadcastExtension: Bool) {
    screenShareLock.lock()
    let requestID = screenShareRequestID
    screenShareLock.unlock()
    onMain {
      guard connectedFlag, let current = room else {
        stopScreenShare()
        screenShareErrorText = "not_connected"
        return
      }
      screenShareLock.lock()
      let alreadySharing = screenShareTrack != nil
      screenShareLock.unlock()
      if alreadySharing { return }
      screenShareErrorText = ""
    Task { @MainActor in
      var candidate: LocalVideoTrack?
      do {
        // InAppScreenCapturer 的 options 不执行缩放；实际尺寸由下方 processor 限制。
        // 30fps/3Mbps 是上限，实际发送帧率由 shareTx 统计核对，不能以配置值当作实测值。
        let options = ScreenShareCaptureOptions(
          dimensions: .h720_169,
          fps: 30,
          showCursor: false,
          appAudio: false,
          useBroadcastExtension: useBroadcastExtension,
          useScreenCaptureKit: false,
          includeCurrentApplication: true
        )
        let track: LocalVideoTrack
        if useBroadcastExtension {
          track = await LocalVideoTrack.createBroadcastScreenCapturerTrack(options: options, reportStatistics: true)
        } else {
          track = await LocalVideoTrack.createInAppScreenShareTrack(options: options, reportStatistics: true)
        }
        candidate = track
        let processor = MeetingScreenShareProcessor()
        track.processor = processor
        screenShareLock.lock()
        let requestStillActive = requestID == screenShareRequestID
        screenShareLock.unlock()
        guard requestStillActive, connectedFlag, room === current else {
          _ = try? await track.capturer.stopCapture()
          return
        }
        // 与 PC 端保持单层共享策略；显式优先 H.264，让 iOS/Android 使用各自支持的
        // H.264 编解码路径。实际协商的 codec/encoder 由统计输出，不假定一定启用硬编。
        let publishOptions = VideoPublishOptions(
          screenShareEncoding: VideoEncoding(
            maxBitrate: 3_000_000,
            maxFps: 30,
            bitratePriority: .high,
            networkPriority: nil
          ),
          simulcast: false,
          screenShareSimulcastLayers: [],
          preferredCodec: .h264,
          degradationPreference: .maintainFramerate
        )
        let publication = try await current.localParticipant.publish(
          videoTrack: track,
          options: publishOptions
        )
        screenShareLock.lock()
        let publishStillActive = requestID == screenShareRequestID
        screenShareLock.unlock()
        guard publishStillActive, connectedFlag, room === current else {
          try? await current.localParticipant.unpublish(publication: publication)
          _ = try? await track.capturer.stopCapture()
          return
        }
        screenShareLock.lock()
        screenShareTrack = track
        screenShareProcessor = processor
        screenShareLock.unlock()
        broadcastPending = false
        MeetingPictureInPicture.shared.setCapturePromptVisible(false)
        broadcastTimeout?.cancel()
        screenShareErrorText = ""
        bridgeLog("screen share published mode=\(useBroadcastExtension ? "broadcast" : "in-app") profile=\(screenSharePublishProfile)")
      } catch {
        if let candidate { _ = try? await candidate.capturer.stopCapture() }
        screenShareLock.lock()
        let requestStillActive = requestID == screenShareRequestID
        screenShareLock.unlock()
        guard requestStillActive else { return }
        broadcastPending = false
        broadcastTimeout?.cancel()
        MeetingPictureInPicture.shared.setCapturePromptVisible(false)
        if useBroadcastExtension { BroadcastManager.shared.requestStop() }
        usingBroadcastExtension = false
        MeetingShareLease.shared.release()
        screenShareLock.lock()
        screenShareTrack = nil
        screenShareProcessor = nil
        screenShareLock.unlock()
        screenShareErrorText = error.localizedDescription
        bridgeLog("screen share failed: \(error)")
      }
    }
    }
  }

  private static func stopScreenShareInternal(room current: Room?) {
    broadcastPending = false
    MeetingPictureInPicture.shared.setCapturePromptVisible(false)
    broadcastTimeout?.cancel()
    broadcastTimeout = nil
    shareScopeAlert?.dismiss(animated: false)
    shareScopeAlert = nil
    if usingBroadcastExtension { BroadcastManager.shared.requestStop() }
    usingBroadcastExtension = false
    MeetingShareLease.shared.release()
    screenShareLock.lock()
    let track = screenShareTrack
    let processor = screenShareProcessor
    screenShareTrack = nil
    screenShareProcessor = nil
    screenShareLock.unlock()
    guard let track = track else { return }
    let publication = current?.localParticipant.trackPublications.values.first {
      $0.track === track
    } as? LocalTrackPublication
    Task { @MainActor in
      // SDK 弱持有 processor；直到停止采集才释放，收尾过程中仍保持相同的帧处理。
      defer { withExtendedLifetime(processor) {} }
      do {
        if let current = current, let publication = publication {
          try await current.localParticipant.unpublish(publication: publication)
        }
      } catch {
        bridgeLog("broadcast screen share unpublish failed: \(error)")
      }
      // 取消发布失败也必须停止 ReplayKit，避免录屏继续占用系统资源。
      do { _ = try await track.capturer.stopCapture() }
      catch { bridgeLog("broadcast screen share stop failed: \(error)") }
    }
  }

  public static func stopScreenShare() {
    screenShareLock.lock()
    screenShareRequestID += 1
    screenShareLock.unlock()
    onMain {
      stopScreenShareInternal(room: room)
    }
  }

  public static func isScreenShareOn() -> Bool {
    screenShareLock.lock()
    defer { screenShareLock.unlock() }
    return screenShareTrack != nil && (usingBroadcastExtension ? BroadcastManager.shared.isBroadcasting : RPScreenRecorder.shared().isRecording)
  }

  public static func isScreenShareStopping() -> Bool { MeetingShareLease.shared.isReleasing }

  public static func screenShareError() -> String {
    screenShareLock.lock()
    defer { screenShareLock.unlock() }
    return screenShareErrorText
  }

  // MARK: - 设备

  public static func setMicEnabled(_ enabled: Bool) {
    bridgeLog("setMicrophone -> \(enabled)")
    onMain {
      Task { @MainActor in
        guard connectedFlag, !micChangePending, let room = room else {
          bridgeLog("setMicrophone skipped: meeting unavailable or microphone change pending")
          return
        }
        micChangePending = true
        defer { if Self.room === room { micChangePending = false } }
        if enabled {
          // ★开采集前显式申请授权：没授权就根本不要进 SDK 的采集路径
          let allowed = await LiveKitSDK.ensureDeviceAccess(for: [.audio])
          guard connectedFlag, Self.room === room else { return }
          guard allowed else {
            deviceErrorText = "mic_denied"
            bridgeLog("setMicrophone skipped: microphone permission denied")
            return
          }
        }
        bridgeLog("setMicrophone -> sdk")
        do {
          try await room.localParticipant.setMicrophone(enabled: enabled)
          guard Self.room === room else { return }
          deviceErrorText = ""
          bridgeLog("setMicrophone ok \(debugSnapshot())")
        } catch {
          guard Self.room === room else { return }
          deviceErrorText = "set_device"
          bridgeLog("setMicrophone(\(enabled)) failed: \(error)")
        }
      }
    }
  }

  public static func setCameraEnabled(_ enabled: Bool) {
    bridgeLog("camera enter enabled=\(enabled) main=\(Thread.isMainThread ? 1 : 0)")
    onMain {
      Task { @MainActor in
        bridgeLog("camera task begin enabled=\(enabled) \(debugSnapshot())")
        guard let room = room else {
          bridgeLog("setCamera skipped: no room")
          return
        }
        if enabled {
          bridgeLog("camera permission begin status=\(AVCaptureDevice.authorizationStatus(for: .video).rawValue)")
          let allowed = await LiveKitSDK.ensureDeviceAccess(for: [.video])
          bridgeLog("camera permission end allowed=\(allowed) status=\(AVCaptureDevice.authorizationStatus(for: .video).rawValue)")
          guard allowed else {
            deviceErrorText = "camera_denied"
            bridgeLog("setCamera skipped: camera permission denied")
            return
          }
        }
        bridgeLog("camera sdk begin enabled=\(enabled)")
        do {
          try await room.localParticipant.setCamera(enabled: enabled)
          deviceErrorText = ""
          bridgeLog("camera sdk end enabled=\(enabled) \(debugSnapshot())")
        } catch {
          deviceErrorText = "set_device"
          bridgeLog("setCamera(\(enabled)) failed: \(error)")
        }
        if enabled {
          bridgeLog("camera attach begin")
          attachLocalVideo()
          bridgeLog("camera attach end")
        }
      }
    }
  }

  public static func isMicEnabled() -> Bool {
    return room?.localParticipant.isMicrophoneEnabled() == true
  }

  public static func isSpeakerEnabled() -> Bool {
    return AVAudioSession.sharedInstance().currentRoute.outputs.contains { $0.portType == .builtInSpeaker }
  }

  /// Speaker preference controls the session category as well as the immediate route.
  public static func setSpeakerEnabled(_ enabled: Bool) {
    onMain {
      guard connectedFlag else { return }
      AudioManager.shared.isSpeakerOutputPreferred = enabled
      do {
        try AVAudioSession.sharedInstance().overrideOutputAudioPort(enabled ? .speaker : .none)
        bridgeLog("setSpeaker requested=\(enabled) actual=\(isSpeakerEnabled())")
      } catch {
        bridgeLog("overrideOutputAudioPort(\(enabled)) failed: \(error)")
      }
    }
  }

  /// 切前后摄像头：Swift SDK 的入口在采集器 `CameraCapturer.switchCameraPosition()` 上
  /// （`LocalVideoTrack` 只有 `capturer: VideoCapturer`，需要强转）。
  public static func switchCamera() {
    onMain {
      Task { @MainActor in
        // firstCameraVideoTrack 返回的是 `any VideoTrack`，`capturer` 在 LocalVideoTrack 上，需先强转
        guard let room = room,
              let track = room.localParticipant.firstCameraVideoTrack as? LocalVideoTrack,
              let capturer = track.capturer as? CameraCapturer else { return }
        do {
          _ = try await capturer.switchCameraPosition()
        } catch {
          bridgeLog("switchCameraPosition failed: \(error)")
        }
      }
    }
  }

  /// 本机发音状态 → 0/1（Swift 侧没有 `audioLevel`，只有 `isSpeaking`；
  /// 页面音波按 0/1 两档也能画，效果是"说话时跳、停下归零"）。
  public static func localAudioLevel() -> NSNumber {
    guard let room = room else { return 0 }
    return room.localParticipant.isSpeaking ? 1 : 0
  }

  public static func participantCount() -> NSNumber {
    guard let room = room else { return 0 }
    // 云端录制 Egress 也是参与者（identity 前缀 EG_），不算人；与 PC 口径一致。
    let people = room.remoteParticipants.values.filter {
      !($0.identity?.stringValue ?? "").hasPrefix("EG_")
    }.count
    return NSNumber(value: people + 1)
  }

  /// 房间 metadata：服务端写入后由 LiveKit 同步，本端页面轮询读取。
  public static func roomMetadata() -> String {
    return room?.metadata ?? ""
  }

  /// 举手状态走 participant attributes，与 PC / Android 使用同一个 handRaised 键。
  public static func setHandRaised(_ raised: Bool) {
    onMain {
      Task { @MainActor in
        guard let room = room else { return }
        try? await room.localParticipant.set(
          attributes: ["handRaised": raised ? "1" : ""]
        )
      }
    }
  }

  public static func localHandRaised() -> Bool {
    return (room?.localParticipant.attributes["handRaised"] ?? "") != ""
  }

  public static func isConnected() -> Bool {
    return connectedFlag
  }

  // MARK: - 视频渲染

  /// 创建渲染视图（`VideoView` 是 UIView，交给页面 `<native-view>` 用 bindIOSView 绑定）。
  /// UIKit 视图统一在主线程创建；调用线程由诊断记录，不作预设。
  public static func createVideoView() -> UIView? {
    let callerMain = Thread.isMainThread
    let view = makeOnMain { makeLocalView() }
    bridgeLog("createVideoView callerMain=\(callerMain ? 1 : 0) ok=\(view != nil ? 1 : 0)")
    return view
  }

  /// 主线程专用：销毁旧的本机渲染视图并新建一个。
  private static func makeLocalView() -> UIView? {
    bridgeLog("makeLocalView: release old")
    videoView?.track = nil
    videoView = nil
    bridgeLog("makeLocalView: VideoView init begin")
    let view = VideoView()
    bridgeLog("makeLocalView: VideoView init end")
    // .auto：前置自动镜像、后置不镜像；.fill：裁切铺满（与 Android 的 SCALE_ASPECT_FILL 一致）
    view.mirrorMode = .auto
    view.layoutMode = .fill
    videoView = view
    bridgeLog("makeLocalView: configured")
    return view
  }

  public static func attachLocalVideo() {
    doOnMainSync {
      guard let room = room else {
        bridgeLog("attachLocalVideo skipped: no room")
        return
      }
      guard let view = videoView else {
        bridgeLog("attachLocalVideo skipped: no view")
        return
      }
      let track = room.localParticipant.firstCameraVideoTrack
      bridgeLog("attachLocalVideo track=\(track != nil ? 1 : 0)")
      view.track = track
      bridgeLog("attachLocalVideo track assigned")
    }
  }

  public static func releaseVideoView() {
    doOnMainSync {
      bridgeLog("releaseVideoView")
      videoView?.track = nil
      videoView = nil
    }
  }

  // MARK: - 远端视频

  /// 有未静音视频 publication 的远端成员 identity（逗号分隔；与 Android 同口径）。
  public static func remoteVideoIdentities() -> String {
    guard let room = room else { return "" }
    var ids: [String] = []
    for (_, participant) in room.remoteParticipants {
      if (participant.identity?.stringValue ?? "").hasPrefix("EG_") { continue }
      ensureVideoSubscriptions(participant)
      if hasVideoPublication(participant) {
        // Swift 的 identity 是 `Participant.Identity?`（不是 String），取 stringValue
        ids.append(participant.identity?.stringValue ?? "")
      }
    }
    syncRemoteVideoViews(room)
    updatePictureInPicture()
    return ids.joined(separator: ",")
  }

  /// 为某个远端成员创建渲染视图（页面每格一个 native-view）。
  /// ★同上：创建搬回主线程。
  public static func createRemoteVideoView(_ identity: String) -> UIView? {
    let callerMain = Thread.isMainThread
    let view = makeOnMain { makeRemoteView(identity) }
    bridgeLog("createRemoteVideoView \(identity) callerMain=\(callerMain ? 1 : 0) ok=\(view != nil ? 1 : 0)")
    return view
  }

  /// 主线程专用：每次 native-view init 都新建视图，防止把同一个 UIView
  /// 重复绑定到已经卸载或正在卸载的页面元素。
  private static func makeRemoteView(_ identity: String) -> UIView? {
    guard let room = room else {
      return nil
    }
    var target: RemoteParticipant?
    for (_, participant) in room.remoteParticipants {
      if (participant.identity?.stringValue ?? "") == identity {
        target = participant
      }
    }
    guard let participant = target, hasVideoPublication(participant) else {
      return nil
    }
    remoteViews[identity]?.track = nil
    let view = VideoView()
    view.mirrorMode = .off
    view.layoutMode = hasActiveScreenShare(participant) ? .fit : .fill
    if let track = firstVideoTrack(participant) {
      view.track = track
      remoteTrackIDs[identity] = ObjectIdentifier(track)
    } else {
      remoteTrackIDs.removeValue(forKey: identity)
    }
    remoteViews[identity] = view
    return view
  }

  /// 释放所有远端渲染视图（离开会议时调用）。
  public static func releaseRemoteVideoViews() {
    doOnMainSync {
      for (_, view) in remoteViews {
        view.track = nil
      }
      remoteViews.removeAll()
      remoteTrackIDs.removeAll()
      pendingVideoSubscriptionsLock.lock()
      pendingVideoSubscriptions.removeAll()
      pendingVideoSubscriptionsLock.unlock()
    }
  }

  /** publication 先于已订阅 track 到达；有发布就先把 native-view 挂上。 */
  private static func hasVideoPublication(_ participant: RemoteParticipant) -> Bool {
    for (_, publication) in participant.trackPublications {
      if publication.isMuted { continue }
      if publication.source == .camera || publication.source == .screenShareVideo {
        return true
      }
    }
    return false
  }

  /** 自动订阅异常时显式订阅视频轨，尤其用于排查 Android 屏幕共享 publication 已到但 track 为空。 */
  private static func ensureVideoSubscriptions(_ participant: RemoteParticipant) {
    for (_, publication) in participant.trackPublications {
      if publication.isMuted { continue }
      if publication.source != .camera && publication.source != .screenShareVideo { continue }
      guard let remote = publication as? RemoteTrackPublication, !remote.isSubscribed else { continue }
      guard let key = beginVideoSubscription(remote) else { continue }
      Task {
        defer {
          finishVideoSubscription(key)
        }
        do {
          try await remote.set(subscribed: true)
          bridgeLog("requested remote video subscription source=\(remote.source)")
        } catch {
          bridgeLog("remote video subscribe failed source=\(remote.source) error=\(error)")
        }
      }
    }
  }

  /**
   * Swift 6 禁止在 async Task 的函数体中直接调用 NSLock.lock/unlock。
   * 锁操作放入同步辅助方法，既保持去重，也避免原生插件因此编译失败。
   */
  private static func beginVideoSubscription(_ publication: RemoteTrackPublication) -> ObjectIdentifier? {
    let key = ObjectIdentifier(publication)
    pendingVideoSubscriptionsLock.lock()
    defer { pendingVideoSubscriptionsLock.unlock() }
    if pendingVideoSubscriptions.contains(key) {
      return nil
    }
    pendingVideoSubscriptions.insert(key)
    return key
  }

  private static func finishVideoSubscription(_ key: ObjectIdentifier) {
    pendingVideoSubscriptionsLock.lock()
    pendingVideoSubscriptions.remove(key)
    pendingVideoSubscriptionsLock.unlock()
  }

  /** 压缩进 sdkVersion 诊断：identity:source/muted/subscribed/track。 */
  private static func remoteVideoPublicationDiag() -> String {
    guard let room = room else { return "none" }
    var parts: [String] = []
    for (_, participant) in room.remoteParticipants {
      let identity = participant.identity?.stringValue ?? "?"
      for (_, publication) in participant.trackPublications {
        if publication.source != .camera && publication.source != .screenShareVideo { continue }
        let remote = publication as? RemoteTrackPublication
        let subscribed = remote?.isSubscribed == true ? 1 : 0
        let track = publication.track != nil ? 1 : 0
        let muted = publication.isMuted ? 1 : 0
        parts.append("\(identity):\(publication.source)/m\(muted)/s\(subscribed)/t\(track)")
      }
    }
    return parts.isEmpty ? "empty" : parts.joined(separator: ";")
  }

  private static func hasActiveScreenShare(_ participant: RemoteParticipant) -> Bool {
    for (_, publication) in participant.trackPublications {
      if !publication.isMuted && publication.source == .screenShareVideo {
        return true
      }
    }
    return false
  }

  /** 已有视图在轨道晚到、摄像头切共享或共享切摄像头时，幂等补绑最新轨道。 */
  private static func syncRemoteVideoViews(_ current: Room) {
    onMain {
      for (identity, view) in remoteViews {
        let participant = current.remoteParticipants.values.first {
          ($0.identity?.stringValue ?? "") == identity
        }
        guard let participant = participant else {
          view.track = nil
          remoteTrackIDs.removeValue(forKey: identity)
          continue
        }
        ensureVideoSubscriptions(participant)
        view.layoutMode = hasActiveScreenShare(participant) ? .fit : .fill
        guard let track = firstVideoTrack(participant) else {
          view.track = nil
          remoteTrackIDs.removeValue(forKey: identity)
          continue
        }
        let nextID = ObjectIdentifier(track)
        if remoteTrackIDs[identity] == nextID { continue }
        view.track = track
        remoteTrackIDs[identity] = nextID
      }
    }
  }

  /// 取该远端可展示的视频轨道：**优先屏幕共享**，没有才用摄像头。
  /// ★只过滤 `.camera` 会让「别人共享的屏幕」在 iOS 上永远不显示；
  ///   而遍历字典顺序不固定，对方同时又开了摄像头时，随机拿到摄像头轨就会出现
  ///   「明明在共享，我却只看到他的脸」。所以这里显式优先 screenShareVideo。
  /// ★LiveKitClient 2.19 的枚举名是 screenShareVideo（不是 screenShare），写错直接编译失败。
  private static func firstVideoTrack(_ participant: RemoteParticipant) -> VideoTrack? {
    var cameraTrack: VideoTrack?
    for (_, publication) in participant.trackPublications {
      if publication.isMuted { continue }
      guard let video = publication.track as? VideoTrack else { continue }
      if publication.source == .screenShareVideo {
        return video
      }
      if publication.source == .camera && cameraTrack == nil {
        cameraTrack = video
      }
    }
    return cameraTrack
  }

  // MARK: - 音频会话

  private static func activateAudioSession() throws {
    releaseAudioSession()
    let audio = AudioManager.shared
    audio.isSpeakerOutputPreferred = true
    // Keep both routes available even while the room's microphone track is muted.
    audioSessionRequirement = try audio.audioSession.acquire(requirement: .playbackAndRecording)
  }

  private static func releaseAudioSession() {
    let requirement = audioSessionRequirement
    audioSessionRequirement = nil
    try? requirement?.release()
  }
}
