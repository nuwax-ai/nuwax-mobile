package com.nuwax.livekit

import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.media.AudioManager
import android.app.Activity
import org.json.JSONObject
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.renderer.SurfaceViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.DataPublishReliability
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * 会议房间桥接（Kotlin 侧，LiveKit Android SDK 2.28.x）。
 *
 * <h2>为什么要单独一个 Kotlin 类</h2>
 * <p>LiveKit 的连接/开关设备都是 <b>suspend</b> 方法，UTS 不能直接 await Kotlin 协程；
 * 所以挪到 Kotlin 里用 [CoroutineScope] 发起，UTS 只做薄封装（`index.uts`）。
 * SDK 的真实 API 只出现在本文件，升级 SDK 时改动面最小。</p>
 *
 * <h2>★为什么现在不用 room.events 事件流</h2>
 * <p>`room.events` 是 `Flow<RoomEvent>`，但在这套 SDK + 协程版本下，`collect { }` 会命中
 * 无参重载 `Flow<*>.collect()`、显式 `FlowCollector` 又报 unresolved（云打包里两轮实测）。
 * 会中 UI 目前只需要「已连上 + 当前人数」，所以先：</p>
 * <ul>
 *   <li>连接结果用 `connect()` 是否抛出判定；</li>
 *   <li>人数用 3 秒轮询 [participantCount] 兜底；</li>
 *   <li>事件订阅（成员进出、重连、断开）留到下一轮——届时要单独验证 `room.events` 的
 *       收集写法，不能影响出包。</li>
 * </ul>
 *
 * <h2>★线程与生命周期</h2>
 * <ul>
 *   <li>所有 SDK 调用跑在主线程 scope（LiveKit 内部自己切线程）。</li>
 *   <li>模块级单例由 UTS 持有；[disconnect] 会取消 scope 并丢弃 Room，重复调用安全。</li>
 *   <li>**绝不**在未连接时回调 connected=true —— 上层据此显示"已在会中"。</li>
 * </ul>
 */
class MeetingRoomBridge(context: Context) {
  private val appContext: Context = context.applicationContext
  private var scope: CoroutineScope? = null
  private var room: Room? = null
  private var connectedFlag = false
  /** 最近一次连接失败原因（空串=无错）。业务层轮询它代替回调。 */
  private var lastErrorText = ""
  /** 视频渲染器（本轮只做本机摄像头预览；远端画面等事件订阅那一批一起做）。 */
  private var renderer: SurfaceViewRenderer? = null
  /** 当前摄像头位置（默认前置），切摄像头时翻转。 */
  private var cameraPosition: CameraPosition = CameraPosition.FRONT
  /** 远端成员 identity → 渲染视图（同一人复用，离开会议统一释放）。 */
  private val remoteRenderers = HashMap<String, SurfaceViewRenderer>()
  /** 远端成员 identity → 当前已挂载轨道；切摄像头/共享时用于先卸旧轨，避免重复 renderer。 */
  private val remoteTracks = HashMap<String, VideoTrack>()
  private val meetingMessages = ConcurrentLinkedQueue<String>()
  @Volatile private var screenShareOn = false
  private val shareLease = MeetingShareLease()
  private var shareRequestID = 0
  @Volatile private var sharePending = false
  private var pipTrack: VideoTrack? = null
  private var pipRenderer: SurfaceViewRenderer? = null
  private val floatingWindow = MeetingFloatingWindow(this)
  @Volatile private var resumeRoom = ""
  @Volatile private var resumeUrl = ""
  @Volatile private var resumeToken = ""
  @Volatile private var screenShareError = ""
  /** 本地共享发布诊断：授权成功不等于 LiveKit 已经发布出可订阅视频轨。 */
  @Volatile private var screenShareDiag = "off"
  /** 用户想要的输出路由（会议默认外放）；SDK 每次拉起音频会话都会重设，需要重放。 */
  @Volatile private var speakerWanted = true

  companion object {
    @Volatile private var activeBridge: MeetingRoomBridge? = null
    @JvmStatic fun current(): MeetingRoomBridge? = activeBridge

  }

