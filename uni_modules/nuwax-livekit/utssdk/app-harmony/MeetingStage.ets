import { abilityAccessCtrl, common, Permissions, Want } from '@kit.AbilityKit'
import { webview } from '@kit.ArkWeb'
import { audio } from '@kit.AudioKit'
import { util } from '@kit.ArkTS'
import { http } from '@kit.NetworkKit'
import { BuilderNode, FrameNode, NodeController, UIContext } from '@kit.ArkUI'
import { BusinessError } from '@kit.BasicServicesKit'
import { EntryVoipBackgroundTask } from './EntryVoipBackgroundTask.ets'

export const meetingAsset = 'nuwax-meeting/media.html'
export const meetingScriptAsset = 'nuwax-meeting/room.js'
// The reserved HTTPS origin provides a secure context for WebRTC capture.
const mediaOrigin = 'https://nuwax-meeting.invalid'
const mediaURL = mediaOrigin + '/media.html'

class Command {
  id: number = 0
  type: string = ''
  url?: string
  token?: string
  on?: boolean
  text?: string
  name?: string
  danmaku?: boolean
  shareId?: number
}

interface MeetingMessage {
  text: string
  name: string
  identity: string
  self: boolean
  topic: string
  at: number
}

interface ShareLease {
  id: number
  url: string
  token: string
}

interface ShareReleaseResponse {
  code?: string
}

interface BrowserEvent {
  type: string
  id: number
  connection?: string
  left?: boolean
  people?: number
  mic?: boolean
  remoteAudio?: boolean
  camera?: boolean
  micAllowed?: boolean
  cameraAllowed?: boolean
  level?: number
  raised?: boolean
  remoteSpeaker?: string
  metadata?: string
  videos?: string
  shared?: boolean
  sharing?: boolean
  awaitingCapture?: boolean
  captureAllowed?: boolean
  shareId?: number
  error?: string
  message?: MeetingMessage
  identity?: string
  thumbnail?: boolean
}

export class MeetingStageSession {
  static host: MeetingStageHost | undefined
  private static mount: MeetingStageMount | undefined
  private static nextMountId: number = 0
  static pending: Command | undefined
  static id: number = 0
  static connection: string = ''
  static error: string = ''
  static controlError: string = ''
  static mic: boolean = false
  static micAllowed: boolean = false
  static cameraAllowed: boolean = false
  private static remoteAudio: boolean = false
  private static backgroundOwner: string = ''
  private static backgroundRetryAt: number = 0
  private static foreground: boolean = true
  private static restoreRequested: boolean = false
  static camera: boolean = false
  static speaker: boolean = true
  static shared: boolean = false
  static sharing: boolean = false
  static awaitingCapture: boolean = false
  static shareError: string = ''
  static captureArmed: boolean = false
  static captureAllowed: boolean = false
  private static shareLease: ShareLease | undefined
  private static nextShareId: number = 0
  private static shareStartTimer: number = -1
  private static shareRelease: Promise<void> | undefined
  static people: number = 0
  static level: number = 0
  static raised: boolean = false
  static remoteSpeaker: string = ''
  static metadata: string = ''
  static videos: string = ''
  static messages: MeetingMessage[] = []
  private static stageTap: string = ''
  /**
   * 会议自己激活的音频会话（应用级）。退会时只归还自己激活的那一次，
   * 避免把别的模块（如单聊 VoIP）已经激活的会话一起关掉。
   */
  private static audioSessionOwned: boolean = false
  /** 音频会话/输出设备操作的串行队列：激活与归还不能交叉（见 setSpeakerRoute）。 */
  private static audioRouteWork: Promise<void> = Promise.resolve()

  static setStagePresentation(mountId: number, presentation: string): void {
    if (MeetingStageSession.mount?.id === mountId) MeetingStageSession.host?.setStagePresentation(presentation)
  }

  static consumeStageTap(mountId: number): string {
    if (MeetingStageSession.mount?.id !== mountId) return ''
    const tap = MeetingStageSession.stageTap
    MeetingStageSession.stageTap = ''
    return tap
  }

