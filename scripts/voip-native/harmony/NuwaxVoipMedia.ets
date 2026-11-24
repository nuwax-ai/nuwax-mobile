import { webview } from '@kit.ArkWeb'
import { abilityAccessCtrl } from '@kit.AbilityKit'
import { VoipBridge } from '@uni_modules/nuwax-voip'

class MediaProxy { postMessage(raw: string): void { VoipBridge.mediaEvent(raw) } }

@Component
struct NuwaxCallControl {
  @Prop icon: string = ''
  @Prop label: string = ''
  @Prop tone: string = 'default'
  @Prop selected: boolean = false
  @Prop large: boolean = false
  @Prop dense: boolean = false
  onPress: () => void = () => {}

  build() {
    Button({ type: ButtonType.Normal, stateEffect: true }) {
      Column() {
        Row() {
          Image($rawfile('voip/call-icons/' + this.icon + (this.selected ? '-ink.png' : '-white.png')))
            .width(30).height(30).objectFit(ImageFit.Contain)
        }
        .justifyContent(FlexAlign.Center).width(this.large ? 72 : 62).height(this.large ? 72 : 62)
        .borderRadius(this.large ? 36 : 31)
        .backgroundColor(this.tone === 'danger' ? '#EE4D5A' : this.tone === 'success' ? '#16B866' :
          this.selected ? Color.White : '#24FFFFFF')
        Text(this.label).fontColor(Color.White).fontSize(this.dense ? 12 : 13).textAlign(TextAlign.Center)
          .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis }).margin({ top: 12 })
      }.width('100%').height('100%')
    }
    .padding(0).backgroundColor(Color.Transparent).borderRadius(18)
    .width(this.dense ? 72 : this.large ? 96 : 88).height(114)
    .accessibilityText(this.label).onClick(() => this.onPress())
  }
}

@Entry
@Component
struct NuwaxVoipMedia {
  private web: webview.WebviewController = new webview.WebviewController()
  private proxy: MediaProxy = new MediaProxy()
  private timer = -1
  private closeTimer = -1
  private visible = false
  private displayedCallId = ''
  @State private lastPeer: string = ''
  @State private lastVideo: boolean = false
  @State private avatar: string = ''
  @State private avatarFailed: boolean = false
  @State private revision: number = 0
  private listener: () => void = () => { this.refreshCall() }

  aboutToAppear(): void {
    VoipBridge.controller = this.web
    VoipBridge.mediaReady = false
    VoipBridge.listeners.push(this.listener)
    this.refreshCall()
  }

  onPageShow(): void {
    this.visible = true
    this.refreshCall()
    if (this.timer < 0) this.timer = setInterval(() => { this.revision++ }, 1000)
  }

  onPageHide(): void {
    this.visible = false
    if (this.timer >= 0) clearInterval(this.timer)
    this.timer = -1
    this.cancelClose()
  }

  aboutToDisappear(): void {
    this.onPageHide()
    VoipBridge.listeners = VoipBridge.listeners.filter(callback => callback !== this.listener)
  }

  private cancelClose(): void {
    if (this.closeTimer >= 0) clearTimeout(this.closeTimer)
    this.closeTimer = -1
  }

  private refreshCall(): void {
    const call = VoipBridge.current
    if (call) {
      this.cancelClose()
      this.displayedCallId = call.callId
      const outgoing = call.callerId === VoipBridge.configuration?.userId
      this.lastPeer = (outgoing ? call.calleeDisplayName : call.callerDisplayName) || call.displayName
      this.lastVideo = call.mediaType === 'video'
      const avatar = (outgoing ? call.calleeAvatar : call.callerAvatar) ?? ''
      if (avatar !== this.avatar) {
        this.avatar = avatar
        this.avatarFailed = false
      }
    } else if (this.visible && this.displayedCallId && this.closeTimer < 0) {
      this.closeTimer = setTimeout(() => {
        this.closeTimer = -1
        if (this.visible && !VoipBridge.current) this.minimize()
      }, 3000)
    }
    this.revision++
  }

  private label(key: string): string {
    this.revision
    return VoipBridge.configuration?.labels?.[key] ?? ''
  }

  private phase(): string {
    this.revision
    const call = VoipBridge.current
    if (!call) return 'ended'
    if (call.state === 'ringing') return call.calleeId === VoipBridge.configuration?.userId ? 'incoming' : 'dialing'
    if (VoipBridge.reconnecting) return 'reconnecting'
    if (call.state === 'active' && VoipBridge.connected && VoipBridge.peerReady) return 'active'
    return 'connecting'
  }

  private status(): string {
    if (this.phase() !== 'active') return this.label(this.phase())
    const seconds = Math.max(0, Math.floor((Date.now() - (VoipBridge.current?.connectedAt ?? Date.now())) / 1000))
    return `${Math.floor(seconds / 60)}`.padStart(2, '0') + ':' + `${seconds % 60}`.padStart(2, '0')
  }

