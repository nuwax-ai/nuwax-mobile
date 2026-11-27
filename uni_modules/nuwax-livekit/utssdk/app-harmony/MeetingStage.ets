import { abilityAccessCtrl, common, Permissions, Want } from '@kit.AbilityKit'
import { webview } from '@kit.ArkWeb'
import { audio } from '@kit.AudioKit'
import { util } from '@kit.ArkTS'
import { http } from '@kit.NetworkKit'
import { BuilderNode, FrameNode, NodeController, UIContext } from '@kit.ArkUI'
import { BusinessError } from '@kit.BasicServicesKit'
import { EntryVoipBackgroundTask } from './EntryVoipBackgroundTask.ets'

export const meetingAsset = 'nuwax-meeting/media.html'
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

  static setStagePresentation(mountId: number, presentation: string): void {
    if (MeetingStageSession.mount?.id === mountId) MeetingStageSession.host?.setStagePresentation(presentation)
  }

  static consumeStageTap(mountId: number): string {
    if (MeetingStageSession.mount?.id !== mountId) return ''
    const tap = MeetingStageSession.stageTap
    MeetingStageSession.stageTap = ''
    return tap
  }

  static attach(context: common.UIAbilityContext, pipLabel: string): MeetingStageMount {
    MeetingStageSession.mount?.detach()
    MeetingStageSession.stageTap = ''
    const host = MeetingStageSession.host ?? new MeetingStageHost(context)
    MeetingStageSession.host = host
    host.setPictureInPictureLabel(pipLabel)
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
    MeetingStageSession.flush()
  }

  static flush(): void {
    const command = MeetingStageSession.pending
    const host = MeetingStageSession.host
    if (!command || !host?.ready || host.leaving) return
    MeetingStageSession.pending = undefined
    host.send(command)
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
  private pipLabel: string = ''
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

  setPictureInPictureLabel(label: string): void {
    this.pipLabel = label
    if (this.ready) this.controller.runJavaScript('window.meetingMedia.setPictureInPictureLabel(' + JSON.stringify(label) + ')').catch(() => {})
  }

  setStagePresentation(presentation: string): void {
    this.stagePresentation = presentation
    if (this.ready && presentation.length > 0) {
      this.controller.runJavaScript('window.meetingMedia.setStagePresentation(' +
        JSON.stringify(presentation) + ')').catch(() => {})
    }
  }

  closePictureInPicture(): void {
    if (this.ready) this.controller.runJavaScript('if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {})').catch(() => {})
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
        this.setPictureInPictureLabel(this.pipLabel)
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
    const file = html ? meetingAsset : 'nuwax-meeting/room.js'
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
        const on = command.on === true
        const routing = audio.getAudioManager().getRoutingManager()
        await routing.setCommunicationDevice(audio.CommunicationDeviceType.SPEAKER, on)
        // Harmony can resolve setCommunicationDevice before the route query reflects the new device.
        // Confirm it for a short bounded period instead of reporting a successful switch as failed.
        for (let attempt = 0; attempt < 4; attempt++) {
          if (MeetingStageSession.host !== this || MeetingStageSession.id !== command.id ||
              !MeetingStageSession.isConnected()) return
          if (this.readSpeaker() && MeetingStageSession.speaker === on) return
          if (attempt < 3) await new Promise<void>((resolve) => { setTimeout(resolve, 80) })
        }
        if (MeetingStageSession.host === this && MeetingStageSession.id === command.id &&
            MeetingStageSession.isConnected()) MeetingStageSession.controlError = command.type
        return
      }
      if (command.on && (command.type === 'mic' || command.type === 'camera')) {
        const allowed = command.type === 'mic' ? MeetingStageSession.micAllowed : MeetingStageSession.cameraAllowed
        if (!allowed || !MeetingStageSession.isAppForeground()) throw new Error('media permission')
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
      const routing = audio.getAudioManager().getRoutingManager()
      MeetingStageSession.speaker = routing.isCommunicationDeviceActiveSync(audio.CommunicationDeviceType.SPEAKER)
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
    this.host.closePictureInPicture()
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