  static attach(context: common.UIAbilityContext): MeetingStageMount {
    MeetingStageSession.mount?.detach()
    MeetingStageSession.stageTap = ''
    const host = MeetingStageSession.host ?? new MeetingStageHost(context)
    MeetingStageSession.host = host
    MeetingStageSession.nextMountId += 1
    const mount = new MeetingStageMount(MeetingStageSession.nextMountId, host)
    MeetingStageSession.mount = mount
    return mount
  }

  static releaseView(id: number): boolean {
    const mount = MeetingStageSession.mount
    if (!mount) return true
    if (mount.id !== id) return false
    MeetingStageSession.mount = undefined
    mount.detach()
    MeetingStageSession.releaseIdleHost()
    return true
  }

  static releaseIdleHost(): void {
    if (MeetingStageSession.mount || MeetingStageSession.isConnected() ||
        MeetingStageSession.connection === 'connecting' || MeetingStageSession.host?.leaving) return
    const host = MeetingStageSession.host
    MeetingStageSession.host = undefined
    host?.dispose()
  }

  static connect(url: string, token: string): void {
    MeetingStageSession.disconnect()
    MeetingStageSession.connection = 'connecting'
    const command = new Command()
    command.type = 'connect'
    command.id = MeetingStageSession.id
    command.url = url
    command.token = token
    MeetingStageSession.pending = command
    // 会议默认外放（与 Android 入会 setSpeakerEnabled(true) 同口径），并且赶在 ArkWeb
    // 开始播放之前把应用级会话激活成 VoIP 场景 —— 播放流按激活时的场景确定流类型，
    // 等用户点扬声器才激活的话，后设的输出设备可能作用不到已开始的播放流上。
    MeetingStageSession.setSpeakerRoute(true, MeetingStageSession.id).catch((): void => {})
    MeetingStageSession.flush()
  }

  static flush(): void {
    const command = MeetingStageSession.pending
    const host = MeetingStageSession.host
    if (!command || !host?.ready || host.leaving) return
    MeetingStageSession.pending = undefined
    host.send(command)
  }

  /**
   * 切会议音频出口：true=外放，false=听筒。**所有会话/路由操作串行**，避免退会归还与
   * 重新激活交叉（重进会议时会把刚设好的输出设备顶掉）。
   *
   * ★为什么不再用 AudioRoutingManager.setCommunicationDevice：
   *   会议远端声音由 ArkWeb 里的 WebRTC 播放（按 VoIP 通话流类型出声）。该接口在系统侧
   *   已标记废弃、对这类播放改不了路由，而 isCommunicationDeviceActiveSync 会一直回读
   *   「扬声器仍激活」——用户看到的就是「点了关不掉 + 操作失败」。
   *   应用级 AudioSession（VOICE_COMMUNICATION 场景）的 setDefaultOutputDevice 才会作用到
   *   VoIP 类播放流上，且 getDefaultOutputDevice 能回读设置结果（官方音频路由切换指南）。
   *
   * @param id 会场代次：切的过程中退会/换会（id 变了）就放弃，不写回状态。
   * @returns 输出设备是否确认切到位（false = 失败或已作废）。
   */
  static setSpeakerRoute(on: boolean, id: number): Promise<boolean> {
    const run = MeetingStageSession.audioRouteWork.then(async (): Promise<boolean> => {
      if (MeetingStageSession.id !== id) return false
      try {
        const session = audio.getAudioManager().getSessionManager()
        if (!session.isAudioSessionActivated()) {
          session.setAudioSessionScene(audio.AudioSessionScene.AUDIO_SESSION_SCENE_VOICE_COMMUNICATION)
          await session.activateAudioSession({ concurrencyMode: audio.AudioConcurrencyMode.CONCURRENCY_MIX_WITH_OTHERS })
          MeetingStageSession.audioSessionOwned = true
        }
        if (MeetingStageSession.id !== id) return false
        const target = on ? audio.DeviceType.SPEAKER : audio.DeviceType.EARPIECE
        await session.setDefaultOutputDevice(target)
        if (MeetingStageSession.id !== id) return false
        // 回读应用级设置（系统随后才真正切换路由）；比旧实现读 isCommunicationDeviceActiveSync 稳。
        if (session.getDefaultOutputDevice() !== target) return false
        MeetingStageSession.speaker = on
        return true
      } catch (_) {
        return false
      }
    })
    MeetingStageSession.audioRouteWork = run.then((): void => {}).catch((): void => {})
    return run
  }

