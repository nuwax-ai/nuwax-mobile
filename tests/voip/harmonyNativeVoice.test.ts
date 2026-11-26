import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const kits = vi.hoisted(() => ({
  bridge: { current: { callId: 'voice-call' }, traceIncoming: vi.fn(), mediaEvent: vi.fn() },
  createCapturer: vi.fn(),
  createRenderer: vi.fn(),
  startBackground: vi.fn(),
  stopBackground: vi.fn(),
  makeWantAgent: vi.fn(async (_info: unknown) => ({})),
  makeId: vi.fn(),
}));
vi.mock('@kit.AbilityKit', () => ({ wantAgent: {
  getWantAgent: kits.makeWantAgent,
  OperationType: { START_ABILITY: 0 },
  WantAgentFlags: { UPDATE_PRESENT_FLAG: 0 },
} }));
vi.mock('@kit.ArkTS', () => ({ util: { generateRandomUUID: kits.makeId } }));
vi.mock('@kit.AudioKit', () => ({ audio: {
  createAudioCapturer: kits.createCapturer,
  createAudioRenderer: kits.createRenderer,
  AudioSamplingRate: { SAMPLE_RATE_48000: 48000 },
  AudioChannel: { CHANNEL_1: 1 },
  AudioSampleFormat: { SAMPLE_FORMAT_S16LE: 1 },
  AudioEncodingType: { ENCODING_TYPE_RAW: 0 },
  SourceType: { SOURCE_TYPE_VOICE_COMMUNICATION: 1 },
  StreamUsage: { STREAM_USAGE_VOICE_COMMUNICATION: 1 },
} }));
vi.mock('@kit.BackgroundTasksKit', () => ({ backgroundTaskManager: {
  BackgroundMode: { VOIP: 1 },
  startBackgroundRunning: kits.startBackground,
  stopBackgroundRunning: kits.stopBackground,
} }));
vi.mock('@uni_modules/nuwax-voip', () => ({ VoipBridge: kits.bridge }));
vi.mock('@uni_modules/nuwax-livekit', () =>
  import('../../uni_modules/nuwax-livekit/utssdk/app-harmony/EntryVoipBackgroundTask.ets'));
vi.mock('libnuwax_harmony_rtc.so', () => ({ default: { start: () => 1, stop: vi.fn(), mute: vi.fn(), status: () => 0 } }));

import { HarmonyNativeVoice } from '../../scripts/voip-native/harmony-voice-qa/HarmonyNativeVoice.ets';
import { EntryVoipBackgroundTask } from '../../uni_modules/nuwax-livekit/utssdk/app-harmony/EntryVoipBackgroundTask.ets';

it('does not hold a late proximity lock after leaving the call screen', async () => {
  const raw = readFileSync(new URL('../../scripts/voip-native/harmony/NuwaxVoipMedia.ets', import.meta.url), 'utf8');
  const source = raw.slice(raw.indexOf('class CallProximityLock'), raw.indexOf('class MediaProxy'));
  let grant!: (value: object) => void;
  const create = vi.fn(() => new Promise<object>(resolve => { grant = resolve; }));
  const Lock = vm.runInNewContext(stripTypeScriptTypes(source) + '\nCallProximityLock;', {
    runningLock: { RunningLockType: { PROXIMITY_SCREEN_CONTROL: 2 }, isSupported: () => true, create },
  });
  const proximity = new Lock();
  const hold = vi.fn();
  const unhold = vi.fn();
  const isHolding = vi.fn(() => false);
  proximity.update(true);
  proximity.update(true);
  expect(create).toHaveBeenCalledOnce();
  proximity.update(false);
  grant({ hold, unhold, isHolding });
  await new Promise(resolve => setImmediate(resolve));
  expect(hold).not.toHaveBeenCalled();

  proximity.update(true);
  expect(hold).toHaveBeenCalledExactlyOnceWith(-1);
  isHolding.mockReturnValue(true);
  proximity.update(false);
  expect(unhold).toHaveBeenCalledOnce();
});

