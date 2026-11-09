import BuildProfile from 'BuildProfile'
import { bundleManager, common, UIAbility, wantAgent } from '@kit.AbilityKit'
import { http, webSocket } from '@kit.NetworkKit'
import { util } from '@kit.ArkTS'
import { asset } from '@kit.AssetStoreKit'
import { pushService, pushCommon } from '@kit.PushKit'
import { voipCall } from '@kit.CallServiceKit'
import { backgroundTaskManager } from '@kit.BackgroundTasksKit'
import { image } from '@kit.ImageKit'
import { audio } from '@kit.AudioKit'
import { webview } from '@kit.ArkWeb'

export interface CallData {
  callId: string; convId: string; version: number; state: string; callerId: string; calleeId: string;
  callerDeviceId: string; acceptedDeviceId: string; mediaType: string; displayName: string;
  callerDisplayName?: string; calleeDisplayName?: string;
  connectExpiresAt?: number; expiresAt: number; connectedAt: number; reason: string;
  serverUrl?: string; participantToken?: string;
  protocol?: string; roomName?: string; msgId?: string; wsUrl?: string; token?: string;
  convType?: number; peerUserId?: string; peerName?: string;
  msgType?: string; senderType?: number; senderId?: string; msgStatus?: number; sendTime?: number;
  body?: InvitationBody; eventType?: string; payload?: SignalBody;
  heartbeatInterval?: number; seq?: number;
}
interface InvitationBody { callId: string; roomName: string; mediaType: string }
interface SignalBody { callId?: string; convId?: string; msgId?: string }
interface ImFrame { op: number; body: CallData }
interface Configuration {
  scope: string; apiBaseUrl: string; accessToken: string; deviceId: string; userId: string;
  development: boolean; qaAccepted: boolean; businessEnabled?: boolean; protocol?: string; callLabel: string; labels?: Record<string, string>;
  pushEnvironment?: string;
}
interface Command {
  op: string; convId?: string; msgId?: string; route?: string; scope?: string; callId?: string; snapshot?: CallData; action?: string;
  answerMediaType?: string; enabled?: boolean; hidden?: boolean;
}
interface Envelope { code: string; data: CallData }
interface MediaEvent { type: string; callId?: string; code?: string; enabled?: boolean }
interface CallEvent extends MediaEvent { scope: string; snapshot?: CallData; reason?: string }

/** This module owns the media Ability and control stream; neither belongs to a UTS page. */
export class VoipBridge {
  static context: common.UIAbilityContext | null = null
  static mediaContext: common.UIAbilityContext | null = null
  static configuration: Configuration | null = null
  static current: CallData | null = null
  static controller: webview.WebviewController | null = null
  static mediaReady = false
  static connected = false
  static peerReady = false
  static microphone = true
  static camera = false
  static generation = 0
  static mediaId = ''
  static nativeId = ''
  static terminal: Set<string> = new Set()
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
  static taskRunning = false
  static systemRegistered = false
  static pushBound = false
  static ability: UIAbility | null = null
  static listeners: Array<() => void> = []
  static readonly prefix = '/api/instant-message/calls'
  static readonly alias = new util.TextEncoder().encodeInto('nuwax-voip-context')