  /**
   * 连接已有房间（不建房）。重复调用会先断开上一场。
   * ★入会即按口径开关设备（micOn 默认 true、cameraOn 默认 false）：必须在 connect
   *   成功之后调用 SDK 才认，所以放在这里而不是 UTS 侧。
   */
  fun connect(
    serverUrl: String,
    token: String,
    micOn: Boolean,
    cameraOn: Boolean,
  ) {
    disconnectInternal(false)
    activeBridge = this
    MeetingForegroundService.start(appContext)
    meetingMessages.clear()
    screenShareOn = false
    screenShareError = ""
    screenShareDiag = "off"
    lastErrorText = ""
    val newScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    scope = newScope
    newScope.launch {
      try {
        val created = LiveKit.create(appContext)
        room = created
        // 2.28.x 的第三个参数是 ConnectOptions，默认值即可（自适应流/联播用 SDK 默认）
        created.connect(serverUrl, token)
        newScope.launch {
          created.events.collect { event ->
            if (event is RoomEvent.DataReceived) {
              acceptMeetingData(event)
            }
            if (event is RoomEvent.RoomMetadataChanged) {
              val holder = try { JSONObject(created.metadata ?: "{}").optString("shareHolder") } catch (_: Exception) { "" }
              if ((screenShareOn || sharePending) && holder != created.localParticipant.identity?.value) {
                stopScreenShare()
                screenShareError = "taken_over"
              }
            }
            if (event is RoomEvent.Disconnected && room === created) {
              connectedFlag = false
              shareLease.clear()
              MeetingForegroundService.stop(appContext)
            }
          }
        }
        // 入会口径：语音开局 → 开麦、不开摄像头（失败不阻断入会，例如麦克风权限被拒）
        try {
          created.localParticipant.setMicrophoneEnabled(micOn)
        } catch (e: Throwable) {
        }
        if (cameraOn) {
          try {
            created.localParticipant.setCameraEnabled(true)
          } catch (e: Throwable) {
          }
        }
        connectedFlag = true
        // 会议默认外放：UI 初始 speakerOn=true，连上后必须把系统路由也切到扬声器。
        setSpeakerEnabled(true)
        // 人数由业务层按需轮询 participantCount()，这里不需要定时器
      } catch (e: Throwable) {
        // 连接失败：置错误码，业务层轮询 lastError() 得知（无回调，见文件头说明）
        connectedFlag = false
        lastErrorText = "connect"
        MeetingForegroundService.stop(appContext)
      }
    }
  }

  private fun acceptMeetingData(event: RoomEvent.DataReceived) {
    val topic = event.topic ?: return
    if (topic != "meeting-chat" && topic != "danmaku") return
    try {
      val payload = JSONObject(String(event.data, Charsets.UTF_8))
      val text = payload.optString("text", "").trim()
      // 不按字数裁剪：智能体入会会发 markdown 正文，120 字只是老口径
      if (text.isEmpty()) return
      val item = JSONObject()
      item.put("text", text)
      item.put("name", payload.optString("name", event.participant?.name ?: ""))
      item.put("identity", event.participant?.identity?.value ?: "")
      item.put("self", false)
      item.put("topic", topic)
      item.put("at", System.currentTimeMillis())
      queueMessage(item.toString())
    } catch (_: Throwable) {
    }
  }

  private fun queueMessage(message: String) {
    meetingMessages.offer(message)
    while (meetingMessages.size > 100) meetingMessages.poll()
  }

  /** Sends PC-compatible meeting chat/danmaku using LiveKit's reliable data packet. */
  fun sendMeetingMessage(text: String, displayName: String, danmaku: Boolean) {
    val r = room ?: return
    val s = scope ?: return
    val cleanText = text.trim()
    if (!connectedFlag || cleanText.isEmpty()) return
    val topic = if (danmaku) "danmaku" else "meeting-chat"
    val payload = JSONObject().put("text", cleanText).put("name", displayName).toString().toByteArray(Charsets.UTF_8)
    s.launch {
      try {
        val result = r.localParticipant.publishData(payload, DataPublishReliability.RELIABLE, topic)
        if (result.isSuccess) {
          val item = JSONObject()
          item.put("text", cleanText)
          item.put("name", displayName)
          item.put("identity", r.localParticipant.identity?.value ?: "")
          item.put("self", true)
          item.put("topic", topic)
          item.put("at", System.currentTimeMillis())
          queueMessage(item.toString())
        }
      } catch (_: Throwable) {
      }
    }
  }

