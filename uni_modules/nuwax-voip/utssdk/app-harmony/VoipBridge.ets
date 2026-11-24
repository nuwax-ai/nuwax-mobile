import BuildProfile from 'BuildProfile'
import { abilityAccessCtrl, Permissions, bundleManager, common, UIAbility, wantAgent } from '@kit.AbilityKit'
import { http, webSocket } from '@kit.NetworkKit'
import { util } from '@kit.ArkTS'
import { asset } from '@kit.AssetStoreKit'
import { pushService, pushCommon } from '@kit.PushKit'
import { voipCall } from '@kit.CallServiceKit'
import { backgroundTaskManager } from '@kit.BackgroundTasksKit'
import { image } from '@kit.ImageKit'
import { audio } from '@kit.AudioKit'
import { webview } from '@kit.ArkWeb'
import { BusinessError } from '@kit.BasicServicesKit'

export interface CallData {
  callId: string; convId: string; version: number; state: string; callerId: string; calleeId: string;
  callerDeviceId: string; acceptedDeviceId: string; mediaType: string; displayName: string;
  callerDisplayName?: string; calleeDisplayName?: string;
  callerAvatar?: string; calleeAvatar?: string;
  connectExpiresAt?: number; prepareExpiresAt?: number; expiresAt: number; connectedAt: number; reason: string;
  serverUrl?: string; participantToken?: string;
  protocol?: string; roomName?: string; msgId?: string; wsUrl?: string; token?: string;
  convType?: number; peerUserId?: string; peerName?: string; peerAvatar?: string;
  msgType?: string; senderType?: number; senderId?: string; senderAvatar?: string; msgStatus?: number; sendTime?: number;
  body?: InvitationBody; eventType?: string; payload?: SignalBody;
  heartbeatInterval?: number; seq?: number;
}
interface InvitationBody { callId: string; roomName: string; mediaType: string }
interface SignalBody { callId?: string; convId?: string; msgId?: string; userId?: string }
interface ImFrame { op: number; body: CallData }
export class VoipBusinessPolicy {
  static ringDeadline(sendTime: number | undefined, now: number): number {
    return Math.min(sendTime && Number.isFinite(sendTime) && sendTime > 0 ? sendTime : now, now) + 60000
  }
  static isAuthenticationFailure(status: number): boolean { return status === 401 || status === 403 }
  static endAction(caller: boolean, state: string, reason: string): string {
    if (['remoteEnded', 'remoteCancelled', 'answeredElsewhere', 'sessionChanged'].includes(reason)) return ''
    if (caller && ['ringing', 'connecting'].includes(state)) return '/ended'
    return !caller && state === 'ringing' && reason === 'rejected' ? '/declined' : ''
  }
}
interface Configuration {
  scope: string; apiBaseUrl: string; accessToken: string; deviceId: string; userId: string;
  development: boolean; qaAccepted: boolean; businessEnabled?: boolean; protocol?: string; callLabel: string; labels?: Record<string, string>;
  pushEnvironment?: string; background?: boolean;
}
interface Command {
  op: string; convId?: string; msgId?: string; route?: string; scope?: string; callId?: string; snapshot?: CallData; action?: string;
  answerMediaType?: string; enabled?: boolean; hidden?: boolean;
}
interface Envelope { code: string; data: CallData }
interface MediaEvent { type: string; callId?: string; code?: string; enabled?: boolean; fatal?: boolean; released?: boolean }
interface CallEvent extends MediaEvent { scope: string; snapshot?: CallData; reason?: string; nativeIncomingUI?: boolean }
interface PushInvitation {
  type?: string; scene?: string; callId: string; convId: string; msgId: string;
  calleeId: string; expiresAt: number; mediaType: string; displayName?: string;
}
interface PushDelivery { callId: string; data: string; header?: string }
interface PendingIncoming {
  invite: PushInvitation; nativeId: string; timer: number; action: string; answerMediaType: string;
}