function audioResource() {
  return { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), release: vi.fn(async () => {}), on: vi.fn() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

const context = { abilityInfo: { bundleName: 'com.nuwax.fixture', moduleName: 'entry' } } as Parameters<typeof HarmonyNativeVoice.start>[0];
const startCall = () => HarmonyNativeVoice.start(context, 'voice-call', 'wss://rtc.example.test', 'fixture', true);
const capturer = audioResource(), renderer = audioResource();

beforeEach(() => {
  vi.clearAllMocks();
  kits.makeId.mockReset().mockReturnValue('491a4fb1-fdde-4d52-bb37-767044110e00');
  kits.createCapturer.mockReset().mockResolvedValue(capturer);
  kits.createRenderer.mockReset().mockResolvedValue(renderer);
  kits.startBackground.mockReset().mockResolvedValue(undefined);
  kits.stopBackground.mockReset().mockResolvedValue(undefined);
});

describe('Harmony native voice hangup', () => {
  it('releases the microphone while renderer creation is pending and releases its late result', async () => {
    const creatingRenderer = deferred<typeof renderer>();
    kits.createRenderer.mockReturnValueOnce(creatingRenderer.promise);
    const opening = startCall();
    try {
      await vi.waitFor(() => expect(kits.createRenderer).toHaveBeenCalledOnce());
      HarmonyNativeVoice.stop();
      await vi.waitFor(() => expect(capturer.release).toHaveBeenCalledOnce());
      expect(kits.bridge.traceIncoming).toHaveBeenCalledWith('nativeVoiceResourceReleased resource=capturer', 'voice-call');
      expect(kits.bridge.traceIncoming).not.toHaveBeenCalledWith('nativeVoiceReleased', 'voice-call');
    } finally {
      const cleanup = HarmonyNativeVoice.cleanup;
      creatingRenderer.resolve(renderer);
      await Promise.all([opening, cleanup]);
      HarmonyNativeVoice.stop();
      await HarmonyNativeVoice.cleanup;
    }
    expect(renderer.start).not.toHaveBeenCalled();
    expect(renderer.release).toHaveBeenCalledOnce();
    expect(kits.startBackground).not.toHaveBeenCalled();
    expect(kits.bridge.traceIncoming).toHaveBeenCalledWith('nativeVoiceReleased', 'voice-call');
  });

  it('confirms each audio resource before it can confirm a pending background task stop', async () => {
    const startingTask = deferred<void>();
    kits.startBackground.mockReturnValueOnce(startingTask.promise);
    await startCall();
    try {
      await vi.waitFor(() => expect(kits.startBackground).toHaveBeenCalledOnce());
      HarmonyNativeVoice.stop();
      await vi.waitFor(() => {
        expect(capturer.release).toHaveBeenCalledOnce();
        expect(renderer.release).toHaveBeenCalledOnce();
      });
      expect(kits.stopBackground).not.toHaveBeenCalled();
      expect(kits.bridge.traceIncoming).not.toHaveBeenCalledWith('nativeVoiceReleased', 'voice-call');
    } finally {
      startingTask.resolve();
      HarmonyNativeVoice.stop();
      await HarmonyNativeVoice.cleanup;
    }
    expect(kits.stopBackground).toHaveBeenCalledExactlyOnceWith(context);
    expect(kits.bridge.traceIncoming).toHaveBeenCalledWith('nativeVoiceResourceReleased resource=backgroundTask', 'voice-call');
    expect(kits.bridge.traceIncoming).toHaveBeenCalledWith('nativeVoiceReleased', 'voice-call');
  });

  it('reports the failed resource instead of confirming the whole call released', async () => {
    kits.stopBackground.mockRejectedValueOnce({ code: 801 });
    await startCall();
    HarmonyNativeVoice.stop();
    await HarmonyNativeVoice.cleanup;
    expect(kits.bridge.traceIncoming).toHaveBeenCalledWith('nativeVoiceResourceReleaseFailed resource=backgroundTask code=801', 'voice-call');
    expect(kits.bridge.traceIncoming).toHaveBeenCalledWith('nativeVoiceReleaseFailed', 'voice-call');
    expect(kits.bridge.traceIncoming).not.toHaveBeenCalledWith('nativeVoiceReleased', 'voice-call');
  });
});


describe('Harmony EntryAbility VOIP task ownership', () => {
  it('keeps the task while a meeting remains after native voice hangs up', async () => {
    await EntryVoipBackgroundTask.acquire('meeting:42', context, () => true);
    try {
      await startCall();
      await HarmonyNativeVoice.current?.taskStartup;
      expect(kits.startBackground).toHaveBeenCalledOnce();
      HarmonyNativeVoice.stop();
      await HarmonyNativeVoice.cleanup;
      expect(kits.stopBackground).not.toHaveBeenCalled();
      expect(kits.bridge.traceIncoming).toHaveBeenCalledWith('nativeVoiceReleased', 'voice-call');
    } finally {
      HarmonyNativeVoice.stop();
      await HarmonyNativeVoice.cleanup;
      await EntryVoipBackgroundTask.release('meeting:42');
    }
    expect(kits.stopBackground).toHaveBeenCalledExactlyOnceWith(context);
  });

  it('keeps native voice alive when the meeting leaves first', async () => {
    await startCall();
    try {
      await HarmonyNativeVoice.current?.taskStartup;
      await EntryVoipBackgroundTask.acquire('meeting:42', context, () => true);
      await EntryVoipBackgroundTask.release('meeting:42');
      expect(kits.startBackground).toHaveBeenCalledOnce();
      expect(kits.stopBackground).not.toHaveBeenCalled();
    } finally {
      HarmonyNativeVoice.stop();
      await HarmonyNativeVoice.cleanup;
    }
    expect(kits.stopBackground).toHaveBeenCalledExactlyOnceWith(context);
  });

  it('does not stop a task it could not acquire or one outside the registry', async () => {
    kits.startBackground.mockRejectedValueOnce({ code: 9800005 });
    await expect(EntryVoipBackgroundTask.acquire('meeting:42', context, () => true)).rejects.toEqual({ code: 9800005 });
    await EntryVoipBackgroundTask.release('meeting:42');
    expect(kits.stopBackground).not.toHaveBeenCalled();
    expect(await EntryVoipBackgroundTask.acquire('meeting:43', context, () => false)).toBe(false);
    expect(kits.startBackground).toHaveBeenCalledOnce();
  });
});


it('recognizes only the current background task notification and invalidates it after release', async () => {
  await EntryVoipBackgroundTask.acquire('meeting:42', context, () => true);
  const first = kits.makeWantAgent.mock.lastCall?.[0] as { requestCode: number; wants: { parameters: object }[] };
  const want = first.wants[0];
  expect(EntryVoipBackgroundTask.acceptsNotification(want)).toBe(true);
  expect(EntryVoipBackgroundTask.acceptsNotification({ parameters: {} })).toBe(false);
  await EntryVoipBackgroundTask.release('meeting:42');
  expect(EntryVoipBackgroundTask.acceptsNotification(want)).toBe(false);

  kits.makeId.mockReturnValueOnce('36e2c832-9601-43a9-9105-a2ac966dfd43');
  await EntryVoipBackgroundTask.acquire('meeting:43', context, () => true);
  try {
    const second = kits.makeWantAgent.mock.lastCall?.[0] as typeof first;
    expect(second.requestCode).not.toBe(first.requestCode);
    expect(EntryVoipBackgroundTask.acceptsNotification(want)).toBe(false);
    expect(EntryVoipBackgroundTask.acceptsNotification(second.wants[0])).toBe(true);
  } finally {
    await EntryVoipBackgroundTask.release('meeting:43');
  }
});