  /** Drain queued DataChannel messages as JSON for the UTS polling bridge. */
  fun drainMeetingMessages(): String {
    val out = org.json.JSONArray()
    while (true) {
      val item = meetingMessages.poll() ?: break
      try { out.put(JSONObject(item)) } catch (_: Throwable) {}
    }
    return out.toString()
  }

  fun requestScreenCapture(context: Context) {
    if (sharePending || screenShareOn) return
    shareLease.acquired()
    shareRequestID += 1
    updateSharePending(true)
    try {
      screenShareError = ""
      val intent = Intent(context, MediaProjectionPermissionActivity::class.java)
      intent.putExtra("requestID", shareRequestID)
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
      val requestID = shareRequestID
      scope?.launch {
        delay(60000)
        if (sharePending && shareRequestID == requestID) {
          stopScreenShare()
          screenShareError = "cancelled"
        }
      }
    } catch (e: Throwable) {
      updateSharePending(false)
      shareLease.release()
      screenShareError = e.message ?: "screen_capture_request"
    }
  }

  fun completeScreenCapture(requestID: Int, resultCode: Int, data: Intent?) {
    // 离会/取消后的迟到授权不得重新开始采集。
    if (!sharePending || requestID != shareRequestID || activeBridge !== this) return
    if (resultCode != Activity.RESULT_OK || data == null) {
      screenShareOn = false
      screenShareError = "cancelled"
      screenShareDiag = "cancelled"
      updateSharePending(false)
      shareLease.release()
      return
    }
    val r = room ?: return
    val s = scope ?: return
    s.launch {
      try {
        val started = r.localParticipant.setScreenShareEnabled(
          true,
          ScreenCaptureParams(mediaProjectionPermissionResultData = data, onStop = captureStopped@{
            if (requestID != shareRequestID) return@captureStopped
            screenShareOn = false
            screenShareError = "stopped"
            screenShareDiag = "stopped"
            shareLease.release()
            s.launch {
              if (room === r && requestID == shareRequestID) {
                try { r.localParticipant.setScreenShareEnabled(false) } catch (_: Throwable) {}
              }
            }
          }),
        )
        screenShareDiag = "started=${started}"
        updateSharePending(false)
        if (requestID != shareRequestID || room !== r) {
          r.localParticipant.setScreenShareEnabled(false)
          return@launch
        }
        if (!started) {
          screenShareOn = false
          screenShareError = "screen_share_publish"
          shareLease.release()
          return@launch
        }
        // SDK 返回 true 只表示启动请求成功；publication/track 可能稍后才创建。
        // 等待实际可发布轨道，避免授权弹窗一消失 UI 就误报“已开启共享”。
        var ready = false
        for (attempt in 0 until 20) {
          if (refreshScreenShareState(r)) {
            ready = true
            break
          }
          delay(100)
        }
        if (!ready) {
          refreshScreenShareState(r)
          screenShareError = "screen_share_no_track"
          r.localParticipant.setScreenShareEnabled(false)
          shareLease.release()
        } else {
          screenShareError = ""
        }
      } catch (e: Throwable) {
        screenShareOn = false
        screenShareError = e.message ?: "screen_share_publish"
        screenShareDiag = "throw=${e.javaClass.simpleName}"
        updateSharePending(false)
        shareLease.release()
      }
    }
  }

  fun stopScreenShare() {
    shareRequestID += 1
    updateSharePending(false)
    shareLease.release()
    val r = room ?: return
    val s = scope ?: return
    s.launch {
      try { r.localParticipant.setScreenShareEnabled(false) } catch (_: Throwable) {}
      screenShareOn = false
      screenShareDiag = "off"
    }
  }