  /** 退会：会话是我们激活的那一次才把输出设备交还系统并归还；别人激活的不动。 */
  static releaseAudioSession(): void {
    if (!MeetingStageSession.audioSessionOwned) return
    MeetingStageSession.audioSessionOwned = false
    MeetingStageSession.audioRouteWork = MeetingStageSession.audioRouteWork.then(async () => {
      try {
        const session = audio.getAudioManager().getSessionManager()
        await session.setDefaultOutputDevice(audio.DeviceType.DEFAULT)
        await session.deactivateAudioSession()
      } catch (_) {}
    })
  }

  static disconnect(): Promise<boolean> {
    const host = MeetingStageSession.host
    const connection = MeetingStageSession.connection
    let leaving = host?.leaving
    if (!leaving && host && connection.length > 0 && connection !== 'disconnected' && !MeetingStageSession.pending) {
      leaving = host.leave(MeetingStageSession.id)
    }
    MeetingStageSession.releaseShare()
    MeetingStageSession.releaseBackgroundTask(leaving)
    MeetingStageSession.id += 1
    MeetingStageSession.pending = undefined
    MeetingStageSession.connection = ''
    MeetingStageSession.error = ''
    MeetingStageSession.controlError = ''
    MeetingStageSession.mic = false
    MeetingStageSession.micAllowed = false
    MeetingStageSession.cameraAllowed = false
    MeetingStageSession.remoteAudio = false
    MeetingStageSession.backgroundRetryAt = 0
    MeetingStageSession.restoreRequested = false
    MeetingStageSession.camera = false
    MeetingStageSession.speaker = true
    MeetingStageSession.shared = false
    MeetingStageSession.sharing = false
    MeetingStageSession.awaitingCapture = false
    MeetingStageSession.shareError = ''
    MeetingStageSession.captureArmed = false
    MeetingStageSession.people = 0
    MeetingStageSession.level = 0
    MeetingStageSession.raised = false
    MeetingStageSession.remoteSpeaker = ''
    MeetingStageSession.metadata = ''
    MeetingStageSession.videos = ''
    MeetingStageSession.messages = []
    MeetingStageSession.stageTap = ''
    MeetingStageSession.releaseAudioSession()
    return leaving ?? Promise.resolve(true)
  }

  static isConnected(): boolean {
    const state = MeetingStageSession.connection
    return state === 'connected' || state === 'reconnecting' || state === 'signalReconnecting'
  }

  static handleBackgroundWant(want: Want): void {
    if (MeetingStageSession.isConnected() && EntryVoipBackgroundTask.acceptsNotification(want)) {
      MeetingStageSession.restoreRequested = true
    }
  }

  static consumeRestoreRequest(): boolean {
    const restore = MeetingStageSession.restoreRequested && MeetingStageSession.isConnected()
    MeetingStageSession.restoreRequested = false
    return restore
  }

  static setAppForeground(foreground: boolean): void {
    MeetingStageSession.foreground = foreground
    if (foreground) {
      MeetingStageSession.host?.keepActive()
      if (MeetingStageSession.isConnected()) MeetingStageSession.host?.readSpeaker()
      MeetingStageSession.updateBackgroundTask()
    }
  }