  private peerName(): string {
    this.revision
    return this.lastPeer || this.label('title')
  }

  private showVideo(): boolean {
    const phase = this.phase()
    return this.lastVideo && (phase === 'connecting' || phase === 'reconnecting' || phase === 'active')
  }

  private microphone(): boolean {
    this.revision
    return VoipBridge.microphone
  }

  private camera(): boolean {
    this.revision
    return VoipBridge.camera
  }

  private speaker(): boolean {
    this.revision
    return VoipBridge.speakerEnabled
  }

  private sendControl(op: string, enabled?: boolean): void {
    VoipBridge.execute(JSON.stringify({
      op, enabled, scope: VoipBridge.configuration?.scope, callId: VoipBridge.current?.callId
    }))
  }

  private leaveCall(): void {
    VoipBridge.action(this.phase() === 'incoming' ? 'reject' : this.phase() === 'dialing' ? 'cancel' : 'end')
  }

  private minimize(): void {
    this.cancelClose()
    if (!VoipBridge.current) this.displayedCallId = ''
    VoipBridge.emit('minimize')
    const context = VoipBridge.mediaContext
    if (context) context.startAbility({
      bundleName: context.abilityInfo.bundleName,
      moduleName: context.abilityInfo.moduleName,
      abilityName: 'EntryAbility'
    }).catch(() => {})
  }

  onBackPress(): boolean {
    this.minimize()
    return true
  }

  @Builder private header() {
    Row() {
      Button({ type: ButtonType.Normal, stateEffect: true }) {
        Row({ space: 7 }) {
          Image($rawfile('voip/call-icons/minimize-white.png')).width(20).height(20)
          Text(this.label('minimize')).fontSize(12).fontColor('#B3FFFFFF').maxLines(1)
        }.width('100%').alignItems(VerticalAlign.Center)
      }.padding(0).width(104).height(44).backgroundColor(Color.Transparent)
        .accessibilityText(this.label('minimize')).onClick(() => this.minimize())
      Text(this.label(this.lastVideo ? 'video' : 'audio')).layoutWeight(1)
        .fontSize(13).fontColor('#99FFFFFF').textAlign(TextAlign.Center).maxLines(1)
      Blank().width(104).height(44)
    }.width('100%').height(48).alignItems(VerticalAlign.Center).padding({ left: 16, right: 16 })
  }

  @Builder private identity() {
    Column() {
      if (!this.showVideo()) {
        Stack() {
          Stack() {
            Text(this.peerName().slice(0, 1)).fontSize(44).fontWeight(FontWeight.Medium).fontColor('#F0F5F2')
            if (this.avatar.startsWith('https://') && !this.avatarFailed) {
              Image(this.avatar).width('100%').height('100%').objectFit(ImageFit.Cover)
                .onError(() => { this.avatarFailed = true })
            }
          }.width(104).height(104).backgroundColor('#71867C').borderRadius(24).clip(true)
        }.width(116).height(116).border({ width: 1, color: '#1AFFFFFF', radius: 30 }).margin({ bottom: 25 })
      }
      Text(this.peerName()).width('100%').fontSize(this.showVideo() ? 20 : 28).fontWeight(FontWeight.Bold)
        .fontColor(Color.White).textAlign(this.showVideo() ? TextAlign.Start : TextAlign.Center)
        .maxLines(2).textOverflow({ overflow: TextOverflow.Ellipsis })
      Row({ space: 9 }) {
        if (this.phase() !== 'ended') {
          Circle().width(5).height(5).fill(this.phase() === 'active' ? '#32D68A' : '#C4D2CA')
        }
        Text(this.status()).fontSize(this.phase() === 'active' ? 20 : 15)
          .fontColor(this.phase() === 'active' ? Color.White : '#ADFFFFFF')
      }.height(24).margin({ top: 14 })
    }.width('100%').alignItems(this.showVideo() ? HorizontalAlign.Start : HorizontalAlign.Center)
      .padding({ top: this.showVideo() ? 14 : 48, left: 28, right: this.showVideo() ? 128 : 28 })
  }

