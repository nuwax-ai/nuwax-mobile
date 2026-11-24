import { beforeEach, describe, expect, it, vi } from 'vitest';

const kits = vi.hoisted(() => ({
  bridge: { current: { callId: 'voice-call' }, traceIncoming: vi.fn(), mediaEvent: vi.fn() },
  createCapturer: vi.fn(),
  createRenderer: vi.fn(),
  startBackground: vi.fn(),
  stopBackground: vi.fn(),
}));
vi.mock('@kit.AbilityKit', () => ({ wantAgent: {
  getWantAgent: vi.fn(async () => ({})),
  OperationType: { START_ABILITY: 0 },
  WantAgentFlags: { UPDATE_PRESENT_FLAG: 0 },
} }));
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
vi.mock('libnuwax_harmony_rtc.so', () => ({ default: { start: () => 1, stop: vi.fn(), mute: vi.fn(), status: () => 0 } }));

import { HarmonyNativeVoice } from '../../scripts/voip-native/harmony-voice-qa/HarmonyNativeVoice.ets';

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