  private static updateBackgroundTask(): void {
    if (MeetingStageSession.connection === 'disconnected') {
      MeetingStageSession.releaseBackgroundTask()
      return
    }
    const host = MeetingStageSession.host
    if (!host || !MeetingStageSession.foreground || MeetingStageSession.connection !== 'connected' ||
        MeetingStageSession.backgroundOwner.length > 0 || Date.now() < MeetingStageSession.backgroundRetryAt ||
        (!MeetingStageSession.mic && !MeetingStageSession.remoteAudio && !MeetingStageSession.sharing)) return
    const owner = 'meeting:' + MeetingStageSession.id
    MeetingStageSession.backgroundOwner = owner
    host.acquireBackgroundTask(owner, () => {
      return MeetingStageSession.backgroundOwner === owner && MeetingStageSession.foreground &&
        MeetingStageSession.isConnected() && (MeetingStageSession.mic || MeetingStageSession.remoteAudio || MeetingStageSession.sharing)
    }).then((granted) => {
      if (MeetingStageSession.backgroundOwner !== owner) return
      if (granted) {
        console.info('[MeetingStage] background task running')
      } else {
        MeetingStageSession.backgroundOwner = ''
      }
    }).catch((error: BusinessError) => {
      if (MeetingStageSession.backgroundOwner !== owner) return
      MeetingStageSession.backgroundOwner = ''
      MeetingStageSession.backgroundRetryAt = Date.now() + 5000
      console.warn('[MeetingStage] background task failed code=' + error.code)
    })
  }

  private static releaseBackgroundTask(leaving?: Promise<boolean>): void {
    const owner = MeetingStageSession.backgroundOwner
    if (owner.length === 0) return
    MeetingStageSession.backgroundOwner = ''
    // A detached meeting still needs time to send its leave and return screen-share ownership.
    const afterLeave = leaving ?? Promise.resolve(true)
    const shareRelease = MeetingStageSession.shareRelease ?? Promise.resolve()
    afterLeave.then(() => shareRelease).finally(() => EntryVoipBackgroundTask.release(owner)).catch((error: BusinessError) => {
      console.warn('[MeetingStage] background task release failed code=' + error.code)
    })
  }

  static isAppForeground(): boolean {
    return MeetingStageSession.foreground
  }

  static control(type: string, on: boolean = false): void {
    if (!MeetingStageSession.isConnected()) return
    const command = new Command()
    command.type = type
    command.on = on
    command.id = MeetingStageSession.id
    MeetingStageSession.host?.control(command)
  }

  static sendMessage(text: string, name: string, danmaku: boolean): void {
    const command = new Command()
    command.type = 'message'
    command.id = MeetingStageSession.id
    command.text = text
    command.name = name
    command.danmaku = danmaku
    MeetingStageSession.host?.send(command)
  }

  static prepareShare(label: string, cancel: string, releaseURL: string, seatToken: string): boolean {
    if (!MeetingStageSession.isConnected() || !MeetingStageSession.host?.screenSupported ||
        MeetingStageSession.shareRelease || MeetingStageSession.shareLease) return false
    const base = 'https://testagent.xspaceagi.com/api/instant-message/meetings/public/rooms/'
    if (!releaseURL.startsWith(base) || !releaseURL.endsWith('/share-holder/release') || seatToken.length === 0) return false
    MeetingStageSession.nextShareId += 1
    const shareId = MeetingStageSession.nextShareId
    MeetingStageSession.shareLease = { id: shareId, url: releaseURL, token: seatToken }
    MeetingStageSession.shareError = ''
    MeetingStageSession.captureArmed = true
    const command = new Command()
    command.type = 'prepareShare'
    command.id = MeetingStageSession.id
    command.shareId = shareId
    command.text = label
    command.name = cancel
    MeetingStageSession.shareStartTimer = setTimeout(() => {
      MeetingStageSession.shareFailed(shareId, 'screen_capture_timeout')
    }, 65000)
    MeetingStageSession.host?.send(command)
    return true
  }

  static stopShare(): void {
    const lease = MeetingStageSession.shareLease
    if (!lease) return
    const command = new Command()
    command.type = 'stopShare'
    command.id = MeetingStageSession.id
    command.shareId = lease.id
    MeetingStageSession.host?.send(command)
    MeetingStageSession.releaseShare()
  }

  static shareFailed(id: number, error: string): void {
    if (MeetingStageSession.shareLease?.id !== id) return
    MeetingStageSession.shareError = error
    MeetingStageSession.stopShare()
  }

  private static clearShareStartTimer(): void {
    if (MeetingStageSession.shareStartTimer === -1) return
    clearTimeout(MeetingStageSession.shareStartTimer)
    MeetingStageSession.shareStartTimer = -1
  }

