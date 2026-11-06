import { Room, RoomEvent, Track } from 'livekit-client';

/** Only media commands cross this bridge; platform/auth credentials never enter the HTML URL. */
export function createMediaEngine(emit, root = document.body) {
  let room = null, generation = 0, fixture = null, microphone = true, camera = false, hidden = false, callId = '';
  const views = new Set();
  const notify = (type, extra = {}) => emit({ type, callId, ...extra });
  const clear = async () => {
    const previous = room; room = null;
    const oldFixture = fixture; fixture = null;
    for (const view of views) view.remove();
    views.clear();
    if (oldFixture) { oldFixture.oscillator.stop(); await oldFixture.context.close(); }
    await previous?.disconnect();
  };
  async function execute(command) {
    if (command.op !== 'connect' && command.callId && command.callId !== callId) return;
    if (command.op === 'disconnect') { const run = ++generation, previousId = callId; await clear(); if (run === generation) notify('disconnected', { callId: previousId }); return; }
    if (command.op === 'microphone') {
      microphone = command.enabled;
      if (fixture) {
        const track = room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
        if (microphone) await track?.unmute(); else await track?.mute();
      } else await room?.localParticipant.setMicrophoneEnabled(microphone);
      notify('microphone', { enabled: microphone }); return;
    }
    if (command.op === 'camera') { camera = command.enabled; await room?.localParticipant.setCameraEnabled(camera); return; }
    if (command.op === 'switchCamera') {
      const publication = room?.localParticipant.getTrackPublication(Track.Source.Camera);
      if (publication?.videoTrack) {
        const mode = publication.videoTrack.mediaStreamTrack.getSettings().facingMode;
        await publication.videoTrack.restartTrack({ facingMode: mode === 'environment' ? 'user' : 'environment' });
      }
      return;
    }
    if (command.op === 'background') {
      // Camera capture is intentionally stopped in background, audio belongs to the native VoIP task.
      hidden = command.hidden === true;
      if (hidden) await room?.localParticipant.setCameraEnabled(false);
      else if (camera) await room?.localParticipant.setCameraEnabled(true);
      return;
    }
    if (command.op !== 'connect') return;
    const run = ++generation;
    await clear();
    if (run !== generation) return;
    camera = command.mediaType === 'video' && command.cameraEnabled !== false; callId = command.callId ?? ''; microphone = command.microphoneEnabled !== false;
    const next = new Room({ adaptiveStream: true, dynacast: true,
      videoCaptureDefaults: { resolution: { width: 640, height: 360, frameRate: 20 } } });
    room = next;
    const current = () => run === generation && room === next;
    next.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (!current()) return;
      const element = track.attach();
      element.autoplay = true;
      if (element instanceof HTMLVideoElement) element.playsInline = true;
      element.dataset.participant = participant.identity;
      element.className = track.kind === Track.Kind.Video ? 'remote-video' : 'remote-audio';
      views.add(element); root.append(element);
      if (track.kind === Track.Kind.Audio) notify('peerMediaReady');
    });
    next.on(RoomEvent.TrackUnsubscribed, track => { for (const element of track.detach()) { views.delete(element); element.remove(); } });
    next.on(RoomEvent.Reconnecting, () => { if (current()) notify('reconnecting'); });
    next.on(RoomEvent.Reconnected, () => { if (current()) notify('connected'); });
    next.on(RoomEvent.AudioPlaybackStatusChanged, () => { if (current() && !next.canPlaybackAudio) notify('playbackBlocked'); });
    next.on(RoomEvent.Disconnected, () => { if (current()) notify('disconnected'); });
    try {
      await next.connect(command.serverUrl, command.participantToken);
      if (!current()) { await next.disconnect(); return; }
      await next.startAudio?.();
      if (command.synthetic === true) {
        // Explicit test fixture: real WebRTC audio, does NOT validate the microphone/voice AI.
        const context = new AudioContext(); const oscillator = context.createOscillator();
        const gain = context.createGain(); gain.gain.value = 0.015;
        const destination = context.createMediaStreamDestination();
        oscillator.frequency.value = 440; oscillator.connect(gain).connect(destination); oscillator.start();
        fixture = { context, oscillator };
        await context.resume();
        await next.localParticipant.publishTrack(destination.stream.getAudioTracks()[0], { source: Track.Source.Microphone });
      } else await next.localParticipant.setMicrophoneEnabled(microphone);
      if (!current()) { await next.disconnect(); return; }
      if (camera && !hidden) {
        await next.localParticipant.setCameraEnabled(true);
        if (!current()) { await next.disconnect(); return; }
        const element = next.localParticipant.getTrackPublication(Track.Source.Camera)?.videoTrack?.attach();
        if (element) { element.muted = true; element.className = 'local-video'; views.add(element); root.append(element); }
      }
      if (current()) notify('connected');
    } catch {
      if (current()) { await clear(); notify('error', { code: 'MEDIA_CONNECT_FAILED' }); }
      else await next.disconnect();
    }
  }
  return { execute, async startAudio() { await room?.startAudio(); }, room: () => room };
}

if (document.documentElement.dataset.native === 'true') {
  const engine = createMediaEngine(event => window.NuwaxVoip?.postMessage(JSON.stringify(event)), document.getElementById('media'));
  window.nuwaxVoipMedia = { execute: raw => engine.execute(JSON.parse(raw)).catch(() => window.NuwaxVoip?.postMessage(JSON.stringify({ type: 'error', code: 'MEDIA_COMMAND_FAILED' }))) };
  window.NuwaxVoip?.postMessage(JSON.stringify({ type: 'webReady' }));
}
