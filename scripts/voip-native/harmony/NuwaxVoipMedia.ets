import { webview } from '@kit.ArkWeb'
import { abilityAccessCtrl } from '@kit.AbilityKit'
import { VoipBridge } from '@uni_modules/nuwax-voip'

class MediaProxy { postMessage(raw: string): void { VoipBridge.mediaEvent(raw) } }

@Entry
@Component
struct NuwaxVoipMedia {
  private web: webview.WebviewController = new webview.WebviewController()
  private proxy: MediaProxy = new MediaProxy()
  private timer: number = -1
  @State private revision: number = 0
  private listener: () => void = () => { this.revision++ }
  aboutToAppear(): void {
    VoipBridge.controller = this.web; VoipBridge.mediaReady = false
    VoipBridge.listeners.push(this.listener)
    this.timer = setInterval(() => { this.revision++ }, 1000)
  }
  aboutToDisappear(): void {
    if (this.timer >= 0) clearInterval(this.timer)
    VoipBridge.listeners = VoipBridge.listeners.filter(callback => callback !== this.listener)
  }
  private label(key: string): string { this.revision; return VoipBridge.configuration?.labels?.[key] ?? '' }
  private status(): string {
    this.revision
    const call = VoipBridge.current
    if (!call) return this.label('ended')
    if (!VoipBridge.connected || !VoipBridge.peerReady || call.state !== 'active') return this.label('connecting')
    const seconds = Math.max(0, Math.floor((Date.now() - call.connectedAt) / 1000))
    return `${Math.floor(seconds / 60)}`.padStart(2, '0') + ':' + `${seconds % 60}`.padStart(2, '0')
  }
  private peerName(): string { this.revision; const call = VoipBridge.current; return call?.callerId === VoipBridge.configuration?.userId ? (call?.calleeDisplayName ?? call?.calleeId ?? '') : (call?.callerDisplayName ?? call?.callerId ?? '') }
  private isVideo(): boolean { this.revision; return VoipBridge.current?.mediaType === 'video' }
  private minimize(): void {
    VoipBridge.emit('minimize')
    const context = VoipBridge.mediaContext
    if (context) context.startAbility({ bundleName: context.abilityInfo.bundleName, abilityName: 'EntryAbility' }).catch(() => {})
  }
  onBackPress(): boolean { this.minimize(); return true }
  build() {
    Column({ space: 16 }) {
      Button(this.label('minimize')).onClick(() => this.minimize())
      Text(this.peerName()).fontColor(Color.White).fontSize(24)
      Text(this.status()).fontColor(Color.White)
      Web({ src: $rawfile('voip/media.html'), controller: this.web })
        .width('100%').layoutWeight(1).javaScriptAccess(true).fileAccess(true).domStorageAccess(false).mediaPlayGestureAccess(false)
        .javaScriptProxy({ object: this.proxy, name: 'NuwaxVoip', methodList: ['postMessage'], controller: this.web })
        .onLoadIntercept(event => { return !event.data.getRequestUrl().startsWith('resource://') && !event.data.getRequestUrl().startsWith('file://') })
        .onPermissionRequest(event => {
          const context = VoipBridge.mediaContext, call = VoipBridge.current
          if (!context || !call || !['connecting', 'active'].includes(call.state)) { event.request.deny(); return }
          const manager = abilityAccessCtrl.createAtManager(), token = context.applicationInfo.accessTokenId
          const resources = event.request.getAccessibleResource().filter(resource => {
            if (resource === 'ohos.web.RESOURCE_AUDIO_CAPTURE') return manager.checkAccessTokenSync(token, 'ohos.permission.MICROPHONE') === 0
            if (resource === 'ohos.web.RESOURCE_VIDEO_CAPTURE') return call.mediaType === 'video' && manager.checkAccessTokenSync(token, 'ohos.permission.CAMERA') === 0
            return false
          })
          if (resources.length > 0) event.request.grant(resources); else event.request.deny()
        })
      Row({ space: 10 }) {
        Button(this.label(VoipBridge.microphone ? 'mute' : 'unmute')).onClick(() => {
          VoipBridge.execute(JSON.stringify({ op: 'microphone', scope: VoipBridge.configuration?.scope, callId: VoipBridge.current?.callId, enabled: !VoipBridge.microphone }))
        })
        Button(this.label('speaker')).onClick(() => VoipBridge.speaker(true))
        Button(this.label('earpiece')).onClick(() => VoipBridge.speaker(false))
      }
      if (this.isVideo()) {
        Row({ space: 10 }) {
          Button(this.label(VoipBridge.camera ? 'cameraOff' : 'cameraOn')).onClick(() => VoipBridge.execute(JSON.stringify({ op: 'camera', scope: VoipBridge.configuration?.scope, callId: VoipBridge.current?.callId, enabled: !VoipBridge.camera })))
          Button(this.label('switchCamera')).onClick(() => VoipBridge.media(JSON.stringify({ op: 'switchCamera' })))
        }
      }
      Button(this.label('hangup')).backgroundColor('#d83949').onClick(() => VoipBridge.action('end'))
    }.width('100%').height('100%').padding({ top: 48, bottom: 40, left: 16, right: 16 }).backgroundColor('#151d2c')
  }
}
