import { randomUUID } from 'node:crypto';

export class CallError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = code => { throw new CallError(code); };

/** 开发服务的权威状态。无生产账号、持久化、厂商密钥或平台 API。 */
export class CallRegistry {
  calls = new Map();
  requests = new Map();
  actions = new Map();
  listeners = new Set();
  history = [];
  sequence = 0;
  constructor({ now = Date.now, conversations, ringMs = 45_000 } = {}) {
    this.now = now;
    this.ringMs = ringMs;
    this.conversations = conversations ?? new Map([
      ['demo-people', ['alice', 'bob']], ['demo-agent', ['alice', 'agent']],
    ]);
  }
  public(call) {
    const { readyDevices, ...snapshot } = call;
    return structuredClone(snapshot);
  }
  emit(call) {
    const event = { eventId: String(++this.sequence), snapshot: this.public(call) };
    this.history.push(event);
    if (this.history.length > 256) this.history.shift();
    for (const listener of this.listeners) listener(event);
    return this.public(call);
  }
  update(call, fields) {
    Object.assign(call, fields, { version: call.version + 1 });
    return this.emit(call);
  }
  get(callId, userId) {
    const call = this.calls.get(callId);
    if (!call || (call.callerId !== userId && call.calleeId !== userId)) fail('CALL_NOT_FOUND');
    return call;
  }
  replay(userId, cursor) {
    const visible = s => s.callerId === userId || s.calleeId === userId;
    const id = Number(cursor);
    if (!cursor || !Number.isSafeInteger(id) || id < Number(this.history[0]?.eventId ?? 0) || id > this.sequence) {
      return [...this.calls.values()].filter(visible).map(c => ({ eventId: String(this.sequence), snapshot: this.public(c) }));
    }
    return this.history.filter(e => Number(e.eventId) > id && visible(e.snapshot));
  }
  expire() {
    for (const call of this.calls.values()) {
      if (call.state === 'ringing' && call.expiresAt <= this.now()) {
        this.update(call, { state: 'ended', reason: 'timeout', endedAt: this.now() });
      } else if (call.state === 'connecting' && call.connectExpiresAt <= this.now()) {
        this.update(call, { state: 'ended', reason: 'connectionTimeout', endedAt: this.now() });
      }
    }
  }
  create(userId, deviceId, { convId, mediaType, requestId }) {
    this.expire();
    if (typeof requestId !== 'string' || requestId.length < 1 || requestId.length > 128 || !deviceId || !['audio', 'video'].includes(mediaType)) fail('CALL_INVALID_ARGUMENT');
    const members = this.conversations.get(convId);
    if (!members?.includes(userId)) fail('CALL_NOT_FOUND');
    const key = `${userId}:${deviceId}:${requestId}`;
    const previous = this.requests.get(key);
    if (previous) {
      const call = this.calls.get(previous);
      if (call.convId !== convId || call.mediaType !== mediaType) fail('CALL_IDEMPOTENCY_CONFLICT');
      return this.public(call);
    }
    const calleeId = members.find(id => id !== userId);
    if (!calleeId || (members.includes('agent') && mediaType !== 'audio')) fail('CALL_MEDIA_UNSUPPORTED');
    if ([...this.calls.values()].some(c => c.state !== 'ended' &&
      [c.callerId, c.calleeId].some(id => id === userId || id === calleeId))) fail('CALL_BUSY');
    const call = { callId: randomUUID(), convId, version: 1, state: 'ringing', callerId: userId, calleeId,
      callerDeviceId: deviceId, acceptedDeviceId: '', mediaType, peerKind: members.includes('agent') ? 'agent' : 'user',
      displayName: userId, callerDisplayName: userId, calleeDisplayName: calleeId, createdAt: this.now(), expiresAt: this.now() + this.ringMs,
      connectExpiresAt: 0, connectedAt: 0, endedAt: 0, reason: '', readyDevices: new Set() };
    this.calls.set(call.callId, call);
    this.requests.set(key, call.callId);
    return this.emit(call);
  }
  action(userId, deviceId, callId, { action, actionId, answerMediaType }) {
    this.expire();
    const call = this.get(callId, userId);
    if (!actionId || !deviceId) fail('CALL_INVALID_ARGUMENT');
    const key = `${callId}:${userId}:${deviceId}:${actionId}`;
    const previous = this.actions.get(key);
    if (previous && previous !== action) fail('CALL_IDEMPOTENCY_CONFLICT');
    if (previous) return this.public(call);
    const caller = userId === call.callerId && deviceId === call.callerDeviceId;
    const winner = userId === call.calleeId && deviceId === call.acceptedDeviceId;
    if (action === 'accept') {
      if (userId !== call.calleeId) fail('CALL_FORBIDDEN');
      if (call.state !== 'ringing') fail(call.state === 'ended' ? 'CALL_ENDED' : 'CALL_ANSWERED_ELSEWHERE');
      if (!['audio', 'video'].includes(answerMediaType) || (call.mediaType === 'audio' && answerMediaType !== 'audio')) fail('CALL_MEDIA_UNSUPPORTED');
      this.update(call, { state: 'connecting', acceptedDeviceId: deviceId, mediaType: answerMediaType, connectExpiresAt: this.now() + 30_000 });
    } else if (action === 'ready') {
      if (!caller && !winner) fail('CALL_FORBIDDEN');
      if (call.state !== 'connecting' && call.state !== 'active') fail('CALL_ENDED');
      call.readyDevices.add(`${userId}:${deviceId}`);
      if (call.state !== 'active' && call.readyDevices.has(`${call.callerId}:${call.callerDeviceId}`) && call.readyDevices.has(`${call.calleeId}:${call.acceptedDeviceId}`)) {
        this.update(call, { state: 'active', connectedAt: this.now() });
      }
    } else if (action === 'reject') {
      if (userId !== call.calleeId) fail('CALL_FORBIDDEN');
      if (call.state !== 'ringing') fail('CALL_ANSWERED_ELSEWHERE');
      this.update(call, { state: 'ended', reason: 'rejected', endedAt: this.now() });
    } else if (action === 'cancel') {
      if (!caller) fail('CALL_FORBIDDEN');
      if (call.state !== 'ringing') fail('CALL_CONFLICT');
      this.update(call, { state: 'ended', reason: 'cancelled', endedAt: this.now() });
    } else if (action === 'end') {
      if (!caller && !winner) fail('CALL_FORBIDDEN');
      if (call.state !== 'ended') this.update(call, { state: 'ended', reason: 'hangup', endedAt: this.now() });
    } else fail('CALL_INVALID_ARGUMENT');
    this.actions.set(key, action);
    return this.public(call);
  }
  authorizeMedia(userId, deviceId, callId) {
    const call = this.get(callId, userId);
    if (!['connecting', 'active'].includes(call.state)) fail('CALL_NOT_ACCEPTED');
    if (!((userId === call.callerId && deviceId === call.callerDeviceId) ||
      (userId === call.calleeId && deviceId === call.acceptedDeviceId))) fail('CALL_ANSWERED_ELSEWHERE');
    return call;
  }
}
