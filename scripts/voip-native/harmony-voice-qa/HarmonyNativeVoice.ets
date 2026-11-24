import { common, wantAgent } from '@kit.AbilityKit'
import { audio } from '@kit.AudioKit'
import { backgroundTaskManager } from '@kit.BackgroundTasksKit'
import { BusinessError } from '@kit.BasicServicesKit'
import { VoipBridge } from '@uni_modules/nuwax-voip'
import rtc from 'libnuwax_harmony_rtc.so'

class VoiceSession {
  capturer: audio.AudioCapturer | null = null
  renderer: audio.AudioRenderer | null = null
  pollTimer = -1
  lastStats = 0
  peerAbsentSince = 0
  audioStartup: Promise<void> | null = null
  captureStartup: Promise<void> | null = null
  playbackStartup: Promise<void> | null = null
  taskStartup: Promise<void> | null = null
  playedBytes = 0
  capturedBytes = 0
  connected = false
  peerReady = false
  backgroundTask = false
  releaseFailed = false
  readonly context: common.UIAbilityContext
  readonly callId: string
  readonly handle: number
  constructor(context: common.UIAbilityContext, callId: string, handle: number) {
    this.context = context
    this.callId = callId
    this.handle = handle
  }
}

export class HarmonyNativeVoice {
  static current: VoiceSession | null = null
  static cleanup: Promise<void> | null = null

  static async start(context: common.UIAbilityContext, callId: string, endpoint: string,
    token: string, microphone: boolean): Promise<void> {
    if (HarmonyNativeVoice.cleanup) await HarmonyNativeVoice.cleanup
    if (VoipBridge.current?.callId !== callId) return
    if (HarmonyNativeVoice.current) throw new Error('CALL_NATIVE_AUDIO_BUSY')
    const handle = rtc.start(endpoint, token)
    if (!handle) throw new Error('CALL_NATIVE_AUDIO_START_FAILED')
    const session = new VoiceSession(context, callId, handle)
    HarmonyNativeVoice.current = session
    rtc.mute(handle, !microphone)
    VoipBridge.traceIncoming('nativeVoiceStart', callId)
    try {
      const audioStartup = HarmonyNativeVoice.startAudio(session)
      session.audioStartup = audioStartup
      await audioStartup
    } catch (error) {
      if (HarmonyNativeVoice.current !== session) return
      VoipBridge.traceIncoming(`nativeVoiceAudioFailed code=${(error as BusinessError).code}`, callId)
      HarmonyNativeVoice.stop()
      throw new Error('CALL_NATIVE_AUDIO_FAILED')
    }
  }

  static async startAudio(session: VoiceSession): Promise<void> {
    const callId = session.callId, handle = session.handle
    const stream: audio.AudioStreamInfo = {
      samplingRate: audio.AudioSamplingRate.SAMPLE_RATE_48000,
      channels: audio.AudioChannel.CHANNEL_1,
      sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
      encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW
    }
    const capturer = await audio.createAudioCapturer({
      streamInfo: stream,
      capturerInfo: { source: audio.SourceType.SOURCE_TYPE_VOICE_COMMUNICATION, capturerFlags: 0 }
    })
    if (HarmonyNativeVoice.current !== session) {
      await HarmonyNativeVoice.releaseResource(session, 'capturer', () => capturer.release())
      return
    }
    session.capturer = capturer
    capturer.on('readData', (data: ArrayBuffer) => {
      if (HarmonyNativeVoice.current !== session) return
      session.capturedBytes += data.byteLength
      rtc.writePcm(handle, data)
    })
    const captureStartup = capturer.start()
    session.captureStartup = captureStartup
    await captureStartup
    if (HarmonyNativeVoice.current !== session) return
    const renderer = await audio.createAudioRenderer({
      streamInfo: stream,
      rendererInfo: { usage: audio.StreamUsage.STREAM_USAGE_VOICE_COMMUNICATION, rendererFlags: 0 }
    })
    if (HarmonyNativeVoice.current !== session) {
      await HarmonyNativeVoice.releaseResource(session, 'renderer', () => renderer.release())
      return
    }
    session.renderer = renderer
    renderer.on('writeData', (data: ArrayBuffer) => {
      if (HarmonyNativeVoice.current !== session) return audio.AudioDataCallbackResult.INVALID
      session.playedBytes += rtc.readPcm(handle, data)
      return audio.AudioDataCallbackResult.VALID
    })
    const playbackStartup = renderer.start()
    session.playbackStartup = playbackStartup
    await playbackStartup
    if (HarmonyNativeVoice.current !== session) return
    VoipBridge.traceIncoming('nativeVoiceAudioRunning', callId)
    session.pollTimer = setInterval(() => HarmonyNativeVoice.poll(session), 120)
    session.taskStartup = HarmonyNativeVoice.startTask(session)
  }