/** This module owns the media Ability and control stream; neither belongs to a UTS page. */
export class VoipBridge {
  static context: common.UIAbilityContext | null = null
  static mediaContext: common.UIAbilityContext | null = null
  static nativeVoiceStart: ((context: common.UIAbilityContext, callId: string,
    endpoint: string, token: string, microphone: boolean) => Promise<void>) | null = null
  static nativeVoiceStop: (() => void) | null = null
  static nativeVoiceMute: ((muted: boolean) => void) | null = null
  static nativeVoiceCallId = ''
  static readonly nativeVoiceTestOrigin = 'https://testagent.xspaceagi.com'
  static configuration: Configuration | null = null
  static current: CallData | null = null
  static controller: webview.WebviewController | null = null
  static background = true
  static mediaReady = false
  static connected = false
  static reconnecting = false
  static peerReady = false
  static microphone = true
  static speakerEnabled = false
  static camera = false
  static generation = 0
  static mediaId = ''
  static nativeId = ''
  static answeredNativeId = ''
  static pendingIncoming: PendingIncoming | null = null
  static terminal: Set<string> = new Set()
  static reportedInvitations: Set<string> = new Set()
  static queue: CallEvent[] = []
  static commands: string[] = []
  static socket: webSocket.WebSocket | null = null
  static heartbeat = -1
  static stream: http.HttpRequest | null = null
  static business(): boolean { return VoipBridge.configuration?.protocol === 'im-voip-v1' }
  static parse(text: string): CallData {
    return JSON.parse(text.replace(/("(?:convId|msgId|senderId|userId|peerUserId)"\s*:\s*)([0-9]{16,})(?=[,}\s])/g, '$1"$2"')) as CallData
  }
  static retry = -1
  static expiry = -1
  static cursor = ''
  static readySent = false
  static answering = ''
  static taskWork: Promise<void> = Promise.resolve()
  static taskCallId = ''
  static taskContext: common.UIAbilityContext | null = null
  static systemRegistered = false
  static ability: UIAbility | null = null
  static listeners: Array<() => void> = []
  static readonly prefix = '/api/instant-message/calls'
  static readonly legacySessionAlias = new util.TextEncoder().encodeInto('nuwax-voip-context')
  static readonly sessionAlias = new util.TextEncoder().encodeInto('nuwax-voip-context-v2')
  static readonly sessionSecretBytes = 1024
  static readonly sessionLabelBytes = 2048
  static readonly sessionLabels: asset.Tag[] = [
    asset.Tag.DATA_LABEL_NORMAL_1, asset.Tag.DATA_LABEL_NORMAL_2,
    asset.Tag.DATA_LABEL_NORMAL_3, asset.Tag.DATA_LABEL_NORMAL_4
  ]

  static emit(type: string, code: string = '', snapshot?: CallData, reason: string = '', enabled?: boolean): void {
    const event: CallEvent = { type, code, scope: VoipBridge.configuration?.scope ?? '',
      callId: VoipBridge.current?.callId ?? '', snapshot, reason, enabled,
      nativeIncomingUI: !!VoipBridge.nativeId && snapshot !== undefined && snapshot.calleeId === VoipBridge.configuration?.userId }
    VoipBridge.queue.push(event)
    if (VoipBridge.queue.length > 256) VoipBridge.queue.shift()
    VoipBridge.listeners.forEach(callback => callback())
  }
  static drain(): string { const result = JSON.stringify(VoipBridge.queue); VoipBridge.queue = []; return result }
  static execute(raw: string): void {
    try {
      const command = JSON.parse(raw) as Command
      if (command.op === 'reset') { VoipBridge.reset(); return }
      if (command.op === 'initialize') { VoipBridge.initialize(JSON.parse(raw) as Configuration); return }
      if (command.scope !== VoipBridge.configuration?.scope) return
      if (['action', 'microphone', 'camera', 'speaker', 'audioRoute', 'switchCamera'].includes(command.op) && command.callId !== VoipBridge.current?.callId) return
      if (command.op === 'invitation' && VoipBridge.business()) { VoipBridge.request(`/api/instant-message/messages/${command.msgId}?convId=${command.convId}`, '', true).then(message => VoipBridge.receiveInvitation(message)).catch(() => VoipBridge.emit('error', 'CALL_INVITATION_FAILED')); return }
      if (command.op === 'watch' && command.snapshot) VoipBridge.adopt(command.snapshot)
      else if (command.op === 'action') VoipBridge.action(command.action ?? '', command.answerMediaType ?? 'audio')
      else if (command.op === 'audioRoute') {
        if (command.route === 'speaker' || command.route === 'earpiece' || command.route === 'auto') VoipBridge.speaker(command.route === 'speaker')
        else VoipBridge.emit('error', 'CALL_AUDIO_ROUTE_UNAVAILABLE')
      }
      else if (command.op === 'speaker') VoipBridge.speaker(command.enabled === true)
      else if (command.op === 'showMedia') VoipBridge.showMedia()
      else if (command.op === 'camera') VoipBridge.setCamera(command.enabled === true)
      else if (command.op === 'background') {
        VoipBridge.background = command.hidden === true
        // EntryAbility hiding while the call Ability opens is not a camera-background event.
        if (VoipBridge.mediaContext == null) VoipBridge.media(raw)
      }
      else {
        if (command.op === 'microphone') VoipBridge.microphone = command.enabled === true
        if (command.op === 'camera') VoipBridge.camera = command.enabled === true
        VoipBridge.media(raw)
        if (command.op === 'microphone' || command.op === 'camera') VoipBridge.emit(command.op, '', undefined, '', command.enabled)
      }
    } catch (_) { VoipBridge.emit('error', 'CALL_NATIVE_FAILED') }
  }
  static initialize(config: Configuration, restoring: boolean = false): void {
    if ((!config.development && !config.qaAccepted && !config.businessEnabled) || !config.accessToken || !config.userId ||
      (!config.apiBaseUrl.startsWith('https://') && !(config.development && config.apiBaseUrl.startsWith('http://')))) return
    if ((config.development || (config.businessEnabled && !config.qaAccepted)) && !BuildProfile.DEBUG) return
    const previous = VoipBridge.configuration
    if (previous && (previous.userId !== config.userId || previous.apiBaseUrl !== config.apiBaseUrl || previous.deviceId !== config.deviceId)) VoipBridge.reset()
    VoipBridge.configuration = config
    VoipBridge.background = restoring || config.background === true
    if (!restoring) VoipBridge.saveSession(config)
    if (!VoipBridge.systemRegistered) {
      voipCall.on('voipCallUiEvent', info => VoipBridge.systemEvent(info))
      VoipBridge.systemRegistered = true
    }
    VoipBridge.startStream()
    const run = VoipBridge.generation
    if (!VoipBridge.business()) pushService.getToken().then(async token => {
      if (run !== VoipBridge.generation || VoipBridge.configuration !== config) return
      const bundleId = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT).name
      await VoipBridge.request('/devices', JSON.stringify({ channel: 'harmonyPush', token, bundleId,
        environment: config.pushEnvironment ?? (config.development ? 'development' : 'production') }))
    }).catch(() => {})
    if (VoipBridge.current) {
      VoipBridge.emit('snapshot', '', VoipBridge.current)
      if (VoipBridge.connected) VoipBridge.emit('connected')
      if (VoipBridge.peerReady) VoipBridge.emit('peerMediaReady')
    }
  }
  static sessionQuery(encrypted: boolean): asset.AssetMap {
    const query: asset.AssetMap = new Map()
    query.set(asset.Tag.ALIAS, encrypted ? VoipBridge.sessionAlias : VoipBridge.legacySessionAlias)
    if (encrypted) query.set(asset.Tag.REQUIRE_ATTR_ENCRYPTED, true)
    return query
  }
  static saveSession(config: Configuration): void {
    const bytes = new util.TextEncoder().encodeInto(JSON.stringify(config))
    const firstBytes = VoipBridge.sessionSecretBytes - 1
    const remaining = Math.ceil(Math.max(0, bytes.length - firstBytes) / VoipBridge.sessionLabelBytes)
    if (remaining > VoipBridge.sessionLabels.length) {
      VoipBridge.traceIncoming(`sessionTooLarge bytes=${bytes.length}`)
      VoipBridge.emit('error', 'CALL_SECURE_STORAGE_FAILED')
      return
    }
    // Store all segments in one encrypted asset. The first byte records how many labels the session needs.
    const secret = new Uint8Array(Math.min(bytes.length, firstBytes) + 1)
    secret[0] = remaining
    secret.set(bytes.subarray(0, firstBytes), 1)
    const attributes = VoipBridge.sessionQuery(true)
    attributes.set(asset.Tag.SECRET, secret)
    attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED)
    attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE)
    attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.NEVER)
    for (let i = 0; i < remaining; i++) {
      const offset = firstBytes + i * VoipBridge.sessionLabelBytes
      attributes.set(VoipBridge.sessionLabels[i], bytes.slice(offset, offset + VoipBridge.sessionLabelBytes))
    }
    try {
      asset.addSync(attributes)
      VoipBridge.traceIncoming(`sessionSaved bytes=${bytes.length}`)
    } catch (error) {
      VoipBridge.traceIncoming(`sessionSaveFailed code=${(error as BusinessError).code} bytes=${bytes.length}`)
      VoipBridge.emit('error', 'CALL_SECURE_STORAGE_FAILED')
    }
  }
  static readSession(encrypted: boolean): Configuration | null {
    const query = VoipBridge.sessionQuery(encrypted)
    query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL)
    let item: asset.AssetMap | undefined
    try {
      item = asset.querySync(query)[0]
    } catch (error) {
      const reason = error as BusinessError
      if (reason.code === 24000002) return null
      VoipBridge.traceIncoming(`sessionReadFailed code=${reason.code}`)
      throw new Error('CALL_SECURE_STORAGE_FAILED')
    }
    const secret = item?.get(asset.Tag.SECRET) as Uint8Array | undefined
    if (!secret?.length) return null
    const decoder = new util.TextDecoder()
    if (!encrypted) return JSON.parse(decoder.decodeWithStream(secret)) as Configuration
    const remaining = secret[0]
    if (remaining > VoipBridge.sessionLabels.length) return null
    const bytes = new Uint8Array(secret.length - 1 + remaining * VoipBridge.sessionLabelBytes)
    bytes.set(secret.subarray(1))
    let offset = secret.length - 1
    for (let i = 0; i < remaining; i++) {
      const segment = item?.get(VoipBridge.sessionLabels[i]) as Uint8Array | undefined
      if (!segment?.length || segment.length > VoipBridge.sessionLabelBytes) return null
      bytes.set(segment, offset)
      offset += segment.length
    }
    return JSON.parse(decoder.decodeWithStream(bytes.subarray(0, offset))) as Configuration
  }
  static restore(): void {
    if (VoipBridge.configuration) return
    try {
      const config = VoipBridge.readSession(true) ?? VoipBridge.readSession(false)
      if (config) {
        VoipBridge.initialize(config, true)
        VoipBridge.traceIncoming('sessionRestored')
      } else {
        VoipBridge.traceIncoming('sessionUnavailable')
      }
    } catch (error) { VoipBridge.traceIncoming(`sessionRestoreFailed code=${(error as BusinessError).code}`) }
  }
  /** Called synchronously at EntryAbility.onCreate, before any await or other push receiver. */
  static bindPush(ability: UIAbility): void {
    if (VoipBridge.ability === ability) return
    VoipBridge.context = ability.context
    try {
      pushService.receiveMessage('VoIP', ability, payload => {
        VoipBridge.traceIncoming('pushCallback')
        const info = payload as pushCommon.VoIPInfo
        VoipBridge.incoming(info).catch(() => VoipBridge.emit('error', 'CALL_INVITATION_FAILED'))
      })
      VoipBridge.ability = ability
      VoipBridge.traceIncoming('pushListenerBound')
    } catch (error) {
      VoipBridge.traceIncoming(`pushListenerFailed code=${(error as BusinessError).code}`)
      VoipBridge.emit('error', 'CALL_PUSH_REGISTRATION_FAILED')
    }
    VoipBridge.restore()
  }
  static async request(path: string, body: string = '', absolute: boolean = false, captured: Configuration | null = null): Promise<CallData> {
    const run = VoipBridge.generation, config = captured ?? VoipBridge.configuration
    if (!config) throw new Error('CALL_UNAUTHENTICATED')
    const connection = http.createHttp()
    try {
      const response = await connection.request(config.apiBaseUrl + (absolute ? '' : VoipBridge.prefix) + path, {
        method: body ? http.RequestMethod.POST : http.RequestMethod.GET,
        header: { 'Authorization': `Bearer ${config.accessToken}`, 'X-Call-Device-Id': config.deviceId, 'Content-Type': 'application/json' },
        extraData: body, connectTimeout: 4000, readTimeout: 4000, expectDataType: http.HttpDataType.STRING,
      })
      if (captured === null && run === VoipBridge.generation && config.accessToken === VoipBridge.configuration?.accessToken && VoipBusinessPolicy.isAuthenticationFailure(response.responseCode)) {
        const event: CallEvent = { type: 'localEnded', scope: config.scope, callId: VoipBridge.current?.callId, reason: 'sessionExpired' }
        VoipBridge.reset(); VoipBridge.queue.push(event)
        throw new Error('CALL_SESSION_EXPIRED')
      }
      const envelope = JSON.parse((response.result as string).replace(/("(?:convId|msgId|senderId|userId|peerUserId)"\s*:\s*)([0-9]{16,})(?=[,}\s])/g, '$1"$2"')) as Envelope
      if ((captured === null && run !== VoipBridge.generation) || response.responseCode !== 200 || envelope.code !== '0000') throw new Error('CALL_ACTION_FAILED')
      return envelope.data
    } finally { connection.destroy() }
  }
  static startStream(): void {
    VoipBridge.stopSocket(); VoipBridge.stream?.destroy(); if (VoipBridge.retry >= 0) clearTimeout(VoipBridge.retry)
    const config = VoipBridge.configuration, run = VoipBridge.generation
    if (!config) return
    if (VoipBridge.business()) { VoipBridge.startImStream(); return }
    const connection = http.createHttp(); VoipBridge.stream = connection
    const decoder = new util.TextDecoder('utf-8'); let buffer = ''
    connection.on('dataReceive', bytes => {
      if (run !== VoipBridge.generation || VoipBridge.stream !== connection) return
      buffer += decoder.decodeWithStream(new Uint8Array(bytes), { stream: true }).replace(/\r/g, '')
      if (buffer.length > 131072) { connection.destroy(); VoipBridge.reconnect(run); return }
      let index = buffer.indexOf('\n\n')
      while (index >= 0) {
        const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2)
        try {
          const lines = frame.split('\n')
          const id = lines.find(line => line.startsWith('id: ')); const data = lines.find(line => line.startsWith('data: '))
          if (data) VoipBridge.adopt(JSON.parse(data.slice(6)) as CallData)
          if (id) VoipBridge.cursor = id.slice(4)
        } catch (_) { VoipBridge.emit('error', 'CALL_INVALID_EVENT') }
        index = buffer.indexOf('\n\n')
      }
    })
    connection.on('dataEnd', () => VoipBridge.reconnect(run))
    connection.requestInStream(config.apiBaseUrl + VoipBridge.prefix + '/events', {
      method: http.RequestMethod.GET, header: { 'Authorization': `Bearer ${config.accessToken}`, 'X-Call-Device-Id': config.deviceId, 'Last-Event-ID': VoipBridge.cursor },
      connectTimeout: 4000, readTimeout: 60000,
    }).then(status => {
      if (VoipBridge.stream !== connection || run !== VoipBridge.generation) return
      if (status === 401 || status === 403) {
      const event: CallEvent = { type: 'localEnded', scope: config.scope, callId: VoipBridge.current?.callId, reason: 'sessionExpired' }
      VoipBridge.reset(); VoipBridge.queue.push(event); return
    }
    if (status !== 200) { connection.destroy(); VoipBridge.reconnect(run) } }).catch(() => VoipBridge.reconnect(run))
  }
  static reconnect(run: number): void {
    if (run !== VoipBridge.generation || !VoipBridge.configuration) return
    if (VoipBridge.retry >= 0) clearTimeout(VoipBridge.retry)
    VoipBridge.retry = setTimeout(() => { VoipBridge.startStream() }, 1000)
  }
  static stopSocket(): void {
    const socket = VoipBridge.socket; VoipBridge.socket = null
    if (VoipBridge.heartbeat >= 0) clearInterval(VoipBridge.heartbeat)
    VoipBridge.heartbeat = -1
    socket?.close().catch(() => {})
  }
  static startImStream(): void {
    const config = VoipBridge.configuration, run = VoipBridge.generation
    if (!config) return
    const socket = webSocket.createWebSocket(); VoipBridge.socket = socket
    const send = (op: number, body: string = '{}'): void => {
      socket.send(`{"v":1,"op":${op},"reqId":"${util.generateRandomUUID()}","ts":${Date.now()},"body":${body}}`).catch(() => {})
    }
    let lastFrame = Date.now(), acknowledged = false
    const retry = (): void => { if (VoipBridge.socket === socket && run === VoipBridge.generation) { VoipBridge.stopSocket(); VoipBridge.reconnect(run) } }
    socket.on('open', () => {
      if (VoipBridge.socket !== socket) return
      send(1000, JSON.stringify({ token: config.accessToken, deviceId: config.deviceId.split('#')[0] + '#voip', platform: 'harmonyos', lastAckSeq: 0 }))
    })
    socket.on('message', (_error, text) => {
      if (run !== VoipBridge.generation || VoipBridge.socket !== socket || typeof text !== 'string') return
      lastFrame = Date.now()
      try {
        const frame = JSON.parse(text.replace(/("(?:convId|msgId|senderId|userId|peerUserId)"\s*:\s*)([0-9]{16,})(?=[,}\s])/g, '$1"$2"')) as ImFrame
        const body = frame.body
        if (frame.op === 1001) {
          acknowledged = true
          const interval = Math.max(5, Math.min(60, body.heartbeatInterval ?? 30)) * 1000
          if (VoipBridge.heartbeat >= 0) clearInterval(VoipBridge.heartbeat)
          VoipBridge.heartbeat = setInterval(() => { if (Date.now() - lastFrame > interval * 2) retry(); else send(2000) }, interval)
        } else if (frame.op === 1002 || frame.op === 9000) { VoipBridge.stopSocket(); VoipBridge.emit('error', 'CALL_CONTROL_REJECTED') }
        else if (frame.op === 3002 && body.msgType === 'voip') {
          send(3003, JSON.stringify({ convId: body.convId, seq: body.seq }))
          VoipBridge.receiveInvitation(body).catch(() => VoipBridge.emit('error', 'CALL_INVITATION_FAILED'))
        } else if (frame.op === 3007) VoipBridge.receiveSignal(body)
      } catch (_) { VoipBridge.emit('error', 'CALL_INVALID_EVENT') }
    })
    socket.on('close', retry); socket.on('error', retry)
    socket.connect(config.apiBaseUrl.replace('https://', 'wss://').replace('http://', 'ws://') + '/instant-message/ws', { protocol: 'im-v1' }).catch(retry)
    setTimeout(() => { if (!acknowledged) retry() }, 10000)
  }
  static async verifiedInvitation(message: CallData): Promise<CallData | null> {
    const config = VoipBridge.configuration, body = message.body
    const run = VoipBridge.generation
    if (!config || message.msgType !== 'voip' || (message.senderType ?? 1) !== 1 || (message.msgStatus ?? 1) !== 1 ||
      !body || !body.callId || !body.roomName || !['audio', 'video'].includes(body.mediaType)) return null
    const sent = message.sendTime ?? 0, id = body.callId, now = Date.now()
    const senderId = `${message.senderId ?? ''}`, convId = `${message.convId ?? ''}`, msgId = `${message.msgId ?? ''}`
    if (!senderId || !convId || !msgId || senderId === config.userId || !Number.isSafeInteger(sent) ||
      sent <= 0 || sent > now + 5000 || sent + 60000 <= now || VoipBridge.terminal.has(id)) return null
    const detail = await VoipBridge.request(`/api/instant-message/conversations/${encodeURIComponent(convId)}`, '', true)
    if (VoipBridge.generation !== run || detail.convType !== 1 || `${detail.peerUserId ?? ''}` !== senderId ||
      sent + 60000 <= Date.now() || VoipBridge.terminal.has(id)) return null
    const callerAvatar = detail.peerAvatar?.trim() || message.senderAvatar?.trim() || ''
    return { protocol: 'im-voip-v1', callId: id, roomName: body.roomName, msgId, convId, version: 1, state: 'ringing', callerId: senderId, calleeId: config.userId, callerDeviceId: '', acceptedDeviceId: '', mediaType: body.mediaType, displayName: detail.peerName ?? '', callerDisplayName: detail.peerName, callerAvatar, expiresAt: sent + 60000, connectedAt: 0, reason: '' }
  }
  static async receiveInvitation(message: CallData): Promise<void> {
    const id = message.body?.callId
    if (id === VoipBridge.current?.callId || id === VoipBridge.pendingIncoming?.invite.callId) return
    const next = await VoipBridge.verifiedInvitation(message)
    if (!next || next.callId === VoipBridge.current?.callId || next.callId === VoipBridge.pendingIncoming?.invite.callId) return
    if (VoipBridge.current || VoipBridge.pendingIncoming) {
      VoipBridge.notifyBusinessEnd(next, 'busy')
      VoipBridge.rememberCallId(VoipBridge.terminal, next.callId)
      return
    }
    if (VoipBridge.background && !VoipBridge.reportedInvitations.has(next.callId)) {
      const invitation: PushInvitation = {
        callId: next.callId, convId: next.convId, msgId: next.msgId ?? '',
        calleeId: next.calleeId, mediaType: next.mediaType, expiresAt: next.expiresAt, displayName: next.displayName,
      }
      await VoipBridge.presentIncoming(invitation, util.generateRandomUUID(), next)
    } else VoipBridge.adopt(next)
  }
  static receiveSignal(event: CallData): void {
    const payload = event.payload, call = VoipBridge.current, type = event.eventType ?? ''
    if (!payload?.convId) return
    const terminalSignal = ['voip:cancel', 'voip:timeout', 'voip:decline'].includes(type) ||
      (type === 'voip:answered' && payload.userId === VoipBridge.configuration?.userId)
    const matches = call && payload.convId === call.convId && (payload.callId ? payload.callId === call.callId : !!payload.msgId && !!call.msgId && payload.msgId === call.msgId)
    if (matches && call) {
      if (type === 'voip:answered') {
        if (call.calleeId === VoipBridge.configuration?.userId && !call.acceptedDeviceId) VoipBridge.finish('answeredElsewhere', false)
        else if (call.callerId === VoipBridge.configuration?.userId && call.state === 'ringing') {
          const next = VoipBridge.parse(JSON.stringify(call)); next.version++; next.state = 'connecting'; next.connectExpiresAt = Date.now() + 30000; VoipBridge.adopt(next)
        }
      } else if (type === 'voip:cancel') VoipBridge.finish(call.state === 'ringing' ? 'remoteCancelled' : 'remoteEnded', false)
      else if (call.state === 'ringing' && (type === 'voip:decline' || type === 'voip:timeout')) VoipBridge.finish(type === 'voip:decline' ? 'rejected' : 'timeout', false)
      return
    }
    if (!terminalSignal) return
    const invite = VoipBridge.pendingIncoming?.invite
    if (invite && invite.convId === payload.convId &&
      (payload.callId ? payload.callId === invite.callId : !!payload.msgId && payload.msgId === invite.msgId)) {
      VoipBridge.rememberCallId(VoipBridge.terminal, invite.callId)
      VoipBridge.dismissPendingIncoming()
    } else if (payload.callId && payload.callId !== call?.callId) VoipBridge.rememberCallId(VoipBridge.terminal, payload.callId)
  }
  static businessAction(action: string, media: string): void {
    const current = VoipBridge.current
    if (!current) return
    const next = VoipBridge.parse(JSON.stringify(current)); next.version++
    if (action === 'accept' && current.state === 'ringing') {
      next.state = 'connecting'; next.acceptedDeviceId = VoipBridge.configuration?.deviceId ?? ''; next.connectExpiresAt = Date.now() + 30000
      next.mediaType = current.mediaType === 'video' ? media : 'audio'; VoipBridge.adopt(next)
    } else if (action === 'ready' && VoipBridge.connected && VoipBridge.peerReady) { next.state = 'active'; next.connectedAt = Date.now(); VoipBridge.adopt(next) }
    else if (['end', 'cancel', 'reject'].includes(action)) VoipBridge.finish(current.state === 'ringing' ? (current.calleeId === VoipBridge.configuration?.userId ? 'rejected' : 'cancelled') : 'ended')
  }
  static async mediaJoined(): Promise<void> {
    const call = VoipBridge.current, config = VoipBridge.configuration
    const run = VoipBridge.generation
    if (!call || !config) return
    if (call.callerId === config.userId) {
      const invitation: InvitationBody = { callId: call.callId, roomName: call.roomName ?? '', mediaType: call.mediaType }
      const result = await VoipBridge.request('/api/instant-message/messages', JSON.stringify({ convId: call.convId, deviceId: config.deviceId, clientMsgId: call.callId, msgType: 'voip', body: invitation }), true, config)
      if (VoipBridge.generation !== run || VoipBridge.current?.callId !== call.callId) { call.msgId = result.msgId; VoipBridge.notifyBusinessEnd(call, 'cancel', config); return }
      const next = VoipBridge.parse(JSON.stringify(VoipBridge.current)); next.msgId = result.msgId; next.version++
      const now = Date.now(); next.expiresAt = VoipBusinessPolicy.ringDeadline(result.sendTime, now)
      if (next.state === 'ringing' && next.expiresAt <= now) { VoipBridge.current = next; VoipBridge.finish('timeout'); return }
      VoipBridge.adopt(next)
    } else {
      try { await VoipBridge.request('/answered', JSON.stringify({ convId: call.convId, msgId: call.msgId, callId: call.callId, roomName: call.roomName })) }
      catch (_) { if (run === VoipBridge.generation && VoipBridge.current?.callId === call.callId) VoipBridge.emit('controlWarning', 'CALL_ANSWER_REPORT_FAILED') }
    }
  }
  static notifyBusinessEnd(call: CallData, reason: string, captured: Configuration | null = null): void {
    const config = captured ?? VoipBridge.configuration
    if (!call.msgId || !reason || ['remoteEnded', 'remoteCancelled', 'answeredElsewhere', 'sessionChanged'].includes(reason)) return
    const caller = call.callerId === config?.userId
    const path = VoipBusinessPolicy.endAction(caller, call.state, reason)
    if (!path) return
    VoipBridge.request(path, JSON.stringify({ convId: call.convId, msgId: call.msgId, callId: call.callId, roomName: call.roomName, reason: caller ? (reason === 'timeout' ? 'timeout' : 'cancel') : undefined }), false, config).catch(() => {})
  }
  static adopt(value: CallData): void {
    const config = VoipBridge.configuration, previous = VoipBridge.current
    if (!config || !value.callId || value.version < 1 || VoipBridge.terminal.has(value.callId) ||
      (value.callerId !== config.userId && value.calleeId !== config.userId)) return
    if (value.callerId === config.userId && value.callerDeviceId !== config.deviceId) return
    const ranks = ['ringing', 'connecting', 'active', 'ended']; const rank = ranks.indexOf(value.state)
    if (rank < 0) return
    if (previous && previous.callId === value.callId && (value.version <= previous.version || rank < ranks.indexOf(previous.state))) return
    if (previous && previous.callId !== value.callId && previous.state !== 'ended') return
    if (value.state === 'ringing' && value.expiresAt <= Date.now()) return
    if (VoipBridge.pendingIncoming && VoipBridge.pendingIncoming.invite.callId !== value.callId) VoipBridge.dismissPendingIncoming()
    if (!previous || previous.callId !== value.callId) {
      VoipBridge.microphone = true
      VoipBridge.camera = value.mediaType === 'video'
      VoipBridge.speakerEnabled = false
    }
    VoipBridge.current = value; VoipBridge.emit('snapshot', '', value)
    if (value.state === 'ended') { VoipBridge.finish(); return }
    if (value.calleeId === config.userId && value.acceptedDeviceId && value.acceptedDeviceId !== config.deviceId) { VoipBridge.finish('answeredElsewhere'); return }
    if (value.state === 'ringing') {
      if (VoipBridge.business() && value.callerId === config.userId && value.callerDeviceId === config.deviceId && VoipBridge.mediaId !== value.callId) VoipBridge.startMedia(value)
      if (value.callerId === config.userId && value.callerDeviceId === config.deviceId && !VoipBridge.nativeId) VoipBridge.outgoing(value)
      if (VoipBridge.expiry >= 0) clearTimeout(VoipBridge.expiry)
      const preparing = VoipBridge.business() && value.callerId === config.userId && !value.msgId
      if (preparing) value.prepareExpiresAt = previous?.callId === value.callId ? (previous.prepareExpiresAt ?? Date.now() + 30000) : Date.now() + 30000
      const deadline = preparing ? (value.prepareExpiresAt ?? Date.now() + 30000) : value.expiresAt
      VoipBridge.expiry = setTimeout(() => { if (VoipBridge.current?.callId === value.callId && VoipBridge.current.state === 'ringing') VoipBridge.finish(preparing ? 'connectionTimeout' : 'timeout') }, Math.max(0, deadline - Date.now()))
    } else {
      if (VoipBridge.expiry >= 0) clearTimeout(VoipBridge.expiry)
      if (value.state === 'connecting') VoipBridge.expiry = setTimeout(() => {
        if (VoipBridge.current?.callId === value.callId && VoipBridge.current.state === 'connecting') VoipBridge.finish('connectionTimeout')
      }, Math.max(0, Math.min(30000, (value.connectExpiresAt ?? (Date.now() + 30000)) - Date.now())))
      const owner = (value.callerId === config.userId && value.callerDeviceId === config.deviceId) || (value.calleeId === config.userId && value.acceptedDeviceId === config.deviceId)
      if (owner && value.state === 'connecting' && value.calleeId === config.userId) VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_ANSWERED)
      if (owner && VoipBridge.mediaId !== value.callId) VoipBridge.startMedia(value)
    }
  }
  static async action(action: string, mediaType: string = 'audio', systemAnswer: boolean = false): Promise<void> {
    const call = VoipBridge.current, run = VoipBridge.generation, token = VoipBridge.configuration?.accessToken; if (!call) return
    if (action === 'accept') {
      if (call.state !== 'ringing' || call.calleeId !== VoipBridge.configuration?.userId || VoipBridge.answering === call.callId || !['audio', 'video'].includes(mediaType) || (mediaType === 'video' && call.mediaType !== 'video')) return
      VoipBridge.answering = call.callId
      try {
        const allowed = await VoipBridge.ensurePermissions(mediaType)
        if (run !== VoipBridge.generation || VoipBridge.current?.callId !== call.callId || VoipBridge.current.state !== 'ringing') return
        if (systemAnswer) VoipBridge.traceIncoming(`systemAccept media=${mediaType} permission=${allowed}`, call.callId)
        if (!allowed) {
          VoipBridge.emit('error', 'CALL_PERMISSION_REQUIRED')
          if (systemAnswer) VoipBridge.finish('permissionRequired', false)
          return
        }
        if (systemAnswer && mediaType === 'audio' && VoipBridge.nativeVoiceStart &&
          VoipBridge.configuration?.apiBaseUrl === VoipBridge.nativeVoiceTestOrigin && VoipBridge.business()) {
          VoipBridge.nativeVoiceCallId = call.callId
        }
      } finally { if (run === VoipBridge.generation && VoipBridge.answering === call.callId) VoipBridge.answering = '' }
    }
    if (VoipBridge.business()) { VoipBridge.businessAction(action, mediaType); return }
    if (['end', 'cancel', 'reject'].includes(action)) {
      VoipBridge.finish(call.state === 'ringing' ? (call.calleeId === VoipBridge.configuration?.userId ? 'rejected' : 'cancelled') : 'ended'); return
    }
    try {
      const next = await VoipBridge.request(`/${call.callId}/actions`, JSON.stringify({ action, actionId: util.generateRandomUUID(), answerMediaType: mediaType }))
      if (VoipBridge.current?.callId === call.callId) VoipBridge.adopt(next)
    } catch (_) { if (run !== VoipBridge.generation || token !== VoipBridge.configuration?.accessToken || VoipBridge.current?.callId !== call.callId) return; if (action !== 'ready') VoipBridge.finish('failed'); VoipBridge.emit('error', 'CALL_ACTION_FAILED') }
  }
  static async ensurePermissions(mediaType: string): Promise<boolean> {
    const context = VoipBridge.mediaContext ?? VoipBridge.context
    if (!context) return false
    const permissions: Permissions[] = ['ohos.permission.MICROPHONE']
    if (mediaType === 'video') permissions.push('ohos.permission.CAMERA')
    try {
      const manager = abilityAccessCtrl.createAtManager()
      const token = context.applicationInfo.accessTokenId
      if (permissions.every(permission => manager.checkAccessTokenSync(token, permission) === 0)) return true
      const result = await manager.requestPermissionsFromUser(context, permissions)
      return result.authResults.length === permissions.length && result.authResults.every(value => value === 0)
    } catch (_) { return false }
  }
  static async setCamera(enabled: boolean): Promise<void> {
    const call = VoipBridge.current, run = VoipBridge.generation
    if (!call || call.mediaType !== 'video') return
    const allowed = !enabled || await VoipBridge.ensurePermissions('video')
    if (run !== VoipBridge.generation || VoipBridge.current?.callId !== call.callId) return
    if (!allowed) { VoipBridge.emit('error', 'CALL_PERMISSION_REQUIRED'); return }
    VoipBridge.camera = enabled
    VoipBridge.media(JSON.stringify({ op: 'camera', callId: call.callId, enabled }))
    VoipBridge.emit('camera', '', undefined, '', enabled)
  }
  static startMedia(call: CallData): void {
    const run = VoipBridge.generation
    VoipBridge.connect(call).catch((error: BusinessError) => {
      if (run !== VoipBridge.generation || VoipBridge.current?.callId !== call.callId) return
      VoipBridge.traceIncoming(`mediaConnectFailed code=${error.code}`, call.callId)
      VoipBridge.finish('mediaFailed')
    })
  }
  static async connect(call: CallData): Promise<void> {
    VoipBridge.mediaId = call.callId; VoipBridge.connected = false; VoipBridge.peerReady = false; VoipBridge.readySent = false
    if (call.mediaType !== 'video') VoipBridge.camera = false
    const run = VoipBridge.generation
    const credentials = VoipBridge.business() ? await VoipBridge.request(`/api/instant-message/meetings/rtc/rooms/${encodeURIComponent(call.roomName ?? '')}/tokens`, JSON.stringify({ platform: 'harmonyos', deviceId: VoipBridge.configuration?.deviceId, displayName: VoipBridge.configuration?.userId }), true) : await VoipBridge.request(`/${call.callId}/credentials`, '{}')
    if (VoipBridge.business()) { credentials.serverUrl = credentials.wsUrl; credentials.participantToken = credentials.token }
    if (run !== VoipBridge.generation || VoipBridge.current?.callId !== call.callId || VoipBridge.terminal.has(call.callId)) return
    const signal = credentials.serverUrl ?? ''
    if (!signal.startsWith('wss://') && !(VoipBridge.configuration?.development && signal.startsWith('ws://'))) throw new Error('CALL_INSECURE_MEDIA_URL')
    VoipBridge.traceIncoming('mediaEndpointReady', call.callId)
    if (VoipBridge.nativeVoiceCallId === call.callId) {
      const context = VoipBridge.context, start = VoipBridge.nativeVoiceStart
      const token = credentials.participantToken
      if (!context || !start || !token) throw new Error('CALL_NATIVE_AUDIO_UNAVAILABLE')
      await start(context, call.callId, signal, token, VoipBridge.microphone)
      return
    }
    VoipBridge.media(JSON.stringify({ op: 'connect', protocol: call.protocol, callId: call.callId, serverUrl: credentials.serverUrl, participantToken: credentials.participantToken, mediaType: call.mediaType, microphoneEnabled: VoipBridge.microphone, cameraEnabled: VoipBridge.camera }))
    VoipBridge.showMedia()
  }
  static showMedia(): void {
    const call = VoipBridge.current, context = VoipBridge.context
    if (!call || !context) return
    const bundleName = context.abilityInfo.bundleName
    const moduleName = context.abilityInfo.moduleName
    context.startAbility({ bundleName, moduleName, abilityName: 'NuwaxVoipMediaAbility' }).then(() => {
      VoipBridge.traceIncoming('mediaAbilityStarted', call.callId)
    }).catch((error: BusinessError) => {
      if (VoipBridge.current?.callId !== call.callId) return
      VoipBridge.traceIncoming(`mediaAbilityFailed code=${error.code}`, call.callId)
      VoipBridge.emit('error', 'CALL_MEDIA_HOST_FAILED')
    })
  }
  static media(raw: string): void {
    if (VoipBridge.nativeVoiceCallId) {
      const command = JSON.parse(raw) as Command
      if (command.op === 'microphone') VoipBridge.nativeVoiceMute?.(command.enabled !== true)
      if (command.op === 'disconnect') {
        VoipBridge.nativeVoiceCallId = ''
        VoipBridge.nativeVoiceStop?.()
      }
      return
    }
    if (!VoipBridge.controller || !VoipBridge.mediaReady) { VoipBridge.commands.push(raw); if (VoipBridge.commands.length > 16) VoipBridge.commands.shift(); return }
    VoipBridge.controller.runJavaScript(`window.nuwaxVoipMedia.execute(${JSON.stringify(raw)})`).catch(() => VoipBridge.emit('error', 'CALL_MEDIA_COMMAND_FAILED'))
  }
  static mediaEvent(raw: string): void {
    try {
      const event = JSON.parse(raw) as MediaEvent
      if (event.type === 'disconnected' && event.released === true) {
        if (event.callId) VoipBridge.traceIncoming('mediaWebReleased', event.callId)
        return
      }
      if (event.type === 'webReady') {
        if (VoipBridge.current) VoipBridge.traceIncoming('mediaWebReady', VoipBridge.current.callId)
        VoipBridge.mediaReady = true; const pending = VoipBridge.commands; VoipBridge.commands = []
        pending.forEach(command => VoipBridge.media(command)); return
      }
      const call = VoipBridge.current
      if (!call || event.callId !== call.callId) return
      if (event.type === 'connected') {
        const firstConnection = !VoipBridge.connected
        VoipBridge.connected = true; VoipBridge.reconnecting = false
        if (VoipBridge.nativeVoiceCallId !== call.callId) VoipBridge.startTask()
        const id = call.callId, run = VoipBridge.generation
        if (firstConnection && VoipBridge.business()) VoipBridge.mediaJoined().catch(() => { if (run === VoipBridge.generation && VoipBridge.current?.callId === id) VoipBridge.finish('mediaFailed') })
      }
      if (event.type === 'reconnecting') VoipBridge.reconnecting = true
      if (event.type === 'peerMediaReady') VoipBridge.peerReady = true
      if (event.type === 'remoteEnded') { VoipBridge.finish('remoteEnded', false); return }
      if (event.type === 'disconnected' || (event.type === 'error' && event.fatal !== false)) { VoipBridge.finish('disconnected'); return }
      VoipBridge.emit(event.type, event.code)
      if (VoipBridge.current?.callId === call.callId && VoipBridge.connected && VoipBridge.peerReady && !VoipBridge.readySent) {
        VoipBridge.readySent = true
        VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_ACTIVE, VoipBridge.nativeId, call.mediaType)
        VoipBridge.action('ready')
      }
    } catch (_) { VoipBridge.emit('error', 'CALL_INVALID_MEDIA_EVENT') }
  }
  static async outgoing(call: CallData): Promise<void> {
    const id = util.generateRandomUUID(), run = VoipBridge.generation
    VoipBridge.nativeId = id
    const picture = await image.createPixelMap(new Uint8Array([61, 89, 139, 255]).buffer, { size: { width: 1, height: 1 }, pixelFormat: image.PixelMapFormat.RGBA_8888 })
    try {
      if (run !== VoipBridge.generation || VoipBridge.current?.callId !== call.callId) return
      const result = await voipCall.reportOutgoingCall({ callId: id, voipCallType: call.mediaType === 'video' ? voipCall.VoipCallType.VOIP_CALL_VIDEO : voipCall.VoipCallType.VOIP_CALL_VOICE,
        userName: call.calleeDisplayName ?? call.calleeId, userProfile: picture, abilityName: 'NuwaxVoipMediaAbility',
        voipCallState: voipCall.VoipCallState.VOIP_CALL_STATE_DIALING, isConferenceCall: false })
      if (run !== VoipBridge.generation || VoipBridge.current?.callId !== call.callId) {
        await voipCall.reportCallStateChange(id, voipCall.VoipCallState.VOIP_CALL_STATE_DISCONNECTED); return
      }
      if (result !== voipCall.ErrorReason.ERROR_NONE) VoipBridge.finish('systemFailed')
    } catch (_) { if (run === VoipBridge.generation && VoipBridge.current?.callId === call.callId) VoipBridge.finish('systemFailed') }
    finally { picture.release() }
  }
  static pushDelivery(info: pushCommon.VoIPInfo): PushDelivery | null {
    // Push Kit documents both a typed callId and a VoIP envelope inside PushPayload.data.
    let envelope: PushDelivery | null = null
    try { envelope = JSON.parse(info.data) as PushDelivery } catch (_) {}
    if (envelope && typeof envelope.data === 'string' &&
      typeof envelope.callId === 'string' && envelope.callId) {
      if (!info.callId || info.callId === envelope.callId) return envelope
      return { callId: info.callId, data: '' }
    }
    if (info.callId) return { callId: info.callId, data: info.data }
    VoipBridge.traceIncoming(`pushEnvelope sdkData=${typeof info.data} envelopeId=${typeof envelope?.callId} envelopeData=${typeof envelope?.data} header=${typeof envelope?.header}`)
    return null
  }
  static pushInvitation(raw: string): PushInvitation | null {
    let invite: PushInvitation
    try { invite = JSON.parse(raw) as PushInvitation } catch (_) { return null }
    const userId = VoipBridge.configuration?.userId, now = Date.now()
    if (!invite || !userId || invite.calleeId !== userId || typeof invite.callId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(invite.callId) || !['audio', 'video'].includes(invite.mediaType) ||
      !Number.isSafeInteger(invite.expiresAt) || invite.expiresAt <= now || VoipBridge.terminal.has(invite.callId)) return null
    if (VoipBridge.business() && (invite.type !== 'voip' || (invite.scene !== undefined && invite.scene !== 'call') ||
      invite.expiresAt > now + 65000 || typeof invite.convId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(invite.convId) ||
      typeof invite.msgId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(invite.msgId))) return null
    return invite
  }
  static async resolvePushInvitation(pending: PendingIncoming): Promise<CallData | null> {
    const invite = pending.invite
    if (!VoipBridge.business()) {
      const call = await VoipBridge.request(`/${encodeURIComponent(invite.callId)}`)
      return call.callId === invite.callId && call.calleeId === invite.calleeId ? call : null
    }
    const msg = await VoipBridge.request(`/api/instant-message/messages/${encodeURIComponent(invite.msgId)}?convId=${encodeURIComponent(invite.convId)}`, '', true)
    if (VoipBridge.pendingIncoming !== pending || `${msg.convId ?? ''}` !== invite.convId || `${msg.msgId ?? ''}` !== invite.msgId ||
      msg.body?.callId !== invite.callId || msg.body?.mediaType !== invite.mediaType) return null
    const call = await VoipBridge.verifiedInvitation(msg)
    if (!call || invite.expiresAt > call.expiresAt) return null
    call.expiresAt = invite.expiresAt
    return call
  }
  static clearPendingIncoming(): void {
    const pending = VoipBridge.pendingIncoming
    if (pending) clearTimeout(pending.timer)
    VoipBridge.pendingIncoming = null
  }
  static dismissPendingIncoming(): void {
    const pending = VoipBridge.pendingIncoming
    if (pending && VoipBridge.nativeId === pending.nativeId) {
      VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_DISCONNECTED)
      VoipBridge.nativeId = ''
    }
    VoipBridge.clearPendingIncoming()
  }
  static async incoming(info: pushCommon.VoIPInfo): Promise<void> {
    VoipBridge.restore()
    const delivery = VoipBridge.pushDelivery(info)
    if (!delivery) {
      VoipBridge.traceIncoming('pushMissingCallId')
      return
    }
    if (delivery.callId === VoipBridge.nativeId || delivery.callId === VoipBridge.pendingIncoming?.nativeId) return
    const id = delivery.callId
    const invite = VoipBridge.pushInvitation(delivery.data)
    if (!invite) {
      VoipBridge.traceIncoming(VoipBridge.configuration ? 'pushInvalidInvitation' : 'pushNoSession')
      await voipCall.reportIncomingCallError(id, voipCall.VoipCallFailureCause.OTHER)
      return
    }
    const current = VoipBridge.current
    if (VoipBridge.pendingIncoming || VoipBridge.nativeId || VoipBridge.reportedInvitations.has(invite.callId) ||
      (current && (current.callId !== invite.callId || current.state !== 'ringing'))) {
      await voipCall.reportIncomingCallError(id, voipCall.VoipCallFailureCause.ROUTE_BUSY); return
    }
    await VoipBridge.presentIncoming(invite, id)
  }
  static async presentIncoming(invite: PushInvitation, id: string, verifiedCall: CallData | null = null): Promise<void> {
    const pending: PendingIncoming = { invite, nativeId: id, action: '', answerMediaType: 'audio',
      timer: setTimeout(() => VoipBridge.dismissPendingIncoming(), invite.expiresAt - Date.now()) }
    VoipBridge.pendingIncoming = pending
    VoipBridge.traceIncoming(verifiedCall ? 'onlineInvitation' : 'received', invite.callId)
    try {
      const picture = await image.createPixelMap(new Uint8Array([61, 89, 139, 255]).buffer, { size: { width: 1, height: 1 }, pixelFormat: image.PixelMapFormat.RGBA_8888 })
      try {
        if (VoipBridge.pendingIncoming !== pending) {
          if (!verifiedCall) await voipCall.reportIncomingCallError(id, voipCall.VoipCallFailureCause.OTHER)
          return
        }
        const displayName = typeof invite.displayName === 'string' ? invite.displayName.trim().slice(0, 80) : ''
        const result = await voipCall.reportIncomingCall({ callId: id, voipCallType: invite.mediaType === 'video' ? voipCall.VoipCallType.VOIP_CALL_VIDEO : voipCall.VoipCallType.VOIP_CALL_VOICE,
          userName: displayName || VoipBridge.configuration?.callLabel || 'Nuwax', userProfile: picture, abilityName: 'NuwaxVoipMediaAbility',
          voipCallState: voipCall.VoipCallState.VOIP_CALL_STATE_RINGING, showBannerForIncomingCall: true, isConferenceCall: false, isVoiceAnswerSupported: true })
        if (result !== voipCall.ErrorReason.ERROR_NONE) {
          VoipBridge.traceIncoming(`systemRingRejected code=${result}`, invite.callId)
          throw new Error('CALL_SYSTEM_UNAVAILABLE')
        }
      } finally { picture.release() }
      if (VoipBridge.pendingIncoming !== pending) {
        VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_DISCONNECTED, id)
        return
      }
      // The system identifier and business identifier represent the same call in different APIs.
      VoipBridge.nativeId = id
      VoipBridge.rememberCallId(VoipBridge.reportedInvitations, invite.callId)
      VoipBridge.traceIncoming('systemRinging', invite.callId)
      const call = verifiedCall ?? await VoipBridge.resolvePushInvitation(pending)
      if (VoipBridge.pendingIncoming !== pending) return
      if (!call || invite.expiresAt <= Date.now() || VoipBridge.terminal.has(invite.callId)) {
        VoipBridge.dismissPendingIncoming()
        return
      }
      VoipBridge.clearPendingIncoming()
      VoipBridge.traceIncoming('verified', invite.callId)
      VoipBridge.adopt(call)
      if (VoipBridge.current?.callId !== call.callId) {
        VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_DISCONNECTED)
        VoipBridge.nativeId = ''
      } else if (pending.action) {
        VoipBridge.action(pending.action, pending.answerMediaType, pending.action === 'accept')
      }
    } catch (error) {
      if (VoipBridge.pendingIncoming !== pending) return
      VoipBridge.traceIncoming(`incomingFailed code=${(error as BusinessError).code}`, invite.callId)
      if (!verifiedCall && VoipBridge.nativeId !== id) voipCall.reportIncomingCallError(id, voipCall.VoipCallFailureCause.OTHER).catch(() => {})
      VoipBridge.dismissPendingIncoming()
      if (verifiedCall) VoipBridge.adopt(verifiedCall)
      VoipBridge.emit('error', 'CALL_INVITATION_FAILED')
    }
  }
  static systemEvent(info: voipCall.VoipCallUiEventInfo): void {
    const pending = VoipBridge.pendingIncoming?.nativeId === info.callId ? VoipBridge.pendingIncoming : null
    if (!pending && info.callId !== VoipBridge.nativeId) return
    const event = info.voipCallUiEvent
    if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_VOICE_ANSWER || event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_VIDEO_ANSWER) {
      const media = event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_VIDEO_ANSWER ? 'video' : 'audio'
      if (pending && pending.action) return
      VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_ANSWERED, info.callId)
      if (pending) { pending.action = 'accept'; pending.answerMediaType = media }
      else VoipBridge.action('accept', media, true)
    } else if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_REJECT || event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_HANGUP) {
      if (pending) pending.action = 'reject'
      else VoipBridge.action(event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_REJECT ? 'reject' : 'end')
    }
    else if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_MUTED || event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_UNMUTED) {
      VoipBridge.microphone = event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_UNMUTED
      VoipBridge.media(JSON.stringify({ op: 'microphone', enabled: VoipBridge.microphone })); VoipBridge.emit('microphone', '', undefined, '', VoipBridge.microphone)
    } else if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_SPEAKER_ON || event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_SPEAKER_OFF) VoipBridge.speaker(event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_SPEAKER_ON)
  }
  static reportState(state: voipCall.VoipCallState, id: string = VoipBridge.nativeId, mediaType: string = ''): void {
    if (!id) return
    if (state === voipCall.VoipCallState.VOIP_CALL_STATE_ANSWERED) {
      if (VoipBridge.answeredNativeId === id) return
      VoipBridge.answeredNativeId = id
    }
    const pending = VoipBridge.pendingIncoming
    const callId = pending?.nativeId === id ? pending.invite.callId : id === VoipBridge.nativeId ? VoipBridge.current?.callId : undefined
    const report = mediaType
      ? voipCall.reportCallStateChange(id, state, mediaType === 'video' ? voipCall.VoipCallType.VOIP_CALL_VIDEO : voipCall.VoipCallType.VOIP_CALL_VOICE)
      : voipCall.reportCallStateChange(id, state)
    report.then(() => {
      if (callId) VoipBridge.traceIncoming(`systemState=${state}`, callId)
    }).catch(() => {})
  }
  static speaker(enabled: boolean): void {
    const id = VoipBridge.current?.callId, run = VoipBridge.generation
    audio.getAudioManager().getRoutingManager().setCommunicationDevice(audio.CommunicationDeviceType.SPEAKER, enabled).then(() => {
      if (run !== VoipBridge.generation || id !== VoipBridge.current?.callId) return
      VoipBridge.speakerEnabled = enabled
      VoipBridge.emit('speaker', '', undefined, '', enabled)
    }).catch(() => {
      if (run === VoipBridge.generation && id === VoipBridge.current?.callId) VoipBridge.emit('error', 'CALL_AUDIO_ROUTE_FAILED')
    })
  }
  static startTask(): void {
    const context = VoipBridge.mediaContext, run = VoipBridge.generation, id = VoipBridge.current?.callId
    if (!context || !id) return
    VoipBridge.taskWork = VoipBridge.taskWork.then(async () => {
      if (run !== VoipBridge.generation || VoipBridge.current?.callId !== id || VoipBridge.taskCallId === id) return
      const agent = await wantAgent.getWantAgent({ wants: [{ bundleName: context.abilityInfo.bundleName, abilityName: 'NuwaxVoipMediaAbility' }], actionType: wantAgent.OperationType.START_ABILITY, requestCode: 9090, actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG] })
      if (run !== VoipBridge.generation || VoipBridge.current?.callId !== id || VoipBridge.mediaContext !== context) return
      await backgroundTaskManager.startBackgroundRunning(context, backgroundTaskManager.BackgroundMode.VOIP, agent)
      VoipBridge.taskCallId = id
      VoipBridge.taskContext = context
      VoipBridge.traceIncoming('mediaBackgroundRunning', id)
    }).catch(() => {
      if (run !== VoipBridge.generation || VoipBridge.current?.callId !== id) return
      VoipBridge.emit('error', 'CALL_BACKGROUND_UNAVAILABLE')
      VoipBridge.action('end')
    })
  }
  static stopTask(id: string): void {
    // Wait for a pending start before stopping its owning Ability's background task.
    VoipBridge.taskWork = VoipBridge.taskWork.then(async () => {
      const context = VoipBridge.taskContext
      if (!context || VoipBridge.taskCallId !== id) return
      VoipBridge.taskCallId = ''
      VoipBridge.taskContext = null
      try {
        await backgroundTaskManager.stopBackgroundRunning(context)
        VoipBridge.traceIncoming('mediaBackgroundReleased', id)
      } catch (error) {
        VoipBridge.traceIncoming(`mediaBackgroundReleaseFailed code=${(error as BusinessError).code}`, id)
      }
    })
  }
  static finish(reason: string = '', notifyRemote: boolean = true): void {
    VoipBridge.clearPendingIncoming()
    const call = VoipBridge.current
    if (notifyRemote && call && VoipBridge.business()) VoipBridge.notifyBusinessEnd(call, reason)
    if (notifyRemote && !VoipBridge.business() && call && reason && reason !== 'answeredElsewhere' && reason !== 'sessionChanged') {
      const action = call.state === 'ringing' ? (call.calleeId === VoipBridge.configuration?.userId ? 'reject' : 'cancel') : 'end'
      VoipBridge.request(`/${call.callId}/actions`, JSON.stringify({ action, actionId: util.generateRandomUUID() })).catch(() => {})
    }
    const id = call?.callId
    if (id) VoipBridge.rememberCallId(VoipBridge.terminal, id)
    if (VoipBridge.expiry >= 0) clearTimeout(VoipBridge.expiry)
    VoipBridge.media(JSON.stringify({ op: 'disconnect', callId: id })); VoipBridge.commands = []
    VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_DISCONNECTED); VoipBridge.nativeId = ''
    if (id) VoipBridge.stopTask(id)
    if (reason) VoipBridge.emit('localEnded', '', undefined, reason)
    VoipBridge.current = null; VoipBridge.mediaId = ''; VoipBridge.connected = false; VoipBridge.reconnecting = false; VoipBridge.peerReady = false; VoipBridge.answering = ''
    VoipBridge.listeners.forEach(callback => callback())
  }
  static traceIncoming(stage: string, callId: string = ''): void {
    if (BuildProfile.DEBUG) console.info(`[NuwaxVoip] ${stage}${callId ? ' callId=' + callId : ''}`)
  }
  static rememberCallId(ids: Set<string>, id: string): void {
    ids.add(id)
    if (ids.size > 128) ids.delete(ids.values().next().value)
  }
  static reset(): void {
    if (VoipBridge.current) VoipBridge.action(VoipBridge.current.state === 'ringing' && VoipBridge.current.calleeId === VoipBridge.configuration?.userId ? 'reject' : 'end')
    VoipBridge.generation++; VoipBridge.stopSocket(); VoipBridge.stream?.destroy(); VoipBridge.stream = null
    if (VoipBridge.retry >= 0) clearTimeout(VoipBridge.retry)
    VoipBridge.finish('sessionChanged'); VoipBridge.configuration = null; VoipBridge.terminal.clear(); VoipBridge.reportedInvitations.clear(); VoipBridge.queue = []; VoipBridge.cursor = ''
    VoipBridge.background = true
    try { asset.removeSync(VoipBridge.sessionQuery(true)) } catch (_) {}
    try { asset.removeSync(VoipBridge.sessionQuery(false)) } catch (_) {}
  }
}

export class VoipJavaScriptProxy { postMessage(raw: string): void { VoipBridge.mediaEvent(raw) } }