  static isShareReleaseRunning(): boolean {
    return MeetingStageSession.shareRelease !== undefined
  }

  private static releaseShare(): void {
    MeetingStageSession.clearShareStartTimer()
    MeetingStageSession.captureArmed = false
    MeetingStageSession.captureAllowed = false
    MeetingStageSession.sharing = false
    MeetingStageSession.awaitingCapture = false
    const lease = MeetingStageSession.shareLease
    if (!lease) return
    MeetingStageSession.shareLease = undefined
    MeetingStageSession.shareRelease = MeetingStageSession.releaseShareAtServer(lease).finally(() => {
      MeetingStageSession.shareRelease = undefined
    })
  }

  private static async releaseShareAtServer(lease: ShareLease): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      let request: http.HttpRequest | undefined
      try {
        request = http.createHttp()
        const response = await request.request(lease.url, {
          method: http.RequestMethod.POST,
          header: { 'content-type': 'application/json' },
          extraData: JSON.stringify({ token: lease.token }),
          connectTimeout: 3000, readTimeout: 3000, expectDataType: http.HttpDataType.STRING,
        })
        if (response.responseCode < 500 && response.responseCode !== 429) {
          if (response.responseCode !== 200 || typeof response.result !== 'string') return
          const result = JSON.parse(response.result) as ShareReleaseResponse
          // Releasing a seat that has already been replaced is terminal.
          if (result.code !== 'IM_30004') return
        }
      } catch (_) {
        // A bounded retry covers a transient connection failure.
      } finally {
        try { request?.destroy() } catch (_) {}
      }
      if (attempt === 0) await new Promise<void>((resolve) => { setTimeout(resolve, 500) })
    }
    console.warn('[MeetingStage] share release did not complete')
  }

  static receive(event: BrowserEvent): void {
    if (event.id !== MeetingStageSession.id) return
    if (event.type === 'state') {
      const becameConnected = event.connection === 'connected' && MeetingStageSession.connection !== 'connected'
      MeetingStageSession.connection = event.connection ?? ''
      if (becameConnected) MeetingStageSession.host?.readSpeaker()
      if (MeetingStageSession.connection === 'disconnected') MeetingStageSession.releaseShare()
      MeetingStageSession.people = event.people ?? 0
      MeetingStageSession.mic = event.mic === true
      MeetingStageSession.remoteAudio = event.remoteAudio === true
      MeetingStageSession.camera = event.camera === true
      MeetingStageSession.micAllowed = event.micAllowed === true
      MeetingStageSession.cameraAllowed = event.cameraAllowed === true
      MeetingStageSession.level = event.level ?? 0
      MeetingStageSession.raised = event.raised === true
      MeetingStageSession.remoteSpeaker = event.remoteSpeaker ?? ''
      MeetingStageSession.metadata = event.metadata ?? ''
      MeetingStageSession.videos = event.videos ?? ''
      MeetingStageSession.shared = event.shared === true
      const lease = MeetingStageSession.shareLease
      const currentShare = lease != null && lease.id === event.shareId
      MeetingStageSession.sharing = currentShare && event.sharing === true
      MeetingStageSession.awaitingCapture = currentShare && event.awaitingCapture === true
      MeetingStageSession.captureAllowed = currentShare && event.captureAllowed === true
      if (MeetingStageSession.sharing) MeetingStageSession.clearShareStartTimer()
      MeetingStageSession.updateBackgroundTask()
    } else if (event.type === 'shareError') {
      MeetingStageSession.shareFailed(event.shareId ?? 0, event.error ?? '')
    } else if (event.type === 'message' && event.message) {
      if (MeetingStageSession.messages.length >= 100) MeetingStageSession.messages.shift()
      MeetingStageSession.messages.push(event.message)
    } else if (event.type === 'stageTap' && event.identity && MeetingStageSession.mount) {
      MeetingStageSession.stageTap = JSON.stringify(event)
    } else if (event.type === 'error') {
      if (event.error === 'connect') MeetingStageSession.error = event.error
      else MeetingStageSession.controlError = event.error ?? ''
    }
  }
}