  static async startTask(session: VoiceSession): Promise<void> {
    const context = session.context
    try {
      const target = await wantAgent.getWantAgent({
        wants: [{ bundleName: context.abilityInfo.bundleName, moduleName: context.abilityInfo.moduleName,
          abilityName: 'EntryAbility' }],
        actionType: wantAgent.OperationType.START_ABILITY, requestCode: 9091,
        actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
      })
      if (HarmonyNativeVoice.current !== session) return
      await backgroundTaskManager.startBackgroundRunning(context, backgroundTaskManager.BackgroundMode.VOIP, target)
      session.backgroundTask = true
      if (HarmonyNativeVoice.current === session) {
        VoipBridge.traceIncoming('nativeVoiceBackgroundRunning', session.callId)
      }
    } catch (error) {
      if (HarmonyNativeVoice.current === session) {
        VoipBridge.traceIncoming(`nativeVoiceBackgroundFailed code=${(error as BusinessError).code}`, session.callId)
      }
    }
  }

  static event(session: VoiceSession, type: string): void {
    VoipBridge.mediaEvent(JSON.stringify({ type, callId: session.callId }))
  }

  static poll(session: VoiceSession): void {
    if (HarmonyNativeVoice.current !== session) return
    const phase = rtc.status(session.handle, 0)
    if (phase < 0) {
      VoipBridge.traceIncoming(`nativeVoiceRoomFailed phase=${phase}`, session.callId)
      HarmonyNativeVoice.event(session, 'disconnected')
      return
    }
    if (phase === 1 && !session.connected) {
      session.connected = true
      VoipBridge.traceIncoming('nativeVoiceRoomJoined', session.callId)
      HarmonyNativeVoice.event(session, 'connected')
    }
    if (session.connected && !session.peerReady && session.playedBytes > 0 && rtc.status(session.handle, 2) > 0) {
      session.peerReady = true
      HarmonyNativeVoice.event(session, 'peerMediaReady')
    }
    if (session.connected && rtc.status(session.handle, 6) === 1) {
      if (!session.peerAbsentSince) session.peerAbsentSince = Date.now()
      if (Date.now() - session.peerAbsentSince >= 3000) {
        VoipBridge.traceIncoming('nativeVoicePeerLeft', session.callId)
        HarmonyNativeVoice.event(session, 'remoteEnded')
        return
      }
    } else {
      session.peerAbsentSince = 0
    }
    if (Date.now() - session.lastStats >= 5000) {
      session.lastStats = Date.now()
      VoipBridge.traceIncoming(`nativeVoiceStats captured=${session.capturedBytes} played=${session.playedBytes} txFrames=${rtc.status(session.handle, 2)} rxFrames=${rtc.status(session.handle, 3)} txSignal=${rtc.status(session.handle, 4)} rxSignal=${rtc.status(session.handle, 5)}`, session.callId)
    }
  }

  static mute(muted: boolean): void {
    const session = HarmonyNativeVoice.current
    if (session) rtc.mute(session.handle, muted)
  }

  static stop(): void {
    const session = HarmonyNativeVoice.current
    if (!session) return
    HarmonyNativeVoice.current = null
    if (session.pollTimer >= 0) clearInterval(session.pollTimer)
    rtc.stop(session.handle)
    const cleanup = HarmonyNativeVoice.release(session)
    HarmonyNativeVoice.cleanup = cleanup
    cleanup.finally(() => {
      if (HarmonyNativeVoice.cleanup === cleanup) HarmonyNativeVoice.cleanup = null
    })
  }

  static async release(session: VoiceSession): Promise<void> {
    const capturer = session.capturer, renderer = session.renderer
    const releases: Promise<void>[] = []
    // Close resources already acquired while any pending creation disposes of its own late result.
    if (capturer) {
      releases.push(HarmonyNativeVoice.releaseResource(session, 'capturer', async () => {
        await session.captureStartup?.catch(() => {})
        await capturer.stop().catch(() => {})
        await capturer.release()
      }))
    }
    if (renderer) {
      releases.push(HarmonyNativeVoice.releaseResource(session, 'renderer', async () => {
        await session.playbackStartup?.catch(() => {})
        await renderer.stop().catch(() => {})
        await renderer.release()
      }))
    }
    if (session.audioStartup) releases.push(session.audioStartup.catch(() => {}))
    releases.push(HarmonyNativeVoice.releaseTask(session))
    await Promise.all(releases)
    const result = session.releaseFailed ? 'nativeVoiceReleaseFailed' : 'nativeVoiceReleased'
    VoipBridge.traceIncoming(result, session.callId)
  }

  static async releaseTask(session: VoiceSession): Promise<void> {
    await session.taskStartup
    if (!session.backgroundTask) return
    await HarmonyNativeVoice.releaseResource(session, 'backgroundTask', () => {
      return backgroundTaskManager.stopBackgroundRunning(session.context)
    })
  }

  static async releaseResource(session: VoiceSession, resource: string,
    dispose: () => Promise<void>): Promise<void> {
    try {
      await dispose()
      VoipBridge.traceIncoming(`nativeVoiceResourceReleased resource=${resource}`, session.callId)
    } catch (error) {
      session.releaseFailed = true
      VoipBridge.traceIncoming(`nativeVoiceResourceReleaseFailed resource=${resource} code=${(error as BusinessError).code}`, session.callId)
    }
  }
}