  @Builder private callDock() {
    Column() {
      if (this.phase() === 'incoming') {
        Row() {
          NuwaxCallControl({
            icon: 'hangup', label: this.label('reject'), tone: 'danger', large: true,
            onPress: () => this.leaveCall()
          })
          NuwaxCallControl({
            icon: 'phone', label: this.label('answerAudio'), tone: this.lastVideo ? 'default' : 'success', large: true,
            onPress: () => { VoipBridge.action('accept', 'audio') }
          })
          if (this.lastVideo) {
            NuwaxCallControl({
              icon: 'video', label: this.label('answerVideo'), tone: 'success', large: true,
              onPress: () => { VoipBridge.action('accept', 'video') }
            })
          }
        }.width('100%').justifyContent(FlexAlign.SpaceBetween)
          .padding({ left: this.lastVideo ? 0 : 18, right: this.lastVideo ? 0 : 18 })
      } else if (this.phase() === 'ended') {
        NuwaxCallControl({
          icon: 'close', label: this.label('close') || this.label('minimize'), large: true,
          onPress: () => this.minimize()
        })
      } else {
        if (this.lastVideo) {
          Row() {
            this.microphoneControl(true)
            NuwaxCallControl({
              icon: this.camera() ? 'video' : 'video-off', label: this.label(this.camera() ? 'cameraOff' : 'cameraOn'),
              selected: !this.camera(), dense: true, onPress: () => this.sendControl('camera', !this.camera())
            })
            NuwaxCallControl({
              icon: 'switch-camera', label: this.label('switchCamera'), dense: true,
              onPress: () => this.sendControl('switchCamera')
            })
            this.speakerControl(true)
          }.width('100%').justifyContent(FlexAlign.SpaceBetween).margin({ bottom: 10 })
        }
        Row() {
          if (!this.lastVideo) {
            this.microphoneControl(false)
          }
          NuwaxCallControl({
            icon: 'hangup', label: this.label('hangup'), tone: 'danger', large: true,
            onPress: () => this.leaveCall()
          })
          if (!this.lastVideo) {
            this.speakerControl(false)
          }
        }.width('100%').justifyContent(this.lastVideo ? FlexAlign.Center : FlexAlign.SpaceBetween)
      }
    }.width('100%').constraintSize({ maxWidth: 420 }).padding({ left: 16, right: 16, bottom: 12 })
  }

  @Builder private microphoneControl(dense: boolean) {
    NuwaxCallControl({
      icon: this.microphone() ? 'microphone' : 'microphone-off', label: this.label(this.microphone() ? 'mute' : 'unmute'),
      selected: !this.microphone(), dense: dense, onPress: () => this.sendControl('microphone', !this.microphone())
    })
  }

  @Builder private speakerControl(dense: boolean) {
    NuwaxCallControl({
      icon: 'speaker', label: this.label(this.speaker() ? 'earpiece' : 'speaker'), selected: this.speaker(),
      dense: dense, onPress: () => this.sendControl('speaker', !this.speaker())
    })
  }

  build() {
    Stack({ alignContent: Alignment.Bottom }) {
      Web({ src: $rawfile('voip/media.html'), controller: this.web })
        .width('100%').height('100%').opacity(this.showVideo() ? 1 : 0)
        .javaScriptAccess(true).fileAccess(true).domStorageAccess(false).mediaPlayGestureAccess(false)
        .javaScriptProxy({ object: this.proxy, name: 'NuwaxVoip', methodList: ['postMessage'], controller: this.web })
        .onLoadIntercept(event => { return !event.data.getRequestUrl().startsWith('resource://') && !event.data.getRequestUrl().startsWith('file://') })
        .onPermissionRequest(event => {
          const context = VoipBridge.mediaContext, call = VoipBridge.current, config = VoipBridge.configuration
          if (!context || !call || call.callId !== VoipBridge.mediaId) { event.request.deny(); return }
          const outgoingSetup = call.state === 'ringing' && VoipBridge.business() &&
            call.callerId === config?.userId && call.callerDeviceId === config?.deviceId
          if (!outgoingSetup && !['connecting', 'active'].includes(call.state)) { event.request.deny(); return }
          const manager = abilityAccessCtrl.createAtManager(), token = context.applicationInfo.accessTokenId
          const resources = event.request.getAccessibleResource().filter(resource => {
            if (resource === ProtectedResourceType.AUDIO_CAPTURE) return manager.checkAccessTokenSync(token, 'ohos.permission.MICROPHONE') === 0
            if (resource === ProtectedResourceType.VIDEO_CAPTURE) return call.mediaType === 'video' && manager.checkAccessTokenSync(token, 'ohos.permission.CAMERA') === 0
            return false
          })
          if (resources.length > 0) event.request.grant(resources); else event.request.deny()
        })
      if (this.showVideo()) {
        Column().width('100%').height(320).linearGradient({
          direction: GradientDirection.Bottom, colors: [[Color.Transparent, 0], ['#D9000000', 1]]
        }).hitTestBehavior(HitTestMode.None)
      }
      Column() {
        this.header()
        this.identity()
        Blank()
        this.callDock()
      }.width('100%').height('100%')
    }.width('100%').height('100%').linearGradient({ direction: GradientDirection.Bottom, colors: [['#46534F', 0], ['#202827', 1]] })
  }
}
