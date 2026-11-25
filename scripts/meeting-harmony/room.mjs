import { ConnectionState, LogLevel, Room, RoomEvent, Track, setLogLevel } from 'livekit-client';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const chatTopic = 'meeting-chat';
const danmakuTopic = 'danmaku';
setLogLevel(LogLevel.silent);

export function createMeetingMedia(post, render) {
  let current;
  const active = (session) => current === session;

  function holder(room) {
    try { return JSON.parse(room.metadata || '{}').shareHolder; } catch { return ''; }
  }

  function canPublish(participant, source) {
    const permissions = participant.permissions;
    return !!permissions?.canPublish && (permissions.canPublishSources.length === 0 ||
      permissions.canPublishSources.includes(Track.sourceToProto(source)));
  }

  function update(session) {
    if (!active(session)) return;
    const { room } = session;
    const local = room.localParticipant;
    const remotes = [...room.remoteParticipants.values()];
    const cameras = [local, ...remotes].flatMap((participant) => {
      const publication = participant.getTrackPublication(Track.Source.Camera);
      return publication?.track && !publication.isMuted ? [{ participant, track: publication.track }] : [];
    });
    const shareHolder = holder(room);
    const ownsShare = shareHolder === local.identity;
    if (session.share && ownsShare) session.share.owned = true;
    if (session.share?.owned && !ownsShare) stopShare(session, 'stopped');
    if (room.state === ConnectionState.Disconnected) stopShare(session);
    const shared = remotes.find((participant) => participant.identity === shareHolder);
    const share = shared?.getTrackPublication(Track.Source.ScreenShare);
    const audioPublications = remotes.flatMap((participant) => [...participant.audioTrackPublications.values()]);
    render(
      cameras,
      share?.track && !share.isMuted ? { participant: shared, track: share.track } : undefined,
      audioPublications.flatMap((publication) => publication.track ? [publication.track] : []),
      session.share && !session.share.started && ownsShare ? session.share : undefined,
    );
    post({
      type: 'state', id: session.id, connection: room.state,
      people: room.state === ConnectionState.Disconnected ? 0 : 1 + remotes.length,
      mic: local.isMicrophoneEnabled, camera: local.isCameraEnabled, level: local.audioLevel,
      remoteAudio: audioPublications.some((publication) => publication.track && !publication.isMuted),
      micAllowed: canPublish(local, Track.Source.Microphone),
      cameraAllowed: canPublish(local, Track.Source.Camera),
      raised: local.attributes.handRaised === '1', metadata: room.metadata || '',
      videos: cameras.filter(({ participant }) => participant !== local).map(({ participant }) => participant.identity).join(','),
      shared: !!share?.track && !share.isMuted, sharing: session.share?.published === true,
      shareId: session.share?.shareId,
      awaitingCapture: !!session.share && !session.share.started && ownsShare,
    });
  }

  function message(session, data, participant, topic, self = false) {
    if (!active(session) || !participant || (topic !== chatTopic && topic !== danmakuTopic)) return;
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text || text.length > 120) return;
    const name = typeof data.name === 'string' ? data.name.trim().slice(0, 120) : '';
    post({ type: 'message', id: session.id, message: {
      text, name: participant.name || name, identity: participant.identity, self, topic, at: Date.now(),
    } });
  }

  function disconnect() {
    const session = current;
    current = undefined;
    render([], undefined, []);
    if (session) {
      stopShare(session);
      void session.room.disconnect().catch(() => {});
    }
  }

  async function connect(command) {
    disconnect();
    const session = { id: command.id, room: new Room({ adaptiveStream: true, dynacast: true }), operations: Promise.resolve() };
    current = session;
    const { room } = session;
    const refresh = () => update(session);
    for (const event of [
      RoomEvent.Connected, RoomEvent.ConnectionStateChanged, RoomEvent.ParticipantConnected, RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackSubscribed, RoomEvent.TrackUnsubscribed, RoomEvent.TrackMuted, RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished, RoomEvent.LocalTrackUnpublished, RoomEvent.ActiveSpeakersChanged,
      RoomEvent.RoomMetadataChanged, RoomEvent.ParticipantAttributesChanged, RoomEvent.ParticipantNameChanged,
      RoomEvent.ParticipantPermissionsChanged,
    ]) room.on(event, refresh);
    room.on(RoomEvent.DataReceived, (bytes, participant, _kind, topic) => {
      if ((topic !== chatTopic && topic !== danmakuTopic) || bytes.length > 2048) return;
      let data;
      try { data = JSON.parse(decoder.decode(bytes)); } catch { return; }
      message(session, data, participant, topic);
    });
    room.on(RoomEvent.Disconnected, refresh);
    try {
      if (!command.url.startsWith('wss://')) throw new Error('insecure endpoint');
      await room.connect(command.url, command.token);
      if (!active(session)) {
        await room.disconnect();
        return;
      }
      void room.startAudio().catch(() => {});
      refresh();
    } catch {
      if (active(session)) {
        post({ type: 'error', id: session.id, error: 'connect' });
        disconnect();
      }
    }
  }

  function stopShare(session, error = '') {
    const share = session.share;
    if (!share) return;
    session.share = undefined;
    share.track?.stop();
    if (share.published) void session.room.localParticipant.unpublishTrack(share.track).catch(() => {});
    if (active(session) && error) post({ type: 'shareError', id: session.id, shareId: share.shareId, error });
  }

  // This runs synchronously from the Web button so getDisplayMedia receives user activation.
  async function startCapture(request) {
    const session = current;
    if (!session || !request || request !== session.share || request.started ||
        session.room.state !== ConnectionState.Connected ||
        holder(session.room) !== session.room.localParticipant.identity) return;
    request.started = true;
    update(session);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      const valid = () => active(session) && session.share === request &&
        holder(session.room) === session.room.localParticipant.identity;
      if (!track || !valid()) {
        stream.getTracks().forEach((item) => item.stop());
        if (valid()) throw new Error('missing screen track');
        return;
      }
      request.track = track;
      track.addEventListener('ended', () => {
        if (session.share !== request) return;
        stopShare(session, 'stopped');
        update(session);
      }, { once: true });
      const local = session.room.localParticipant;
      await local.publishTrack(track, { source: Track.Source.ScreenShare, simulcast: false });
      if (!valid()) {
        track.stop();
        await local.unpublishTrack(track);
        return;
      }
      request.published = true;
      update(session);
    } catch (error) {
      if (session.share === request) {
        stopShare(session, error?.name === 'NotAllowedError' ? 'cancelled' : 'screen_capture_failed');
        update(session);
      }
    }
  }

  function dispatch(command) {
    if (command.type === 'connect') {
      void connect(command);
      return;
    }
    const session = current;
    if (!session || session.id !== command.id) return;
    if (command.type === 'disconnect') {
      disconnect();
      return;
    }
    if (command.type === 'prepareShare') {
      if (!session.share) {
        session.share = { id: session.id, shareId: command.shareId, label: command.text, cancel: command.name };
      }
      update(session);
      return;
    }
    if (command.type === 'stopShare' || command.type === 'cancelShare') {
      if (!session.share || command.shareId !== session.share.shareId) return;
      stopShare(session, command.type === 'cancelShare' ? 'cancelled' : '');
      update(session);
      return;
    }
    session.operations = session.operations.then(async () => {
      if (!active(session) || session.room.state !== ConnectionState.Connected) return;
      const local = session.room.localParticipant;
      switch (command.type) {
        case 'mic':
          if (command.on && !canPublish(local, Track.Source.Microphone)) throw new Error('microphone publication denied');
          await local.setMicrophoneEnabled(command.on);
          break;
        case 'camera':
          if (command.on && !canPublish(local, Track.Source.Camera)) throw new Error('camera publication denied');
          await local.setCameraEnabled(command.on, { facingMode: 'user' });
          break;
        case 'flip': {
          if (!canPublish(local, Track.Source.Camera)) throw new Error('camera publication denied');
          const track = local.getTrackPublication(Track.Source.Camera)?.videoTrack;
          if (track) {
            const facingMode = track.mediaStreamTrack.getSettings().facingMode;
            await track.restartTrack({ facingMode: facingMode === 'environment' ? 'user' : 'environment' });
          }
          break;
        }
        case 'hand': await local.setAttributes({ handRaised: command.on ? '1' : '' }); break;
        case 'message': {
          const text = command.text.trim();
          if (!text || text.length > 120) return;
          const topic = command.danmaku ? danmakuTopic : chatTopic;
          const data = { text, name: command.name.slice(0, 120) };
          await local.publishData(encoder.encode(JSON.stringify(data)), { reliable: true, topic });
          message(session, data, local, topic, true);
          break;
        }
      }
      update(session);
    }).catch(() => {
      if (active(session)) {
        post({ type: 'error', id: session.id, error: command.type });
        update(session);
      }
    });
  }

  function pictureInPictureFailed() {
    if (current) post({ type: 'error', id: current.id, error: 'pictureInPicture' });
  }

  return { dispatch, disconnect, startCapture, pictureInPictureFailed };
}

