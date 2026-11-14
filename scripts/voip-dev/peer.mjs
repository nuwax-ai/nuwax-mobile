import { createMediaEngine } from './media.mjs';
const $ = id => document.getElementById(id);
const base = '/api/instant-message/calls';
const deviceId = sessionStorage.getItem('voip-dev-device') ?? crypto.randomUUID();
sessionStorage.setItem('voip-dev-device', deviceId);
const terminals = new Set();
let token = '', userId = '', current = null, streamAbort = null, joining = '', ready = false, connected = false, peerReady = false, loginGeneration = 0;
const engine = createMediaEngine(async event => {
  if (event.callId && event.callId !== current?.callId) return;
  if (event.type === 'connected') connected = true;
  if (event.type === 'peerMediaReady') peerReady = true;
  if (connected && peerReady && !ready && current?.state === 'connecting') {
    ready = true; await action('ready').catch(showError);
  }
  if (event.type === 'error') showError(new Error(event.code));
  if (event.type === 'playbackBlocked') $('play').textContent = '点击允许播放声音';
}, $('media'));
function showError(error) { $('status').textContent = error.message; }
async function api(path, data) {
  const response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-call-device-id': deviceId },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  const result = await response.json();
  if (result.code !== '0000') throw new Error(result.code);
  return result.data;
}
async function apply(snapshot, generation = loginGeneration) {
  if (generation !== loginGeneration || terminals.has(snapshot.callId)) return;
  if (current?.callId === snapshot.callId && (current.state === 'ended' || current.version >= snapshot.version)) return;
  if (current && current.state !== 'ended' && current.callId !== snapshot.callId) return;
  current = snapshot; $('status').textContent = JSON.stringify(snapshot, null, 2);
  if (snapshot.state === 'ended') { terminals.add(snapshot.callId); if (terminals.size > 128) terminals.delete(terminals.values().next().value); joining = ''; await engine.execute({ op: 'disconnect' }); return; }
  if (snapshot.state === 'ringing' && snapshot.calleeId === userId && userId === 'agent') await action('accept');
  const owner = (snapshot.callerId === userId && snapshot.callerDeviceId === deviceId) ||
    (snapshot.calleeId === userId && snapshot.acceptedDeviceId === deviceId);
  if (owner && ['connecting', 'active'].includes(snapshot.state) && joining !== snapshot.callId) {
    joining = snapshot.callId; connected = false; peerReady = false; ready = false;
    const credentials = await api(`${base}/${snapshot.callId}/credentials`, {});
    if (generation !== loginGeneration || current?.callId !== snapshot.callId || current.state === 'ended') return;
    await engine.execute({ op: 'connect', callId: snapshot.callId, ...credentials, mediaType: snapshot.mediaType,
      synthetic: userId === 'agent' || $('synthetic').checked });
  }
}
async function action(name) {
  if (!current) return;
  const generation = loginGeneration;
  const snapshot = await api(`${base}/${current.callId}/actions`, { action: name, actionId: crypto.randomUUID(), answerMediaType: current.mediaType });
  await apply(snapshot, generation);
}
async function stream(generation) {
  let cursor = '';
  while (generation === loginGeneration) {
    streamAbort = new AbortController();
    try {
      const response = await fetch(`${base}/events`, { headers: { authorization: `Bearer ${token}`, 'x-call-device-id': deviceId, 'last-event-id': cursor }, signal: streamAbort.signal });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('CALL_EVENT_STREAM_FAILED');
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '';
      while (generation === loginGeneration) {
        const result = await reader.read(); if (result.done) break;
        buffer += decoder.decode(result.value, { stream: true }).replace(/\r/g, '');
        let index;
        while ((index = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, index); buffer = buffer.slice(index + 2);
          const data = frame.split('\n').find(line => line.startsWith('data: '));
          const id = frame.split('\n').find(line => line.startsWith('id: '));
          if (id) cursor = id.slice(4);
          if (data && generation === loginGeneration) await apply(JSON.parse(data.slice(6)), generation);
        }
      }
    } catch (error) { if (error.name !== 'AbortError' && generation === loginGeneration) showError(error); }
    if (generation === loginGeneration) await new Promise(resolve => setTimeout(resolve, 1000));
  }
}
$('login').onclick = async () => {
  if (current && current.state !== 'ended') api(`${base}/${current.callId}/actions`, { action: current.state === 'ringing' ? (current.callerId === userId ? 'cancel' : 'reject') : 'end', actionId: crypto.randomUUID() }).catch(() => {});
  const generation = ++loginGeneration; terminals.clear(); streamAbort?.abort(); await engine.execute({ op: 'disconnect' }); current = null; joining = '';
  userId = $('identity').value;
  const response = await fetch('/dev/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }) });
  const session = (await response.json()).data;
  if (generation !== loginGeneration) return;
  token = session.accessToken;
  $('status').textContent = `开发身份 ${userId}，设备 ${deviceId}`;
  stream(loginGeneration).catch(showError);
};
for (const mode of ['audio', 'video']) $('' + mode).onclick = async () => {
  const generation = loginGeneration;
  try { await apply(await api(base, { convId: $('conversation').value, mediaType: mode, requestId: crypto.randomUUID() }), generation); } catch (error) { showError(error); }
};
for (const name of ['accept', 'reject']) $(name).onclick = () => action(name).catch(showError);
$('end').onclick = () => action(current?.state === 'ringing' && current.callerId === userId ? 'cancel' : 'end').catch(showError);
$('play').onclick = () => engine.startAudio().catch(showError);
for (const mode of ['duplicate', 'stale', 'disconnectControl']) $(mode).onclick = () => {
  if (current) api('/dev/inject', { callId: current.callId, mode }).catch(showError);
};

// Local diagnostics never expose tokens or peer identities.
window.nuwaxVoipDevStats = async () => {
  const room = engine.room();
  const local = await room?.localParticipant.getTrackPublication("microphone")?.audioTrack?.getSenderStats();
  const remote = [];
  for (const participant of room?.remoteParticipants.values() ?? []) {
    const stats = await participant.getTrackPublication("microphone")?.audioTrack?.getReceiverStats();
    if (stats) remote.push(stats);
  }
  return { state: room?.state ?? "disconnected", local, remote };
};
