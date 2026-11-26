import { ConnectionState, LogLevel, Room, RoomEvent, Track, setLogLevel } from 'livekit-client';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const chatTopic = 'meeting-chat';
const danmakuTopic = 'danmaku';
const maxChatPacketBytes = 15 * 1024;
setLogLevel(LogLevel.silent);

export function createMeetingMedia(post, render) {
  let current;
  let leaving = Promise.resolve(true);
  let closedThrough = -1;
  let pendingDisplayConsent;
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
    const canPublishScreen = canPublish(local, Track.Source.ScreenShare);
    const connected = room.state === ConnectionState.Connected;
    if (session.share && ownsShare) session.share.owned = true;
    if (session.share?.owned && !ownsShare) stopShare(session, 'stopped');
    if (session.share?.started && connected && !canPublishScreen) stopShare(session, 'screen_capture_permission');
    if (room.state === ConnectionState.Disconnected) stopShare(session);
    const canCapture = !!session.share && connected && ownsShare && canPublishScreen;
    const awaitingCapture = canCapture && !pendingDisplayConsent && !session.share.started;
    const captureAllowed = canCapture && pendingDisplayConsent === session.share && !session.share.track;
    const shared = remotes.find((participant) => participant.identity === shareHolder);
    const share = shared?.getTrackPublication(Track.Source.ScreenShare);
    const audioPublications = remotes.flatMap((participant) => [...participant.audioTrackPublications.values()]);
    render(
      cameras,
      share?.track && !share.isMuted ? { participant: shared, track: share.track } : undefined,
      audioPublications.flatMap((publication) => publication.track ? [publication.track] : []),
      awaitingCapture ? session.share : undefined,
    );
    post({
      type: 'state', id: session.id, connection: room.state,
      people: room.state === ConnectionState.Disconnected ? 0 : 1 + remotes.length,
      mic: local.isMicrophoneEnabled, camera: local.isCameraEnabled, level: local.audioLevel,
      remoteAudio: audioPublications.some((publication) => publication.track && !publication.isMuted),
      micAllowed: canPublish(local, Track.Source.Microphone),
      cameraAllowed: canPublish(local, Track.Source.Camera),
      raised: local.attributes.handRaised === '1', metadata: room.metadata || '',
      remoteSpeaker: room.activeSpeakers.find(participant => participant !== local)?.identity || '',
      videos: cameras.filter(({ participant }) => participant !== local).map(({ participant }) => participant.identity).join(','),
      shared: !!share?.track && !share.isMuted, sharing: session.share?.published === true,
      shareId: session.share?.shareId,
      captureAllowed, awaitingCapture,
    });
  }

  function message(session, data, participant, topic, self = false) {
    if (!active(session) || !participant || (topic !== chatTopic && topic !== danmakuTopic)) return;
    const text = typeof data?.text === 'string' ? data.text.trim() : '';
    if (!text) return;
    const name = typeof data.name === 'string' ? data.name.trim().slice(0, 120) : '';
    post({ type: 'message', id: session.id, message: {
      text, name: participant.name || name, identity: participant.identity, self, topic, at: Date.now(),
    } });
  }

  function disconnect() {
    const session = current;
    current = undefined;
    render([], undefined, []);
    if (!session) return leaving;
    stopShare(session);
    leaving = session.room.disconnect().then(() => true, () => false);
    return leaving;
  }

  async function connect(command) {
    void disconnect();
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
      if ((topic !== chatTopic && topic !== danmakuTopic) || bytes.length > maxChatPacketBytes) return;
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
        void disconnect();
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
    if (!session || !request || request !== session.share || request.started || pendingDisplayConsent ||
        session.room.state !== ConnectionState.Connected ||
        holder(session.room) !== session.room.localParticipant.identity ||
        !canPublish(session.room.localParticipant, Track.Source.ScreenShare)) return;
    request.started = true;
    // ArkWeb grants by page origin, so only one request in this WebView can wait for consent.
    pendingDisplayConsent = request;
    try {
      update(session);
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
      const track = stream.getVideoTracks()[0];
      const local = session.room.localParticipant;
      const stillOwnsRequest = () => active(session) && session.share === request &&
        holder(session.room) === local.identity;
      if (!track || !stillOwnsRequest() || session.room.state !== ConnectionState.Connected ||
          !canPublish(local, Track.Source.ScreenShare)) {
        stream.getTracks().forEach((item) => item.stop());
        if (stillOwnsRequest()) {
          stopShare(session, track ? 'screen_capture_permission' : 'screen_capture_failed');
        }
        return;
      }
      request.track = track;
      track.addEventListener('ended', () => {
        if (session.share !== request) return;
        stopShare(session, 'stopped');
        update(session);
      }, { once: true });
      await local.publishTrack(track, { source: Track.Source.ScreenShare, simulcast: false });
      if (!stillOwnsRequest() || !canPublish(local, Track.Source.ScreenShare)) {
        if (stillOwnsRequest()) {
          stopShare(session, 'screen_capture_permission');
        } else {
          track.stop();
        }
        await local.unpublishTrack(track);
        return;
      }
      request.published = true;
    } catch (error) {
      if (session.share === request) {
        const captureError = request.track ? 'screen_share_publish' :
          error?.name === 'NotAllowedError' ? 'cancelled' : 'screen_capture_failed';
        stopShare(session, captureError);
      }
    } finally {
      pendingDisplayConsent = undefined;
      if (current) update(current);
    }
  }

  function dispatch(command) {
    if (command.type === 'connect') {
      if (command.id > closedThrough) void connect(command);
      return;
    }
    const session = current;
    if (command.type === 'disconnect') {
      if (session && session.id !== command.id) return;
      closedThrough = Math.max(closedThrough, command.id);
      void disconnect().then((left) => {
        post({ type: 'leaveComplete', id: command.id, left });
      });
      return;
    }
    if (!session || session.id !== command.id) return;
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
      if (!active(session)) return;
      const state = session.room.state;
      const reconnecting = state === ConnectionState.Reconnecting || state === ConnectionState.SignalReconnecting;
      const closingDevice = command.on === false && (command.type === 'mic' || command.type === 'camera');
      // Allow participants to mute their existing tracks while the room is reconnecting.
      if (state !== ConnectionState.Connected && !(reconnecting && closingDevice)) return;
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
          if (!text) return;
          const topic = command.danmaku ? danmakuTopic : chatTopic;
          const data = { text, name: command.name.slice(0, 120) };
          const packet = encoder.encode(JSON.stringify(data));
          if (packet.length > maxChatPacketBytes) throw new Error('meeting chat packet too large');
          await local.publishData(packet, { reliable: true, topic });
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

  function stageTap(identity, thumbnail) {
    if (current) post({ type: 'stageTap', id: current.id, identity, thumbnail });
  }

  return { dispatch, disconnect, startCapture, pictureInPictureFailed, stageTap };
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

export function meetingStageLayout(presentation, cameras, shared, fullscreen) {
  const mode = presentation.mode || 'grid';
  const members = new Map((presentation.members || []).map(member => [member.identity, member.name]));
  for (const { participant } of cameras) {
    if (!members.has(participant.identity)) members.set(participant.identity, participant.name || participant.identity);
  }
  if (shared && !members.has(shared.participant.identity)) {
    members.set(shared.participant.identity, shared.participant.name || shared.participant.identity);
  }
  const main = members.has(presentation.main) ? presentation.main :
    shared?.participant.identity || members.keys().next().value;
  const gridMode = mode === 'grid' && !presentation.focused;
  const sharedVisible = !!shared && (fullscreen || gridMode || (!presentation.focused && shared.participant.identity === main));
  const primaryShare = sharedVisible && !gridMode;
  const tiles = gridMode ? (presentation.grid?.length ? presentation.grid : [...members.keys()]) : [main];
  const visible = fullscreen || primaryShare ? [] : tiles.filter(identity => members.has(identity));
  const thumbs = !fullscreen && (mode === 'topThumbs' || mode === 'sideThumbs');
  return { mode, members, main, visible, thumbs, sharedVisible };
}

function mount() {
  const stage = document.querySelector('#stage');
  const grid = document.querySelector('#cameras');
  const share = document.querySelector('#share');
  const thumbs = document.querySelector('#thumbs');
  const confirm = document.querySelector('#start-capture');
  const cancel = document.querySelector('#cancel-capture');
  const actions = document.querySelector('#capture-actions');
  const pipButton = document.querySelector('#meeting-pip');
  const tracks = new Map();
  const placeholders = new Map();
  let fullscreen = false;
  let capture;
  let presentation = {};
  let cameras = [];
  let shared;
  let thumbSnapshot = '';

  function render(nextCameras, nextShared, audio, request) {
    cameras = nextCameras;
    shared = nextShared;
    if (!shared) fullscreen = false;
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
        if (caption) {
          element.append(media, caption);
          if (container === grid) element.addEventListener('click', () => mediaRoom.stageTap(participant.identity, false));
        }
        track.attach(media);
        container.append(element);
        tracks.set(track, { media, element, caption });
      }
      const caption = tracks.get(track).caption;
      if (caption) caption.textContent = participant.name || participant.identity;
    }
    cameras.forEach(({ participant, track }) => attach(track, grid, participant));
    if (shared) attach(shared.track, share, shared.participant);
    audio.forEach((track) => attach(track, stage, undefined));
    renderLayout();
  }

  function renderLayout() {
    const layout = meetingStageLayout(presentation, cameras, shared, fullscreen);
    const activeKeys = layout.visible;
    const cameraKeys = new Set();
    for (const { participant, track } of cameras) {
      const node = tracks.get(track);
      const order = activeKeys.indexOf(participant.identity);
      cameraKeys.add(participant.identity);
      node.element.hidden = order < 0;
      node.element.style.order = order;
    }
    for (const [identity, card] of placeholders) {
      if (!activeKeys.includes(identity) || cameraKeys.has(identity)) {
        card.remove();
        placeholders.delete(identity);
      }
    }
    for (const [order, identity] of activeKeys.entries()) {
      if (cameraKeys.has(identity)) continue;
      const name = layout.members.get(identity) || identity;
      let card = placeholders.get(identity);
      if (!card) {
        card = document.createElement('figure');
        card.className = 'placeholder';
        card.append(document.createElement('span'), document.createElement('figcaption'));
        card.addEventListener('click', () => mediaRoom.stageTap(identity, false));
        grid.append(card);
        placeholders.set(identity, card);
      }
      card.firstElementChild.textContent = [...name][0] || '?';
      card.lastElementChild.textContent = name;
      card.style.order = order;
    }
    const nextThumbSnapshot = layout.thumbs ? JSON.stringify([layout.main, [...layout.members]]) : '';
    if (nextThumbSnapshot !== thumbSnapshot) {
      thumbSnapshot = nextThumbSnapshot;
      thumbs.replaceChildren();
      if (layout.thumbs) {
        for (const [identity, name] of layout.members) {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = [...(name || identity)][0] || '?';
          button.setAttribute('aria-label', name || identity);
          button.setAttribute('aria-pressed', identity === layout.main ? 'true' : 'false');
          button.addEventListener('click', () => mediaRoom.stageTap(identity, true));
          thumbs.append(button);
        }
      }
    }
    thumbs.hidden = !layout.thumbs;
    grid.hidden = activeKeys.length === 0;
    const columns = activeKeys.length <= 1 ? 1 : Math.min(3, presentation.columns || 2);
    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    stage.dataset.layout = layout.mode;
    share.hidden = !layout.sharedVisible;
    stage.classList.toggle('shared', layout.sharedVisible);
    stage.classList.toggle('fullscreen', fullscreen);
    const visibleCameras = cameras.filter(({ participant }) => activeKeys.includes(participant.identity));
    const remoteCameras = visibleCameras.filter(({ track }) => !track.isLocal);
    const localCameras = visibleCameras.filter(({ track }) => track.isLocal);
    pip.update([...(layout.sharedVisible ? [shared] : []), ...remoteCameras, ...localCameras]
      .map(({ track }) => tracks.get(track).media));
  }

  share.addEventListener('click', () => {
    fullscreen = !fullscreen;
    renderLayout();
  });
  const mediaRoom = createMeetingMedia((event) => window.NuwaxMeeting?.postMessage(JSON.stringify(event)), render);
  const pip = createMeetingPictureInPicture(document, pipButton, mediaRoom.pictureInPictureFailed);
  function setPictureInPictureLabel(label) {
    pipButton.textContent = label;
    pip.refresh();
  }
  function setStagePresentation(raw) {
    presentation = JSON.parse(raw);
    renderLayout();
  }
  confirm.addEventListener('click', () => { void mediaRoom.startCapture(capture); });
  cancel.addEventListener('click', () => {
    if (capture) mediaRoom.dispatch({ type: 'cancelShare', id: capture.id, shareId: capture.shareId });
  });
  window.meetingMedia = { ...mediaRoom, setPictureInPictureLabel, setStagePresentation };
  window.addEventListener('pagehide', mediaRoom.disconnect);
}

if (typeof document !== 'undefined') mount();