export function createMeetingPictureInPicture(page, button, onError) {
  let videos = [];
  let changing = false;

  function candidate() {
    if (!page.pictureInPictureEnabled) return undefined;
    return videos.find((video) => video?.videoWidth > 0 && !video.disablePictureInPicture &&
      typeof video.requestPictureInPicture === 'function');
  }

  function refresh() {
    const active = !!page.pictureInPictureElement;
    button.hidden = !button.textContent || (!active && !candidate());
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  async function toggle() {
    if (changing) return;
    const video = candidate();
    changing = true;
    try {
      if (page.pictureInPictureElement) await page.exitPictureInPicture();
      else if (video) {
        await video.requestPictureInPicture();
        if (!videos.includes(video) && page.pictureInPictureElement === video) {
          await page.exitPictureInPicture();
        }
      }
    } catch {
      if (videos.includes(video)) onError();
    } finally {
      changing = false;
      refresh();
    }
  }

  function update(nextVideos) {
    videos = nextVideos;
    if (page.pictureInPictureElement && !videos.includes(page.pictureInPictureElement)) {
      void page.exitPictureInPicture().catch(() => {});
    }
    refresh();
  }

  button.addEventListener('click', toggle);
  return { update, refresh };
}

function mount() {
  const stage = document.querySelector('#stage');
  const grid = document.querySelector('#cameras');
  const share = document.querySelector('#share');
  const confirm = document.querySelector('#start-capture');
  const cancel = document.querySelector('#cancel-capture');
  const actions = document.querySelector('#capture-actions');
  const pipButton = document.querySelector('#meeting-pip');
  const tracks = new Map();
  let fullscreen = false;
  let capture;

  function render(cameras, shared, audio, request) {
    capture = request;
    actions.hidden = !request;
    confirm.textContent = request?.label || '';
    cancel.textContent = request?.cancel || '';
    const visible = new Set([
      ...cameras.map(({ track }) => track), ...audio, ...(shared ? [shared.track] : []),
    ]);
    for (const [track, node] of tracks) {
      if (visible.has(track)) continue;
      track.detach(node.media);
      node.element.remove();
      tracks.delete(track);
    }
    function attach(track, container, participant) {
      if (!tracks.has(track)) {
        const media = document.createElement(participant ? 'video' : 'audio');
        media.autoplay = true;
        media.playsInline = true;
        if (participant) {
          for (const event of ['loadedmetadata', 'emptied', 'enterpictureinpicture', 'leavepictureinpicture']) {
            media.addEventListener(event, pip.refresh);
          }
        }
        if (participant && track.source === Track.Source.Camera) media.muted = true;
        const element = participant ? document.createElement('figure') : media;
        const caption = participant ? document.createElement('figcaption') : undefined;
        if (caption) element.append(media, caption);
        track.attach(media);
        container.append(element);
        tracks.set(track, { media, element, caption });
      }
      const caption = tracks.get(track).caption;
      if (caption) caption.textContent = participant.name || participant.identity;
    }
    cameras.forEach(({ participant, track }) => attach(track, grid, participant));
    if (shared) attach(shared.track, share, shared.participant);
    else fullscreen = false;
    audio.forEach((track) => attach(track, stage, undefined));
    share.hidden = !shared;
    stage.classList.toggle('shared', !!shared);
    stage.classList.toggle('fullscreen', fullscreen);
    const remoteCameras = cameras.filter(({ track }) => !track.isLocal);
    const localCameras = cameras.filter(({ track }) => track.isLocal);
    pip.update([...(shared ? [shared] : []), ...remoteCameras, ...localCameras]
      .map(({ track }) => tracks.get(track).media));
  }

  share.addEventListener('click', () => {
    fullscreen = !fullscreen;
    stage.classList.toggle('fullscreen', fullscreen);
  });
  const media = createMeetingMedia((event) => window.NuwaxMeeting?.postMessage(JSON.stringify(event)), render);
  const pip = createMeetingPictureInPicture(document, pipButton, media.pictureInPictureFailed);
  function setPictureInPictureLabel(label) {
    pipButton.textContent = label;
    pip.refresh();
  }
  confirm.addEventListener('click', () => { void media.startCapture(capture); });
  cancel.addEventListener('click', () => {
    if (capture) media.dispatch({ type: 'cancelShare', id: capture.id, shareId: capture.shareId });
  });
  window.meetingMedia = { ...media, setPictureInPictureLabel };
  window.addEventListener('pagehide', media.disconnect);
}

if (typeof document !== 'undefined') mount();
