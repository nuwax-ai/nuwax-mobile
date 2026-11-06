import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { CallRegistry, CallError } from './registry.mjs';

const prefix = '/api/instant-message/calls';
export function createDevServer({ registry = new CallRegistry(), livekitUrl = 'ws://127.0.0.1:7880',
  apiKey = 'devkey', apiSecret, browserBundle = '', nativeBundle = '', roomService } = {}) {
  if (!apiSecret) throw new Error('VOIP_LIVEKIT_SECRET is required');
  const rooms = roomService ?? new RoomServiceClient(livekitUrl.replace(/^ws/, 'http'), apiKey, apiSecret);
  const devices = new Map();
  const sessions = new Map();
  const channels = new Set();
  const send = (res, data, code = '0000', status = 200) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ code, data, message: code === '0000' ? '' : code }));
  };
  const body = async req => {
    let value = '';
    for await (const chunk of req) {
      value += chunk;
      if (Buffer.byteLength(value) > 16384) throw new CallError('CALL_INVALID_ARGUMENT');
    }
    try { return JSON.parse(value || '{}'); } catch { throw new CallError('CALL_INVALID_ARGUMENT'); }
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    // No permissive CORS: browsers use the same-origin test peer, native clients do not require CORS.
    if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
      res.writeHead(403); res.end(); return;
    }
    try {
      if (url.pathname === '/health') { send(res, { developmentOnly: true, livekitUrl }); return; }
      if (req.method === 'GET' && ['/', '/peer.js', '/media.js', '/media.html'].includes(url.pathname)) {
        const files = { '/': [new URL('./peer.html', import.meta.url), 'text/html'], '/peer.js': [browserBundle, 'text/javascript'],
          '/media.js': [nativeBundle, 'text/javascript'], '/media.html': [new URL('./media.html', import.meta.url), 'text/html'] };
        const [path, type] = files[url.pathname];
        res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store',
          'content-security-policy': "default-src 'self'; script-src 'self'; connect-src 'self' ws: wss:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'" });
        res.end(await readFile(path)); return;
      }
      if (url.pathname === '/dev/login' && req.method === 'POST') {
        const { userId } = await body(req);
        if (!['alice', 'bob', 'agent'].includes(userId)) throw new CallError('CALL_FORBIDDEN');
        const token = randomBytes(24).toString('hex'); sessions.set(token, userId);
        send(res, { accessToken: token, userId }); return;
      }
      const userId = sessions.get((req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!userId) { send(res, null, 'CALL_UNAUTHENTICATED', 401); return; }
      const deviceId = req.headers['x-call-device-id'];
      if (typeof deviceId !== 'string' || !/^[\w.#-]{1,128}$/.test(deviceId)) throw new CallError('CALL_INVALID_DEVICE');
      if (url.pathname === '/dev/inject' && req.method === 'POST') {
        const { callId, mode } = await body(req);
        const call = registry.get(callId, userId);
        if (mode === 'disconnectControl') { for (const stream of channels) stream.end(); }
        else if (['duplicate', 'stale'].includes(mode)) {
          const snapshot = registry.public(call);
          if (mode === 'stale') { snapshot.version = 1; snapshot.state = 'ringing'; }
          const event = { eventId: String(++registry.sequence), snapshot };
          // Deliberately do not mutate authority. This only exercises client event convergence.
          for (const listener of registry.listeners) listener(event);
        } else throw new CallError('CALL_INVALID_ARGUMENT');
        send(res, { injected: true }); return;
      }
      if (url.pathname === `${prefix}/devices` && req.method === 'POST') {
        const value = await body(req);
        // Separate namespaces: an IM cid refresh must never replace the native call token.
        if (!['uniPush', 'pushKit', 'harmonyPush', 'fcm', 'vendor'].includes(value.channel) ||
          !['development', 'production'].includes(value.environment) || typeof value.token !== 'string' || value.token.length > 4096) {
          throw new CallError('CALL_INVALID_ARGUMENT');
        }
        devices.set(`${userId}:${deviceId}:${value.channel}:${value.environment}`, { ...value, userId, deviceId });
        send(res, { registered: value.token.length > 0, nativePush: false }); return;
      }
      if (url.pathname === `${prefix}/capabilities` && req.method === 'GET') {
        const convId = url.searchParams.get('convId');
        const members = registry.conversations.get(convId);
        const enabled = members?.includes(userId) === true;
        send(res, { enabled, audio: enabled, video: enabled && !members.includes('agent'),
          developmentOnly: true, nativePush: false, incomingEvents: `${prefix}/events` }); return;
      }
      const path = url.pathname.slice(prefix.length);
      const match = path.match(/^\/([^/]+)(?:\/(actions|credentials|events))?$/);
      const specific = url.pathname.startsWith(`${prefix}/`) && match && match[1] !== 'events' ? match : null;
      if (req.method === 'GET' && (url.pathname === `${prefix}/events` || specific?.[2] === 'events')) {
        if (specific) registry.get(specific[1], userId);
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' });
        res.flushHeaders();
        const emit = event => {
          const s = event.snapshot;
          if ((s.callerId === userId || s.calleeId === userId) && (!specific || specific[1] === s.callId)) {
            res.write(`id: ${event.eventId}\nevent: call\ndata: ${JSON.stringify(s)}\n\n`);
          }
        };
        registry.listeners.add(emit); channels.add(res);
        for (const event of registry.replay(userId, req.headers['last-event-id'])) emit(event);
        const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 10_000);
        res.on('close', () => { clearInterval(heartbeat); registry.listeners.delete(emit); channels.delete(res); });
        return;
      }
      if (url.pathname === prefix && req.method === 'POST') {
        send(res, registry.create(userId, deviceId, await body(req))); return;
      }
      if (specific && req.method === 'GET' && !specific[2]) {
        registry.expire(); send(res, registry.public(registry.get(specific[1], userId))); return;
      }
      if (specific?.[2] === 'actions' && req.method === 'POST') {
        send(res, registry.action(userId, deviceId, specific[1], await body(req))); return;
      }
      if (specific?.[2] === 'credentials' && req.method === 'POST') {
        const call = registry.authorizeMedia(userId, deviceId, specific[1]);
        const roomName = `voip-${call.callId}`;
        await rooms.createRoom({ name: roomName, maxParticipants: 2, emptyTimeout: 30, departureTimeout: 10 });
        // The room service is async: a hangup/other-device acceptance can occur while it runs.
        registry.authorizeMedia(userId, deviceId, specific[1]);
        const identity = `${call.callId}-${userId}-${deviceId}`;
        const token = new AccessToken(apiKey, apiSecret, { identity, ttl: 60 });
        token.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true,
          canPublishData: false, canPublishSources: call.mediaType === 'video' ? [TrackSource.MICROPHONE, TrackSource.CAMERA] : [TrackSource.MICROPHONE] });
        send(res, { serverUrl: livekitUrl, participantToken: await token.toJwt(), expiresAt: Date.now() + 60_000 }); return;
      }
      send(res, null, 'CALL_NOT_FOUND');
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      // Do not print SDK errors: they can contain credentials/URLs. Return a stable code.
      send(res, null, error instanceof CallError ? error.code : 'CALL_SERVICE_UNAVAILABLE');
    }
  });
  const expiry = setInterval(() => registry.expire(), 250);
  const cleanup = event => {
    if (event.snapshot.state === 'ended') rooms.deleteRoom(`voip-${event.snapshot.callId}`).catch(() => {});
  };
  registry.listeners.add(cleanup);
  const dispose = () => {
    clearInterval(expiry); registry.listeners.delete(cleanup);
    for (const res of channels) res.end();
    server.closeAllConnections();
  };
  server.on('close', dispose);
  return { server, registry, devices, dispose };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { build } = await import('esbuild');
  const out = new URL('../../out/voip-dev/', import.meta.url);
  await mkdir(out, { recursive: true });
  const browserBundle = fileURLToPath(new URL('peer.js', out));
  const nativeBundle = fileURLToPath(new URL('media.js', out));
  await build({ entryPoints: [fileURLToPath(new URL('./peer.mjs', import.meta.url))], bundle: true, outfile: browserBundle, format: 'iife' });
  await build({ entryPoints: [fileURLToPath(new URL('./media.mjs', import.meta.url))], bundle: true, outfile: nativeBundle, format: 'iife' });
  const app = createDevServer({ apiSecret: process.env.VOIP_LIVEKIT_SECRET, apiKey: process.env.VOIP_LIVEKIT_KEY ?? 'devkey',
    livekitUrl: process.env.VOIP_LIVEKIT_URL ?? 'ws://127.0.0.1:7880', browserBundle, nativeBundle });
  const host = process.env.VOIP_DEV_HOST ?? '127.0.0.1';
  const port = Number(process.env.VOIP_DEV_PORT ?? 7890);
  app.server.listen(port, host, () => console.log(`VoIP DEVELOPMENT peer: http://${host}:${port} (no production accounts)`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { app.dispose(); app.server.close(); });
}