export class MeetingStageHost {
  controller: webview.WebviewController = new webview.WebviewController()
  ready: boolean = false
  screenSupported: boolean = false
  private context: common.UIAbilityContext
  private stage: BuilderNode<[MeetingStageHost]> | undefined
  private stagePresentation: string = ''
  leaving: Promise<boolean> | undefined
  private leavingId: number = -1
  private leaveTimer: number = -1
  private finishLeaving: ((left: boolean) => void) | undefined
  private tasks: Promise<void> = Promise.resolve()

  constructor(context: common.UIAbilityContext) {
    this.context = context
  }

  frame(context: UIContext): FrameNode | null {
    if (!this.stage) {
      const stage = new BuilderNode<[MeetingStageHost]>(context)
      this.stage = stage
      stage.build(wrapBuilder<[MeetingStageHost]>(buildMeetingStage), this)
    }
    return this.stage.getFrameNode()
  }

  keepActive(): void {
    if (this.ready) {
      try { this.controller.onActive() } catch (_) {}
    }
  }

  setStagePresentation(presentation: string): void {
    this.stagePresentation = presentation
    if (this.ready && presentation.length > 0) {
      this.controller.runJavaScript('window.meetingMedia.setStagePresentation(' +
        JSON.stringify(presentation) + ')').catch(() => {})
    }
  }

  dispose(): void {
    this.ready = false
    this.stage?.dispose()
    this.stage = undefined
  }

  acquireBackgroundTask(owner: string, needed: () => boolean): Promise<boolean> {
    return EntryVoipBackgroundTask.acquire(owner, this.context, needed)
  }

  leave(id: number): Promise<boolean> {
    if (!this.ready) return Promise.resolve(false)
    const leaving = new Promise<boolean>((resolve) => { this.finishLeaving = resolve })
    this.leaving = leaving
    this.leavingId = id
    this.leaveTimer = setTimeout(() => { this.completeLeave(id, false) }, 2500)
    const command = new Command()
    command.type = 'disconnect'
    command.id = id
    this.send(command)
    return leaving
  }

  private completeLeave(id: number, left: boolean): void {
    if (id !== this.leavingId || !this.finishLeaving) return
    clearTimeout(this.leaveTimer)
    this.leaveTimer = -1
    this.leavingId = -1
    this.leaving = undefined
    const finish = this.finishLeaving
    this.finishLeaving = undefined
    finish(left)
    MeetingStageSession.flush()
    MeetingStageSession.releaseIdleHost()
  }

  postMessage(raw: string): void {
    if (MeetingStageSession.host !== this || !this.ready || raw.length > 16384) return
    try {
      const event = JSON.parse(raw) as BrowserEvent
      if (event.type === 'leaveComplete') this.completeLeave(event.id, event.left === true)
      else MeetingStageSession.receive(event)
    } catch (_) {}
  }

  loaded(url: string): void {
    if (!this.isAsset(url, 'media.html')) return
    const probe = 'typeof window.meetingMedia?.dispatch === "function" ? (typeof navigator.mediaDevices?.getDisplayMedia === "function" ? 2 : 1) : 0'
    this.controller.runJavaScript(probe).then((result) => {
      if (MeetingStageSession.host !== this) return
      this.ready = result === '1' || result === '2'
      this.screenSupported = result === '2'
      if (this.ready) {
        this.setStagePresentation(this.stagePresentation)
        MeetingStageSession.flush()
      } else MeetingStageSession.error = 'connect'
    }).catch(() => {
      if (MeetingStageSession.host === this) MeetingStageSession.error = 'connect'
    })
  }

  isAsset(url: string, name: string): boolean {
    return url === mediaOrigin + '/' + name
  }

  private assetNotFound(): WebResourceResponse {
    const response = new WebResourceResponse()
    response.setResponseData('')
    response.setResponseMimeType('text/plain')
    response.setResponseEncoding('utf-8')
    response.setResponseCode(404)
    response.setReasonMessage('Not Found')
    response.setResponseIsReady(true)
    return response
  }