  private fun refreshScreenShareState(r: Room): Boolean {
    return try {
      val publication = r.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)
      val hasPublication = publication != null
      val muted = publication?.muted ?: false
      val hasTrack = publication?.track != null
      val ready = hasPublication && !muted && hasTrack
      screenShareOn = ready
      screenShareDiag = "pub=${if (hasPublication) 1 else 0},muted=${if (muted) 1 else 0},track=${if (hasTrack) 1 else 0}"
      ready
    } catch (e: Throwable) {
      screenShareOn = false
      screenShareDiag = "probe=${e.javaClass.simpleName}"
      false
    }
  }

  fun isScreenShareOn(): Boolean {
    if (screenShareError == "stopped" || screenShareError == "cancelled") return false
    val r = room ?: return false
    return refreshScreenShareState(r)
  }

  fun diag(): String = "probe=android-meeting-20261123-p11 share[${screenShareDiag}] ${floatingWindow.diag()}"

  fun configureBackgroundSession(endpoint: String, token: String) { shareLease.configure(endpoint, token) }

  fun rememberResumeState(room: String, url: String, token: String) {
    if (!connectedFlag) return
    resumeRoom = room
    resumeUrl = url
    resumeToken = token
  }

  /** 仅恢复仍存活的本场原生 Room；进程死亡/断会后返回空，禁止持久化或打印。 */
  fun restoreResumeState(): String {
    val current = room ?: return ""
    if (!connectedFlag || resumeRoom.isEmpty() || resumeToken.isEmpty()) return ""
    return JSONObject().put("room", resumeRoom).put("url", resumeUrl).put("token", resumeToken)
      .put("mic", current.localParticipant.getTrackPublication(Track.Source.MICROPHONE)?.let { !it.muted && it.track != null } ?: false)
      .put("camera", current.localParticipant.getTrackPublication(Track.Source.CAMERA)?.let { !it.muted && it.track != null } ?: false)
      .put("speaker", speakerWanted).toString()
  }

  private fun updateSharePending(pending: Boolean) {
    sharePending = pending
    // 录屏权限 Activity 弹出前先关闭 auto-enter，避免授权弹窗触发小窗。
    if (android.os.Looper.myLooper() == android.os.Looper.getMainLooper()) floatingWindow.refreshAutoEnter()
    else android.os.Handler(android.os.Looper.getMainLooper()).post { floatingWindow.refreshAutoEnter() }
  }

  fun isScreenSharePending(): Boolean = sharePending
  fun setMeetingPresentation(activity: Activity?, pageVisible: Boolean, foreground: Boolean) {
    android.os.Handler(android.os.Looper.getMainLooper()).post {
      if (connectedFlag) floatingWindow.setPresentation(activity, pageVisible, foreground)
    }
  }
  fun consumeMeetingRestoreRequest(): Boolean {
    val notification = MeetingReturnRequest.peek()
    val window = floatingWindow.consumeRestoreRequest()
    return connectedFlag && (notification || window)
  }
  fun acknowledgeMeetingRestoreRequest() {
    if (connectedFlag) MeetingReturnRequest.acknowledge()
  }

  fun createPipRenderer(context: Context): SurfaceViewRenderer? {
    val r = room ?: return null
    val view = SurfaceViewRenderer(context)
    r.initVideoRenderer(view)
    applyRemoteScaling(view, true)
    pipRenderer = view
    updatePipRenderer(view)
    return view
  }

  fun updatePipRenderer(view: SurfaceViewRenderer) {
    val r = room ?: return
    val participants = r.remoteParticipants.values.filter { !isEgressParticipant(it) }
    val target = participants.firstOrNull { hasActiveScreenShare(it) }
      ?: participants.firstOrNull { preferredVideoTrack(it) != null }
    // 不回显本机共享，避免整屏录制包含自己的小窗造成无限镜像。
    val next = target?.let { preferredVideoTrack(it) }
    if (pipTrack !== next) {
      pipTrack?.removeRenderer(view)
      pipTrack = next
      next?.addRenderer(view)
    }
    view.visibility = if (next == null) android.view.View.INVISIBLE else android.view.View.VISIBLE
  }

  fun releasePipRenderer(view: SurfaceViewRenderer) {
    if (pipRenderer !== view) return
    try { pipTrack?.removeRenderer(view) } catch (_: Exception) {}
    pipTrack = null
    try { view.release() } catch (_: Exception) {}
    if (pipRenderer === view) pipRenderer = null
  }

  fun screenShareError(): String = screenShareError
  fun isScreenShareStopping(): Boolean = shareLease.isReleasing

  /** 最近一次连接失败原因（空串=无错）。 */
  fun lastError(): String {
    return lastErrorText
  }

  /** 离开：只断本端，不删房。 */
  fun disconnect() {
    disconnectInternal(true)
  }

  /** 麦克风开关（suspend 由协程承接；未连接时忽略）。 */
  fun setMicEnabled(enabled: Boolean) {
    val r = room ?: return
    val s = scope ?: return
    if (enabled) MeetingForegroundService.start(appContext)
    s.launch {
      try {
        r.localParticipant.setMicrophoneEnabled(enabled)
      } catch (e: Throwable) {
        // 权限被拒/设备被占用：保持原状，上层以实际权限为准
      }
      // SDK 开麦时会重设音频路由（默认回到听筒），这里按用户选择重放一次。
      if (enabled) applySpeakerRoute()
    }
  }

  /** 摄像头开关（关闭即停止采集，不保留最后一帧）。 */
  fun setCameraEnabled(enabled: Boolean) {
    val r = room ?: return
    val s = scope ?: return
    s.launch {
      try {
        r.localParticipant.setCameraEnabled(enabled)
        // 轨道发布完成后再挂渲染器：先挂会找不到 track（开摄像头那一帧还没有轨道）
        if (enabled) {
          attachLocalVideo()
        }
      } catch (e: Throwable) {
      }
    }
  }

  /**
   * 音频输出：扬声器 / 听筒。
   * ★用系统 AudioManager 而不是 SDK 的音频路由组件：会议场景 MODE_IN_COMMUNICATION +
   *   isSpeakerphoneOn 最稳，蓝牙/耳机路由由系统按优先级接管（插耳机时设扬声器也顶不掉耳机）。
   */
  fun setSpeakerEnabled(enabled: Boolean) {
    speakerWanted = enabled
    applySpeakerRoute()
  }

  /**
   * 真正写系统路由。★SDK 每次拉起音频会话（开麦 / 订阅到远端音轨）都会重设一次路由，
   * 所以开麦之后要按用户意愿再写一次，否则默认外放会被打回听筒。
   */
  private fun applySpeakerRoute() {
    try {
      val am = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.mode = AudioManager.MODE_IN_COMMUNICATION
      @Suppress("DEPRECATION")
      am.isSpeakerphoneOn = speakerWanted
    } catch (e: Throwable) {
    }
  }

  /** 云端录制 Egress 也是 LiveKit 参与者（identity 前缀 EG_），和 PC 一样不算人。 */
  private fun isEgressParticipant(p: io.livekit.android.room.participant.RemoteParticipant): Boolean =
    (p.identity?.value ?: "").startsWith("EG_")

  /** 房间人数（含本端；未连接返回 0）。★排除 EG_ 录制器，与 PC 口径一致。 */
  fun participantCount(): Int {
    val r = room ?: return 0
    if (!connectedFlag) {
      return 0
    }
    return r.remoteParticipants.values.count { !isEgressParticipant(it) } + 1
  }

  /**
   * 当前正在说话的远端成员 identity（空串 = 没有人在说）。
   * 给「演讲者」布局选大图用：由页面在演讲者布局下轮询（SDK 的 speaking 事件流暂未接）。
   * ★多个在说时取音量最大的一个；只认 isSpeaking，避免底噪把画面拽走。
   */
  fun remoteSpeakingIdentity(): String {
    val r = room ?: return ""
    return try {
      var best = ""
      var bestLevel = 0.0
      for (p in r.remoteParticipants.values) {
        if (!p.isSpeaking) continue
        val level = p.audioLevel.toDouble()
        if (level >= bestLevel) {
          best = p.identity?.value ?: ""
          bestLevel = level
        }
      }
      best
    } catch (_: Throwable) {
      ""
    }
  }

  /** 房间 metadata：服务端更新后 LiveKit 会同步到 Room，本端由页面轮询读取。 */
  fun roomMetadata(): String {
    return room?.metadata ?: ""
  }

  /** 举手状态走 participant attributes，与 PC / iOS 使用同一个 handRaised 键。 */
  fun setHandRaised(raised: Boolean) {
    val r = room ?: return
    val s = scope ?: return
    s.launch {
      try {
        r.localParticipant.updateAttributes(
          mapOf("handRaised" to if (raised) "1" else "")
        )
      } catch (e: Throwable) {
      }
    }
  }

  fun localHandRaised(): Boolean {
    return try {
      (room?.localParticipant?.attributes?.get("handRaised") ?: "").isNotEmpty()
    } catch (e: Throwable) {
      false
    }
  }

  /** 是否已连接（由 connect 结果驱动）。 */
  fun isConnected(): Boolean {
    return connectedFlag
  }

  /**
   * 本机麦克风音量（0..1）。给页面画「说话音波」用：由页面每 ~250ms 拉一次，
   * 不走事件流（`room.events` 的重载问题还没解决，见文件头）。
   */
  fun localAudioLevel(): Double {
    val r = room ?: return 0.0
    return try {
      r.localParticipant.audioLevel.toDouble()
    } catch (e: Throwable) {
      0.0
    }
  }

  /**
   * 切换前后摄像头（入会默认前置）。
   * ★2.x 的切换方法在 **LocalVideoTrack** 上（`switchCamera(position = ...)`），
   *   `LocalParticipant` 上没有这个名字；同时把渲染器的镜像跟着切
   *   （前置镜像、后置不镜像，否则后置画面左右颠倒）。
   */
  fun switchCamera() {
    val r = room ?: return
    try {
      val publication = r.localParticipant.getTrackPublication(Track.Source.CAMERA)
      val track = publication?.track as? LocalVideoTrack ?: return
      val next = if (cameraPosition == CameraPosition.FRONT) CameraPosition.BACK else CameraPosition.FRONT
      track.switchCamera(position = next)
      cameraPosition = next
      try {
        renderer?.setMirror(next == CameraPosition.FRONT)
      } catch (e: Throwable) {
      }
    } catch (e: Throwable) {
    }
  }

  // ------------------------------------------------------------------ 视频渲染

  /**
   * 创建原生渲染视图（SurfaceViewRenderer），交给页面用 `<native-view>` 绑定。
   * ★EGL 上下文独立：渲染器自己持有一份，与 SDK 的内部 EGL 不共享也不冲突。
   * ★只在 Android 走这条路；iOS 用 `VideoView`，鸿蒙暂无（见插件 app-harmony 占位）。
   */
  fun createVideoRenderer(context: Context): SurfaceViewRenderer? {
    releaseRenderer()
    try {
      val r = room ?: return null
      val view = SurfaceViewRenderer(context)
      // ★用 Room.initVideoRenderer：SDK 内部用同一个 EglBase 初始化，
      //   比自己 `EglBase.create()` 再 init 少一个版本相关的符号（官方推荐做法）
      r.initVideoRenderer(view)
      // 本机预览默认镜像（前置摄像头看起来才自然）；远端画面不需要镜像
      view.setMirror(true)
      applyFillScaling(view)
      // 未出画面时透出下层（否则是一块纯黑，用户看到"卡片变黑"）
      try {
        view.setBackgroundColor(Color.TRANSPARENT)
      } catch (e: Throwable) {
      }
      renderer = view
      return view
    } catch (e: Throwable) {
      releaseRenderer()
      return null
    }
  }

  /** 把摄像头轨道挂到渲染器上（本机预览）。轨道还没发布时静默跳过，开摄像头后再调一次。 */
  fun attachLocalVideo() {
    val r = room ?: return
    val rv = renderer ?: return
    try {
      val publication = r.localParticipant.getTrackPublication(Track.Source.CAMERA)
      val track = publication?.track as? VideoTrack
      track?.addRenderer(rv)
    } catch (e: Throwable) {
    }
  }

  /** 释放渲染器（关摄像头 / 离开页面）。EglBase 由 Room 统一持有，这里只释放 View。 */
  fun releaseRenderer() {
    try {
      renderer?.release()
    } catch (e: Throwable) {
    }
    renderer = null
  }

  // ------------------------------------------------------------------ 远端视频

  /**
   * 当前有未静音视频 publication 的远端成员 identity 列表（逗号分隔）。
   * ★不用 `room.events`：事件流在这个 SDK/协程组合下有重载解析问题（见文件头），
   *   这里直接查 `remoteParticipants` 的轨道发布状态，由页面轮询驱动。
   */
  fun remoteVideoIdentities(): String {
    val r = room ?: return ""
    val out = StringBuilder()
    try {
      for (p in r.remoteParticipants.values) {
        if (isEgressParticipant(p)) continue
        if (hasVideoPublication(p)) {
          if (out.isNotEmpty()) {
            out.append(",")
          }
          // identity 是 `Participant.Identity?`：必须空安全取 value
          out.append(p.identity?.value ?: "")
        }
      }
      refreshRemoteRendererTracks(r)
    } catch (e: Throwable) {
    }
    return out.toString()
  }

  /**
   * 为某个远端成员创建/复用渲染视图并挂上其视频轨道。
   * ★页面每格一个 `<native-view>`，init 时用 identity 来取；
   *   同一个 identity 复用同一个 SurfaceViewRenderer（重复初始化会黑屏）。
   */
  fun createRemoteRenderer(context: Context, identity: String): SurfaceViewRenderer? {
    val r = room ?: return null
    try {
      var target: io.livekit.android.room.participant.RemoteParticipant? = null
      for (p in r.remoteParticipants.values) {
        if ((p.identity?.value ?: "") == identity) {
          target = p
        }
      }
      val participant = target ?: return null
      if (!hasVideoPublication(participant)) return null
      val video = preferredVideoTrack(participant)
      val existing = remoteRenderers[identity]
      if (existing != null) {
        attachRemoteTrack(identity, existing, video, participant)
        return existing
      }
      val view = SurfaceViewRenderer(context)
      r.initVideoRenderer(view)
      applyRemoteScaling(view, hasActiveScreenShare(participant))
      // 远端还没来帧时透出下层白底（否则格子是纯黑）
      try {
        view.setBackgroundColor(Color.TRANSPARENT)
      } catch (e: Throwable) {
      }
      remoteRenderers[identity] = view
      attachRemoteTrack(identity, view, video, participant)
      return view
    } catch (e: Throwable) {
      return null
    }
  }

  /** 释放所有远端渲染视图（离开会议时调用）。 */
  fun releaseRemoteRenderers() {
    try {
      for ((identity, view) in remoteRenderers) {
        try {
          remoteTracks[identity]?.removeRenderer(view)
          view.release()
        } catch (e: Throwable) {
        }
      }
    } catch (e: Throwable) {
    }
    remoteRenderers.clear()
    remoteTracks.clear()
  }

  /**
   * 画面缩放策略：裁切铺满（`SCALE_ASPECT_FILL`）。
   * ★默认是等比适配（letterbox），竖屏卡片里会上下留黑边 —— 用户看到的就是"黑底 + 小画面"。
   *   铺满会裁掉一点边缘，和飞书一致。
   */
  private fun applyFillScaling(view: SurfaceViewRenderer) {
    try {
      // ★LiveKit 对 WebRTC 做了重打包：枚举在 `livekit.org.webrtc` 下，
      //   不是上游的 `org.webrtc`（云打包实测：org.webrtc 未解析）
      view.setScalingType(livekit.org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FILL)
    } catch (e: Throwable) {
    }
  }

  /** 屏幕共享保持完整画面，摄像头才裁切铺满。 */
  private fun applyRemoteScaling(view: SurfaceViewRenderer, screenShare: Boolean) {
    try {
      val mode = if (screenShare) {
        livekit.org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FIT
      } else {
        livekit.org.webrtc.RendererCommon.ScalingType.SCALE_ASPECT_FILL
      }
      view.setScalingType(mode)
    } catch (e: Throwable) {
    }
  }

  /** publication 一出现就让页面挂 native-view；track 稍后订阅到时由轮询补绑。 */
  private fun hasVideoPublication(p: io.livekit.android.room.participant.RemoteParticipant): Boolean {
    return try {
      val camera = p.getTrackPublication(Track.Source.CAMERA)
      val screen = p.getTrackPublication(Track.Source.SCREEN_SHARE)
      (camera != null && !camera.muted) || (screen != null && !screen.muted)
    } catch (e: Throwable) {
      false
    }
  }

  private fun hasActiveScreenShare(p: io.livekit.android.room.participant.RemoteParticipant): Boolean {
    return try {
      val screen = p.getTrackPublication(Track.Source.SCREEN_SHARE)
      screen != null && !screen.muted
    } catch (e: Throwable) {
      false
    }
  }

  /** 远端主画面优先共享轨，没有共享才回退摄像头。 */
  private fun preferredVideoTrack(p: io.livekit.android.room.participant.RemoteParticipant): VideoTrack? {
    return try {
      val screen = p.getTrackPublication(Track.Source.SCREEN_SHARE)
      if (screen != null && !screen.muted) {
        val track = screen.track as? VideoTrack
        if (track != null) return track
      }
      val camera = p.getTrackPublication(Track.Source.CAMERA)
      if (camera != null && !camera.muted) camera.track as? VideoTrack else null
    } catch (e: Throwable) {
      null
    }
  }

  /** 幂等切轨：同一轨道不重复 addRenderer；换轨先 removeRenderer。 */
  private fun attachRemoteTrack(
    identity: String,
    view: SurfaceViewRenderer,
    next: VideoTrack?,
    participant: io.livekit.android.room.participant.RemoteParticipant,
  ) {
    val previous = remoteTracks[identity]
    if (previous === next) {
      applyRemoteScaling(view, hasActiveScreenShare(participant))
      return
    }
    try { previous?.removeRenderer(view) } catch (_: Throwable) {}
    remoteTracks.remove(identity)
    if (next != null) {
      try {
        next.addRenderer(view)
        remoteTracks[identity] = next
      } catch (_: Throwable) {
      }
    }
    applyRemoteScaling(view, hasActiveScreenShare(participant))
  }

  /** 轨道订阅通常晚于 publication；轮询 identity 时顺便把新轨道补到已有视图。 */
  private fun refreshRemoteRendererTracks(r: Room) {
    for ((identity, view) in remoteRenderers) {
      val participant = r.remoteParticipants.values.firstOrNull { (it.identity?.value ?: "") == identity }
      if (participant == null) {
        try { remoteTracks[identity]?.removeRenderer(view) } catch (_: Throwable) {}
        remoteTracks.remove(identity)
        continue
      }
      attachRemoteTrack(identity, view, preferredVideoTrack(participant), participant)
    }
  }

  // ------------------------------------------------------------------ 内部


  private fun disconnectInternal(notify: Boolean) {
    resumeRoom = ""
    resumeUrl = ""
    resumeToken = ""
    android.os.Handler(android.os.Looper.getMainLooper()).post { floatingWindow.stop() }
    shareRequestID += 1
    updateSharePending(false)
    shareLease.clear()
    pipRenderer?.let { releasePipRenderer(it) }
    MeetingForegroundService.stop(appContext)
    screenShareOn = false
    meetingMessages.clear()
    if (activeBridge === this) activeBridge = null
    releaseRenderer()
    releaseRemoteRenderers()
    val r = room
    room = null
    val s = scope
    scope = null
    // ★退房必须在**独立 scope** 里做完：之前是 `s.launch { disconnect() }` 后立刻 `s.cancel()`，
    //   退房协程被一起取消 → 服务端还留着这个 identity 的"幽灵"参与者，
    //   再次入会被判重复身份，表现就是「退出后再加入同一场会 → 加入失败」。
    if (r != null) {
      try {
        val cleanup = CoroutineScope(SupervisorJob() + Dispatchers.Default)
        cleanup.launch {
          try {
            r.disconnect()
          } catch (e: Throwable) {
          }
        }
      } catch (e: Throwable) {
      }
    }
    try {
      s?.cancel()
    } catch (e: Throwable) {
    }
    connectedFlag = false
    // 归还音频模式，避免退出会议后仍占着通话音量路由
    try {
      val am = appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
      am.mode = AudioManager.MODE_NORMAL
    } catch (e: Throwable) {
    }
    if (notify) {
      lastErrorText = ""
    }
  }
}
