import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit'
import { webview } from '@kit.ArkWeb'
import { audio } from '@kit.AudioKit'
import { util } from '@kit.ArkTS'

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
}

interface MeetingMessage {
  text: string
  name: string
  identity: string
  self: boolean
  topic: string
  at: number
}

interface BrowserEvent {
  type: string
  id: number
  connection?: string
  people?: number
  mic?: boolean
  camera?: boolean
  level?: number
  raised?: boolean
  metadata?: string
  videos?: string
  shared?: boolean
  sharing?: boolean
  awaitingCapture?: boolean
  error?: string
  message?: MeetingMessage
}

export class MeetingStageSession {
  static host: MeetingStageHost | undefined
  static pending: Command | undefined
  static id: number = 0
  static connection: string = ''
  static error: string = ''
  static controlError: string = ''
  static mic: boolean = false
  static camera: boolean = false
  static speaker: boolean = true
  static shared: boolean = false
  static sharing: boolean = false
  static awaitingCapture: boolean = false
  static shareError: string = ''
  static captureArmed: boolean = false
  static people: number = 0
  static level: number = 0
  static raised: boolean = false
  static metadata: string = ''
  static videos: string = ''
  static messages: MeetingMessage[] = []

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
    if (!command || !host?.ready) return
    MeetingStageSession.pending = undefined
    host.send(command)
  }

  static disconnect(): void {
    const command = new Command()
    command.type = 'disconnect'
    command.id = MeetingStageSession.id
    MeetingStageSession.host?.send(command)
    MeetingStageSession.id += 1
    MeetingStageSession.pending = undefined
    MeetingStageSession.connection = ''
    MeetingStageSession.error = ''
    MeetingStageSession.controlError = ''
    MeetingStageSession.mic = false
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
    MeetingStageSession.metadata = ''
    MeetingStageSession.videos = ''
    MeetingStageSession.messages = []
  }

  static isConnected(): boolean {
    const state = MeetingStageSession.connection
    return state === 'connected' || state === 'reconnecting' || state === 'signalReconnecting'
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

  static prepareShare(label: string, cancel: string): void {
    if (!MeetingStageSession.isConnected() || !MeetingStageSession.host?.screenSupported) return
    const command = new Command()
    command.type = 'prepareShare'
    command.id = MeetingStageSession.id
    command.text = label
    command.name = cancel
    MeetingStageSession.shareError = ''
    MeetingStageSession.captureArmed = true
    MeetingStageSession.host?.send(command)
  }

  static stopShare(): void {
    MeetingStageSession.captureArmed = false
    const command = new Command()
    command.type = 'stopShare'
    command.id = MeetingStageSession.id
    MeetingStageSession.host?.send(command)
  }

  static receive(event: BrowserEvent): void {
    if (event.id !== MeetingStageSession.id) return
    if (event.type === 'state') {
      if (event.connection === 'connected' && MeetingStageSession.connection === 'connecting') {
        MeetingStageSession.host?.readSpeaker(event.id)
      }
      MeetingStageSession.connection = event.connection ?? ''
      MeetingStageSession.people = event.people ?? 0
      MeetingStageSession.mic = event.mic === true
      MeetingStageSession.camera = event.camera === true
      MeetingStageSession.level = event.level ?? 0
      MeetingStageSession.raised = event.raised === true
      MeetingStageSession.metadata = event.metadata ?? ''
      MeetingStageSession.videos = event.videos ?? ''
      MeetingStageSession.shared = event.shared === true
      MeetingStageSession.sharing = event.sharing === true
      MeetingStageSession.awaitingCapture = event.awaitingCapture === true
    } else if (event.type === 'shareError') {
      MeetingStageSession.captureArmed = false
      MeetingStageSession.shareError = event.error ?? ''
    } else if (event.type === 'message' && event.message) {
      if (MeetingStageSession.messages.length >= 100) MeetingStageSession.messages.shift()
      MeetingStageSession.messages.push(event.message)
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
  private tasks: Promise<void> = Promise.resolve()

  constructor(context: common.UIAbilityContext) {
    this.context = context
  }

  postMessage(raw: string): void {
    if (MeetingStageSession.host !== this || !this.ready || raw.length > 16384) return
    try { MeetingStageSession.receive(JSON.parse(raw) as BrowserEvent) } catch (_) {}
  }

  loaded(url: string): void {
    if (!this.isAsset(url, 'media.html')) return
    const probe = 'typeof window.meetingMedia?.dispatch === "function" ? (typeof navigator.mediaDevices?.getDisplayMedia === "function" ? 2 : 1) : 0'
    this.controller.runJavaScript(probe).then((result) => {
      if (MeetingStageSession.host !== this) return
      this.ready = result === '1' || result === '2'
      this.screenSupported = result === '2'
      if (this.ready) MeetingStageSession.flush()
      else MeetingStageSession.error = 'connect'
    }).catch(() => {
      if (MeetingStageSession.host === this) MeetingStageSession.error = 'connect'
    })
  }

  isAsset(url: string, name: string): boolean {
    return url === mediaOrigin + '/' + name
  }

  assetResponse(url: string): WebResourceResponse | null {
    const html = this.isAsset(url, 'media.html')
    if (!html && !this.isAsset(url, 'room.js')) return null
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
    } catch (_) { return null }
  }

  rendererExited(): void {
    if (MeetingStageSession.host !== this) return
    this.ready = false
    this.screenSupported = false
    MeetingStageSession.disconnect()
    MeetingStageSession.error = 'connect'
  }

  captureOriginAllowed(origin: string): boolean {
    return origin === mediaOrigin || origin === mediaOrigin + '/' || origin === mediaURL
  }

  requestScreenCapture(handler: ScreenCaptureHandler): void {
    if (MeetingStageSession.host !== this || !MeetingStageSession.isConnected() ||
      !MeetingStageSession.captureArmed || !this.captureOriginAllowed(handler.getOrigin())) {
      handler.deny()
      return
    }
    MeetingStageSession.captureArmed = false
    try {
      handler.grant({ captureMode: WebCaptureMode.HOME_SCREEN })
    } catch (_) {
      MeetingStageSession.shareError = 'screen_capture_permission'
      handler.deny()
    }
  }

  send(command: Command): void {
    if (!this.ready) return
    const id = command.id
    const encoded = JSON.stringify(command)
    this.controller.runJavaScript('window.meetingMedia.dispatch(' + encoded + ')').catch(() => {
      if (MeetingStageSession.host === this && MeetingStageSession.id === id && command.type === 'connect') {
        MeetingStageSession.error = 'connect'
      }
    })
    // The join credential is consumed once by the local page.
    command.token = undefined
  }

  control(command: Command): void {
    this.tasks = this.tasks.then(async () => {
      if (MeetingStageSession.host !== this || MeetingStageSession.id !== command.id) return
      if (command.type === 'speaker') {
        await this.routeSpeaker(command.on === true)
        if (MeetingStageSession.id === command.id) MeetingStageSession.speaker = command.on === true
        return
      }
      if (command.on && (command.type === 'mic' || command.type === 'camera')) {
        const permission: Permissions = command.type === 'mic' ? 'ohos.permission.MICROPHONE' : 'ohos.permission.CAMERA'
        const manager = abilityAccessCtrl.createAtManager()
        if (manager.checkAccessTokenSync(this.context.applicationInfo.accessTokenId, permission) !== 0) {
          const result = await manager.requestPermissionsFromUser(this.context, [permission])
          if (result.authResults[0] !== 0) throw new Error('permission')
        }
      }
      if (MeetingStageSession.host === this && MeetingStageSession.id === command.id) this.send(command)
    }).catch(() => {
      if (MeetingStageSession.id === command.id) MeetingStageSession.controlError = command.type
    })
  }

  readSpeaker(id: number): void {
    audio.getAudioManager().getRoutingManager().isCommunicationDeviceActive(audio.CommunicationDeviceType.SPEAKER)
      .then((on) => {
        if (MeetingStageSession.host === this && MeetingStageSession.id === id) MeetingStageSession.speaker = on
      }).catch(() => {})
  }

  private async routeSpeaker(on: boolean): Promise<void> {
    await audio.getAudioManager().getRoutingManager().setCommunicationDevice(audio.CommunicationDeviceType.SPEAKER, on)
  }

  captureResourceAllowed(resource: string): boolean {
    if (MeetingStageSession.host !== this || !MeetingStageSession.isConnected()) return false
    const manager = abilityAccessCtrl.createAtManager()
    const token = this.context.applicationInfo.accessTokenId
    if (resource === ProtectedResourceType.AUDIO_CAPTURE) return manager.checkAccessTokenSync(token, 'ohos.permission.MICROPHONE') === 0
    if (resource === ProtectedResourceType.VIDEO_CAPTURE) return manager.checkAccessTokenSync(token, 'ohos.permission.CAMERA') === 0
    return false
  }
}

@Component
struct MeetingStageWeb {
  host: MeetingStageHost

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
export function buildMeetingStage(host: MeetingStageHost) {
  MeetingStageWeb({ host: host })
}