  assetResponse(url: string): WebResourceResponse {
    const html = this.isAsset(url, 'media.html')
    if (!html && !this.isAsset(url, 'room.js')) return this.assetNotFound()
    const file = html ? meetingAsset : meetingScriptAsset
    try {
      const bytes = this.context.resourceManager.getRawFileContentSync(file)
      const response = new WebResourceResponse()
      response.setResponseData(util.TextDecoder.create('utf-8').decodeToString(bytes))
      response.setResponseMimeType(html ? 'text/html' : 'text/javascript')
      response.setResponseEncoding('utf-8')
      response.setResponseCode(200)
      response.setReasonMessage('OK')
      response.setResponseIsReady(true)
      return response
    } catch (_) { return this.assetNotFound() }
  }

  rendererExited(): void {
    if (MeetingStageSession.host !== this) return
    this.ready = false
    this.screenSupported = false
    MeetingStageSession.disconnect()
    this.completeLeave(this.leavingId, false)
    MeetingStageSession.error = 'connect'
  }

  captureOriginAllowed(origin: string): boolean {
    return origin === mediaOrigin || origin === mediaOrigin + '/' || origin === mediaURL
  }

  requestScreenCapture(handler: ScreenCaptureHandler): void {
    // The bridge allows this only while the current share's getDisplayMedia request is pending.
    if (MeetingStageSession.host !== this || !MeetingStageSession.isConnected() ||
      !MeetingStageSession.captureArmed || !MeetingStageSession.captureAllowed ||
      !this.captureOriginAllowed(handler.getOrigin())) {
      handler.deny()
      return
    }
    MeetingStageSession.captureArmed = false
    try {
      handler.grant({ captureMode: WebCaptureMode.HOME_SCREEN })
    } catch (_) {
      MeetingStageSession.shareError = 'screen_capture_permission'
      MeetingStageSession.stopShare()
      try { handler.deny() } catch (_) {}
    }
  }

  async send(command: Command): Promise<void> {
    if (!this.ready) return
    const id = command.id
    const encoded = JSON.stringify(command)
    // The join credential is consumed once by the local page.
    command.token = undefined
    try {
      await this.controller.runJavaScript('window.meetingMedia.dispatch(' + encoded + ')')
    } catch (_) {
      if (command.type === 'disconnect') {
        this.completeLeave(id, false)
        return
      }
      if (MeetingStageSession.host !== this || MeetingStageSession.id !== id) return
      if (command.type === 'connect') MeetingStageSession.error = 'connect'
      if (command.type === 'prepareShare') {
        MeetingStageSession.shareFailed(command.shareId ?? 0, 'screen_capture_failed')
      }
    }
  }

  control(command: Command): void {
    this.tasks = this.tasks.then(async () => {
      if (MeetingStageSession.host !== this || MeetingStageSession.id !== command.id) return
      if (command.type === 'speaker') {
        if (!MeetingStageSession.isConnected()) return
        const applied = await MeetingStageSession.setSpeakerRoute(command.on === true, command.id)
        if (!applied && MeetingStageSession.host === this && MeetingStageSession.id === command.id &&
            MeetingStageSession.isConnected()) MeetingStageSession.controlError = command.type
        return
      }
      if (command.on && (command.type === 'mic' || command.type === 'camera')) {
        const allowed = command.type === 'mic' ? MeetingStageSession.micAllowed : MeetingStageSession.cameraAllowed
        if (!allowed) {
          // 主持人撤了发布权限（禁止发言 / 未授权摄像头）：这不是设备故障，
          // 用 *_denied 区分开，页面才能给出「已禁言」而不是泛化的「操作失败」。
          if (MeetingStageSession.host === this && MeetingStageSession.id === command.id) {
            MeetingStageSession.controlError = command.type + '_denied'
          }
          return
        }
        if (!MeetingStageSession.isAppForeground()) throw new Error('media permission')
        const permission: Permissions = command.type === 'mic' ? 'ohos.permission.MICROPHONE' : 'ohos.permission.CAMERA'
        const manager = abilityAccessCtrl.createAtManager()
        if (manager.checkAccessTokenSync(this.context.applicationInfo.accessTokenId, permission) !== 0) {
          const result = await manager.requestPermissionsFromUser(this.context, [permission])
          if (result.authResults[0] !== 0) throw new Error('permission')
        }
      }
      if (MeetingStageSession.host === this && MeetingStageSession.id === command.id) await this.send(command)
    }).catch(() => {
      if (MeetingStageSession.id === command.id) MeetingStageSession.controlError = command.type
    })
  }