  static emit(type: string, code: string = '', snapshot?: CallData, reason: string = '', enabled?: boolean): void {
    const event: CallEvent = { type, code, scope: VoipBridge.configuration?.scope ?? '',
      callId: VoipBridge.current?.callId ?? '', snapshot, reason, enabled }
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
      else if (command.op === 'background') {
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
  static initialize(config: Configuration): void {
    if ((!config.development && !config.qaAccepted && !config.businessEnabled) || !config.accessToken || !config.userId ||
      (!config.apiBaseUrl.startsWith('https://') && !(config.development && config.apiBaseUrl.startsWith('http://')))) return
    if ((config.development || (config.businessEnabled && !config.qaAccepted)) && !BuildProfile.DEBUG) return
    const previous = VoipBridge.configuration
    if (previous && (previous.userId !== config.userId || previous.apiBaseUrl !== config.apiBaseUrl || previous.deviceId !== config.deviceId)) VoipBridge.reset()
    VoipBridge.configuration = config
    try {
      const attributes: asset.AssetMap = new Map()
      attributes.set(asset.Tag.ALIAS, VoipBridge.alias)
      attributes.set(asset.Tag.SECRET, new util.TextEncoder().encodeInto(JSON.stringify(config)))
      attributes.set(asset.Tag.ACCESSIBILITY, asset.Accessibility.DEVICE_FIRST_UNLOCKED)
      attributes.set(asset.Tag.CONFLICT_RESOLUTION, asset.ConflictResolution.OVERWRITE)
      attributes.set(asset.Tag.SYNC_TYPE, asset.SyncType.THIS_DEVICE)
      asset.addSync(attributes)
    } catch (_) { VoipBridge.emit('error', 'CALL_SECURE_STORAGE_FAILED') }
    if (!VoipBridge.systemRegistered) {
      voipCall.on('voipCallUiEvent', info => VoipBridge.systemEvent(info))
      VoipBridge.systemRegistered = true
    }
    if (VoipBridge.ability) VoipBridge.registerPush(VoipBridge.ability)
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
  static restore(): void {
    if (VoipBridge.configuration) return
    try {
      const query: asset.AssetMap = new Map()
      query.set(asset.Tag.ALIAS, VoipBridge.alias); query.set(asset.Tag.RETURN_TYPE, asset.ReturnType.ALL)
      const items = asset.querySync(query)
      const secret = items[0]?.get(asset.Tag.SECRET) as Uint8Array
      if (secret) VoipBridge.initialize(JSON.parse(new util.TextDecoder().decodeWithStream(secret)) as Configuration)
    } catch (_) { /* No login context is the normal first-launch state. */ }
  }
  /** Called synchronously at EntryAbility.onCreate, before any await or other push receiver. */
  static bindPush(ability: UIAbility): void {
    VoipBridge.ability = ability
    VoipBridge.context = ability.context
    VoipBridge.restore()
    if (VoipBridge.configuration) VoipBridge.registerPush(ability)
  }
  static registerPush(ability: UIAbility): void {
    if (VoipBridge.pushBound) return
    VoipBridge.pushBound = true
    pushService.receiveMessage('VoIP', ability, payload => {
      const info = payload as pushCommon.VoIPInfo
      VoipBridge.incoming(info).catch(() => VoipBridge.emit('error', 'CALL_INVITATION_FAILED'))
    })
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
  static async receiveInvitation(message: CallData): Promise<void> {
    const config = VoipBridge.configuration, body = message.body
    if (!config || message.msgType !== 'voip' || (message.senderType ?? 1) !== 1 || (message.msgStatus ?? 1) !== 1 || !body || !body.callId || !body.roomName || !['audio', 'video'].includes(body.mediaType)) return
    const sent = message.sendTime ?? 0, id = body.callId
    if (message.senderId === config.userId || sent <= 0 || sent + 60000 <= Date.now() || VoipBridge.terminal.has(id) || VoipBridge.current?.callId === id) return
    const detail = await VoipBridge.request(`/api/instant-message/conversations/${message.convId}`, '', true)
    if (VoipBridge.configuration !== config || detail.convType !== 1 || detail.peerUserId !== message.senderId) return
    const next: CallData = { protocol: 'im-voip-v1', callId: id, roomName: body.roomName, msgId: message.msgId, convId: message.convId, version: 1, state: 'ringing', callerId: message.senderId ?? '', calleeId: config.userId, callerDeviceId: '', acceptedDeviceId: '', mediaType: body.mediaType, displayName: detail.peerName ?? '', callerDisplayName: detail.peerName, expiresAt: sent + 60000, connectedAt: 0, reason: '' }
    if (VoipBridge.current && VoipBridge.current.callId !== id) { VoipBridge.notifyBusinessEnd(next, 'busy'); VoipBridge.terminal.add(id); return }
    VoipBridge.adopt(next)
  }
  static receiveSignal(event: CallData): void {
    const call = VoipBridge.current, payload = event.payload
    if (payload?.callId && ['voip:cancel', 'voip:timeout', 'voip:decline'].includes(event.eventType ?? '')) { VoipBridge.terminal.add(payload.callId); if (VoipBridge.terminal.size > 128) VoipBridge.terminal.delete(VoipBridge.terminal.values().next().value) }
    if (!call || !payload || payload.convId !== call.convId || !((payload.callId && payload.callId === call.callId) || (payload.msgId && payload.msgId === call.msgId))) return
    if (event.eventType === 'voip:answered') {
      if (call.calleeId === VoipBridge.configuration?.userId && !call.acceptedDeviceId) VoipBridge.finish('answeredElsewhere')
    } else if (['voip:cancel', 'voip:timeout', 'voip:decline'].includes(event.eventType ?? '')) VoipBridge.finish('remoteEnded')
  }
  static businessAction(action: string, media: string): void {
    const current = VoipBridge.current
    if (!current) return
    const next = VoipBridge.parse(JSON.stringify(current)); next.version++
    if (action === 'accept' && current.state === 'ringing') {
      next.state = 'connecting'; next.acceptedDeviceId = VoipBridge.configuration?.deviceId ?? ''; next.connectExpiresAt = Date.now() + 30000
      next.mediaType = current.mediaType === 'video' ? media : 'audio'; VoipBridge.adopt(next)
    } else if (action === 'ready' && VoipBridge.connected && VoipBridge.peerReady) { next.state = 'active'; next.connectedAt = Date.now(); VoipBridge.adopt(next) }
    else if (['end', 'cancel', 'reject'].includes(action)) VoipBridge.finish(action === 'reject' ? 'rejected' : 'cancel')
  }
  static async mediaJoined(): Promise<void> {
    const call = VoipBridge.current, config = VoipBridge.configuration
    if (!call || !config) return
    if (call.callerId === config.userId) {
      const invitation: InvitationBody = { callId: call.callId, roomName: call.roomName ?? '', mediaType: call.mediaType }
      const result = await VoipBridge.request('/api/instant-message/messages', JSON.stringify({ convId: call.convId, deviceId: config.deviceId, clientMsgId: call.callId, msgType: 'voip', body: invitation }), true, config)
      if (VoipBridge.configuration !== config || VoipBridge.current?.callId !== call.callId) { call.msgId = result.msgId; VoipBridge.notifyBusinessEnd(call, 'cancel', config); return }
      const next = VoipBridge.parse(JSON.stringify(VoipBridge.current)); next.msgId = result.msgId; next.version++; VoipBridge.adopt(next)
    } else await VoipBridge.request('/answered', JSON.stringify({ convId: call.convId, msgId: call.msgId, callId: call.callId, roomName: call.roomName }))
  }
  static notifyBusinessEnd(call: CallData, reason: string, captured: Configuration | null = null): void {
    const config = captured ?? VoipBridge.configuration
    if (!call.msgId || !reason || ['remoteEnded', 'answeredElsewhere', 'sessionChanged'].includes(reason)) return
    const caller = call.callerId === config?.userId
    if (!caller && call.state !== 'ringing') return
    VoipBridge.request(caller ? '/ended' : '/declined', JSON.stringify({ convId: call.convId, msgId: call.msgId, callId: call.callId, roomName: call.roomName, reason: caller ? (reason === 'timeout' ? 'timeout' : 'cancel') : undefined }), false, config).catch(() => {})
  }
  static adopt(value: CallData): void {
    const config = VoipBridge.configuration, previous = VoipBridge.current
    if (!config || !value.callId || value.version < 1 || VoipBridge.terminal.has(value.callId) ||
      (value.callerId !== config.userId && value.calleeId !== config.userId)) return
    const ranks = ['ringing', 'connecting', 'active', 'ended']; const rank = ranks.indexOf(value.state)
    if (rank < 0) return
    if (previous && previous.callId === value.callId && (value.version <= previous.version || rank < ranks.indexOf(previous.state))) return
    if (previous && previous.callId !== value.callId && previous.state !== 'ended') return
    if (value.state === 'ringing' && value.expiresAt <= Date.now()) return
    if (!previous || previous.callId !== value.callId) { VoipBridge.microphone = true; VoipBridge.camera = value.mediaType === 'video' }
    VoipBridge.current = value; VoipBridge.emit('snapshot', '', value)
    if (value.state === 'ended') { VoipBridge.finish(); return }
    if (value.calleeId === config.userId && value.acceptedDeviceId && value.acceptedDeviceId !== config.deviceId) { VoipBridge.finish('answeredElsewhere'); return }
    if (value.state === 'ringing') {
      if (VoipBridge.business() && value.callerId === config.userId && value.callerDeviceId === config.deviceId && VoipBridge.mediaId !== value.callId) VoipBridge.connect(value).catch(() => VoipBridge.finish('mediaFailed'))
      if (value.callerId === config.userId && value.callerDeviceId === config.deviceId && !VoipBridge.nativeId) VoipBridge.outgoing(value)
      if (VoipBridge.expiry >= 0) clearTimeout(VoipBridge.expiry)
      VoipBridge.expiry = setTimeout(() => { if (VoipBridge.current?.state === 'ringing') VoipBridge.finish('timeout') }, Math.max(0, value.expiresAt - Date.now()))
    } else {
      if (VoipBridge.expiry >= 0) clearTimeout(VoipBridge.expiry)
      if (value.state === 'connecting') VoipBridge.expiry = setTimeout(() => {
        if (VoipBridge.current?.callId === value.callId && VoipBridge.current.state === 'connecting') VoipBridge.finish('connectionTimeout')
      }, Math.max(0, Math.min(30000, (value.connectExpiresAt ?? (Date.now() + 30000)) - Date.now())))
      const owner = (value.callerId === config.userId && value.callerDeviceId === config.deviceId) || (value.calleeId === config.userId && value.acceptedDeviceId === config.deviceId)
      if (owner && VoipBridge.mediaId !== value.callId) VoipBridge.connect(value).catch(() => VoipBridge.finish('mediaFailed'))
    }
  }
  static async action(action: string, mediaType: string = 'audio'): Promise<void> {
    const call = VoipBridge.current, run = VoipBridge.generation, token = VoipBridge.configuration?.accessToken; if (!call) return
    if (VoipBridge.business()) { VoipBridge.businessAction(action, mediaType); return }
    if (['end', 'cancel', 'reject'].includes(action)) VoipBridge.media(JSON.stringify({ op: 'disconnect', callId: call.callId }))
    try {
      const next = await VoipBridge.request(`/${call.callId}/actions`, JSON.stringify({ action, actionId: util.generateRandomUUID(), answerMediaType: mediaType }))
      if (VoipBridge.current?.callId === call.callId) VoipBridge.adopt(next)
    } catch (_) { if (run !== VoipBridge.generation || token !== VoipBridge.configuration?.accessToken || VoipBridge.current?.callId !== call.callId) return; if (action !== 'ready') VoipBridge.finish('failed'); VoipBridge.emit('error', 'CALL_ACTION_FAILED') }
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
    VoipBridge.media(JSON.stringify({ op: 'connect', protocol: call.protocol, callId: call.callId, serverUrl: credentials.serverUrl, participantToken: credentials.participantToken, mediaType: call.mediaType, microphoneEnabled: VoipBridge.microphone, cameraEnabled: VoipBridge.camera }))
    VoipBridge.showMedia()
  }
  static showMedia(): void {
    if (!VoipBridge.current || !VoipBridge.context) return
    VoipBridge.context.startAbility({ bundleName: VoipBridge.context.abilityInfo.bundleName, abilityName: 'NuwaxVoipMediaAbility' }).catch(() => VoipBridge.emit('error', 'CALL_MEDIA_HOST_FAILED'))
  }
  static media(raw: string): void {
    if (!VoipBridge.controller || !VoipBridge.mediaReady) { VoipBridge.commands.push(raw); if (VoipBridge.commands.length > 16) VoipBridge.commands.shift(); return }
    VoipBridge.controller.runJavaScript(`window.nuwaxVoipMedia.execute(${JSON.stringify(raw)})`).catch(() => VoipBridge.emit('error', 'CALL_MEDIA_COMMAND_FAILED'))
  }
  static mediaEvent(raw: string): void {
    try {
      const event = JSON.parse(raw) as MediaEvent
      if (event.type === 'webReady') {
        VoipBridge.mediaReady = true; const pending = VoipBridge.commands; VoipBridge.commands = []
        pending.forEach(command => VoipBridge.media(command)); return
      }
      if (!VoipBridge.current || event.callId !== VoipBridge.current.callId) return
      if (event.type === 'connected') { VoipBridge.connected = true; VoipBridge.startTask(); if (VoipBridge.business()) VoipBridge.mediaJoined().catch(() => VoipBridge.finish('mediaFailed')) }
      if (event.type === 'peerMediaReady') VoipBridge.peerReady = true
      if (event.type === 'disconnected' || event.type === 'error') { VoipBridge.finish('disconnected'); return }
      VoipBridge.emit(event.type, event.code)
      if (VoipBridge.connected && VoipBridge.peerReady && !VoipBridge.readySent) { VoipBridge.readySent = true; VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_ACTIVE); VoipBridge.action('ready') }
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
  static async incoming(info: pushCommon.VoIPInfo): Promise<void> {
    VoipBridge.restore()
    if (!info.callId) return
    if (!VoipBridge.configuration) { await voipCall.reportIncomingCallError(info.callId, voipCall.VoipCallFailureCause.OTHER); return }
    const run = VoipBridge.generation
    let call: CallData
    try { call = JSON.parse(info.data) as CallData } catch (_) { await voipCall.reportIncomingCallError(info.callId, voipCall.VoipCallFailureCause.OTHER); return }
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(call.callId) || call.calleeId !== VoipBridge.configuration.userId || call.expiresAt <= Date.now() || VoipBridge.terminal.has(call.callId)) {
      await voipCall.reportIncomingCallError(info.callId, voipCall.VoipCallFailureCause.OTHER); return
    }
    if (VoipBridge.current && VoipBridge.current.callId !== call.callId) {
      await voipCall.reportIncomingCallError(info.callId, voipCall.VoipCallFailureCause.ROUTE_BUSY); return
    }
    if (VoipBridge.current && VoipBridge.nativeId) {
      if (VoipBridge.current.callId === call.callId && VoipBridge.nativeId === info.callId) return
      await voipCall.reportIncomingCallError(info.callId, voipCall.VoipCallFailureCause.ROUTE_BUSY); return
    }
    VoipBridge.nativeId = info.callId // Never substitute the business id for the native push id.
    const picture = await image.createPixelMap(new Uint8Array([61, 89, 139, 255]).buffer, { size: { width: 1, height: 1 }, pixelFormat: image.PixelMapFormat.RGBA_8888 })
    try {
      if (run !== VoipBridge.generation) return
      const result = await voipCall.reportIncomingCall({ callId: info.callId, voipCallType: call.mediaType === 'video' ? voipCall.VoipCallType.VOIP_CALL_VIDEO : voipCall.VoipCallType.VOIP_CALL_VOICE,
        userName: call.displayName || call.callerId, userProfile: picture, abilityName: 'NuwaxVoipMediaAbility',
        voipCallState: voipCall.VoipCallState.VOIP_CALL_STATE_RINGING, isConferenceCall: false, isVoiceAnswerSupported: true })
      if (result !== voipCall.ErrorReason.ERROR_NONE) throw new Error('CALL_SYSTEM_UNAVAILABLE')
      if (run !== VoipBridge.generation) { await voipCall.reportCallStateChange(info.callId, voipCall.VoipCallState.VOIP_CALL_STATE_DISCONNECTED); return }
      VoipBridge.adopt(await VoipBridge.request(`/${call.callId}`))
    } catch (_) {
      if (run === VoipBridge.generation && VoipBridge.nativeId === info.callId) VoipBridge.finish('invitationFailed')
    } finally { picture.release() }
  }
  static systemEvent(info: voipCall.VoipCallUiEventInfo): void {
    if (info.callId !== VoipBridge.nativeId) return
    const event = info.voipCallUiEvent
    if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_VOICE_ANSWER || event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_VIDEO_ANSWER) {
      VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_ANSWERED)
      VoipBridge.action('accept', event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_VIDEO_ANSWER ? 'video' : 'audio')
    } else if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_REJECT) VoipBridge.action('reject')
    else if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_HANGUP) VoipBridge.action('end')
    else if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_MUTED || event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_UNMUTED) {
      VoipBridge.microphone = event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_UNMUTED
      VoipBridge.media(JSON.stringify({ op: 'microphone', enabled: VoipBridge.microphone })); VoipBridge.emit('microphone', '', undefined, '', VoipBridge.microphone)
    } else if (event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_SPEAKER_ON || event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_SPEAKER_OFF) VoipBridge.speaker(event === voipCall.VoipCallUiEvent.VOIP_CALL_EVENT_SPEAKER_ON)
  }
  static reportState(state: voipCall.VoipCallState): void {
    if (VoipBridge.nativeId) voipCall.reportCallStateChange(VoipBridge.nativeId, state).catch(() => {})
  }
  static speaker(enabled: boolean): void {
    audio.getAudioManager().getRoutingManager().setCommunicationDevice(audio.CommunicationDeviceType.SPEAKER, enabled).then(() => VoipBridge.emit('speaker', '', undefined, '', enabled)).catch(() => VoipBridge.emit('error', 'CALL_AUDIO_ROUTE_FAILED'))
  }
  static async startTask(): Promise<void> {
    const context = VoipBridge.mediaContext, run = VoipBridge.generation
    if (!context || VoipBridge.taskRunning) return
    try {
      const agent = await wantAgent.getWantAgent({ wants: [{ bundleName: context.abilityInfo.bundleName, abilityName: 'NuwaxVoipMediaAbility' }], actionType: wantAgent.OperationType.START_ABILITY, requestCode: 9090, actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG] })
      if (run !== VoipBridge.generation || !VoipBridge.current) return
      await backgroundTaskManager.startBackgroundRunning(context, backgroundTaskManager.BackgroundMode.VOIP, agent)
      if (run !== VoipBridge.generation || !VoipBridge.current) { await backgroundTaskManager.stopBackgroundRunning(context); return }
      VoipBridge.taskRunning = true
    } catch (_) { VoipBridge.emit('error', 'CALL_BACKGROUND_UNAVAILABLE'); VoipBridge.action('end') }
  }
  static finish(reason: string = ''): void {
    const call = VoipBridge.current
    if (call && VoipBridge.business()) VoipBridge.notifyBusinessEnd(call, reason)
    if (!VoipBridge.business() && call && reason && reason !== 'answeredElsewhere' && reason !== 'sessionChanged') {
      const action = call.state === 'ringing' && call.calleeId === VoipBridge.configuration?.userId ? 'reject' : 'end'
      VoipBridge.request(`/${call.callId}/actions`, JSON.stringify({ action, actionId: util.generateRandomUUID() })).catch(() => {})
    }
    const id = call?.callId
    if (id) { VoipBridge.terminal.add(id); if (VoipBridge.terminal.size > 128) VoipBridge.terminal.delete(VoipBridge.terminal.values().next().value) }
    if (VoipBridge.expiry >= 0) clearTimeout(VoipBridge.expiry)
    VoipBridge.media(JSON.stringify({ op: 'disconnect', callId: id })); VoipBridge.commands = []
    VoipBridge.reportState(voipCall.VoipCallState.VOIP_CALL_STATE_DISCONNECTED); VoipBridge.nativeId = ''
    if (VoipBridge.mediaContext && VoipBridge.taskRunning) backgroundTaskManager.stopBackgroundRunning(VoipBridge.mediaContext).catch(() => {})
    VoipBridge.taskRunning = false
    if (reason) VoipBridge.emit('localEnded', '', undefined, reason)
    VoipBridge.current = null; VoipBridge.mediaId = ''; VoipBridge.connected = false; VoipBridge.peerReady = false
    VoipBridge.listeners.forEach(callback => callback())
  }
  static reset(): void {
    if (VoipBridge.current) VoipBridge.action(VoipBridge.current.state === 'ringing' && VoipBridge.current.calleeId === VoipBridge.configuration?.userId ? 'reject' : 'end')
    VoipBridge.generation++; VoipBridge.stopSocket(); VoipBridge.stream?.destroy(); VoipBridge.stream = null
    if (VoipBridge.retry >= 0) clearTimeout(VoipBridge.retry)
    VoipBridge.finish('sessionChanged'); VoipBridge.configuration = null; VoipBridge.terminal.clear(); VoipBridge.queue = []; VoipBridge.cursor = ''
    const query: asset.AssetMap = new Map(); query.set(asset.Tag.ALIAS, VoipBridge.alias)
    try { asset.removeSync(query) } catch (_) {}
  }
}

export class VoipJavaScriptProxy { postMessage(raw: string): void { VoipBridge.mediaEvent(raw) } }