  readSpeaker(): boolean {
    try {
      // 会议里音频走应用级 AudioSession：有会话时以它记录的输出设备为准。
      const manager = audio.getAudioManager()
      const session = manager.getSessionManager()
      if (session.isAudioSessionActivated()) {
        const device = session.getDefaultOutputDevice()
        if (device !== audio.DeviceType.DEFAULT) {
          MeetingStageSession.speaker = device === audio.DeviceType.SPEAKER
          return true
        }
      }
      // 还没切过（没有会话/未设置）时退回系统当前通信路由，给图标一个初始值。
      MeetingStageSession.speaker = manager.getRoutingManager().isCommunicationDeviceActiveSync(
        audio.CommunicationDeviceType.SPEAKER)
      return true
    } catch (_) {
      return false
    }
  }

  captureResourceAllowed(resource: string): boolean {
    if (MeetingStageSession.host !== this || !MeetingStageSession.isConnected()) return false
    const manager = abilityAccessCtrl.createAtManager()
    const token = this.context.applicationInfo.accessTokenId
    if (resource === ProtectedResourceType.AUDIO_CAPTURE) return MeetingStageSession.micAllowed &&
      manager.checkAccessTokenSync(token, 'ohos.permission.MICROPHONE') === 0
    if (resource === ProtectedResourceType.VIDEO_CAPTURE) return MeetingStageSession.cameraAllowed &&
      manager.checkAccessTokenSync(token, 'ohos.permission.CAMERA') === 0
    return false
  }
}

export class MeetingStageMount extends NodeController {
  readonly id: number
  private host: MeetingStageHost
  private attached: boolean = true

  constructor(id: number, host: MeetingStageHost) {
    super()
    this.id = id
    this.host = host
  }

  makeNode(context: UIContext): FrameNode | null {
    return this.attached ? this.host.frame(context) : null
  }

  aboutToAppear(): void {
    if (!this.attached) return
    this.host.keepActive()
  }

  detach(): void {
    this.attached = false
    try { this.rebuild() } catch (_) {}
    // Keep the Web page and room alive when the in-app meeting view is popped.
    this.host.keepActive()
  }
}

@Builder
export function buildMeetingMount(mount: MeetingStageMount) {
  NodeContainer(mount).width('100%').height('100%')
}

@Component
struct MeetingStageWeb {
  host: MeetingStageHost = MeetingStageSession.host as MeetingStageHost

  build() {
    Web({ src: mediaURL, controller: this.host.controller })
      .width('100%').height('100%')
      .javaScriptAccess(true).domStorageAccess(false).fileAccess(false).mediaPlayGestureAccess(false)
      .javaScriptProxy({ object: this.host, name: 'NuwaxMeeting', methodList: ['postMessage'], controller: this.host.controller })
      .onLoadIntercept((event) => {
        const url = event.data.getRequestUrl()
        return event.data.isMainFrame() && !this.host.isAsset(url, 'media.html')
      })
      .onInterceptRequest((event) => this.host.assetResponse(event.request.getRequestUrl()))
      .onPageEnd((event) => { this.host.loaded(event.url) })
      .onRenderExited((_event) => { this.host.rendererExited() })
      .onScreenCaptureRequest((event) => { this.host.requestScreenCapture(event.handler) })
      .onPermissionRequest((event) => {
        if (!this.host.captureOriginAllowed(event.request.getOrigin())) {
          event.request.deny()
          return
        }
        const resources = event.request.getAccessibleResource().filter((resource) => this.host.captureResourceAllowed(resource))
        if (resources.length > 0) event.request.grant(resources)
        else event.request.deny()
      })
  }
}

@Builder
function buildMeetingStage(host: MeetingStageHost) {
  MeetingStageWeb({ host: host })
}
