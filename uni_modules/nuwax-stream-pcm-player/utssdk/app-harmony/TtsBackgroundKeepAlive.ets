/**
 * 语音播报退后台续播（仅播报期间）。
 *
 * HarmonyOS 对 STREAM_USAGE_MUSIC 的要求：退后台继续出声必须同时
 * 1) entry Ability 声明 backgroundModes: audioPlayback
 * 2) 接入 AVSession（audio）并处于播放态
 * 3) 申请 AUDIO_PLAYBACK 长时任务
 * 缺一则退后台会被静音并冻结。播完或用户手动停止时 releasePlayer → end()，
 * 停长时任务并销毁会话，前台手动关闭播报的路径不变。
 *
 * 一个 UIAbility 同时只能有一个长时任务、一个 AVSession。begin 幂等；
 * 失败只打日志，不打断前台播放。
 *
 * 状态放在模块变量上：ArkTS 把 static 方法收成独立函数，方法体内不能用 this。
 */

import { avSession } from '@kit.AVSessionKit'
import { backgroundTaskManager } from '@kit.BackgroundTasksKit'
import { common, wantAgent, Want } from '@kit.AbilityKit'
import { BusinessError } from '@kit.BasicServicesKit'

let boundContext: common.UIAbilityContext | null = null
let aliveSession: avSession.AVSession | null = null
let taskContext: common.UIAbilityContext | null = null
let active: boolean = false
let taskStarted: boolean = false
/** 代次：end() 自增，进行中的 begin 在每次 await 后发现过期就回滚 */
let token: number = 0

/** 过期或失败时拆掉本次申请，避免占住 Ability 唯一的长时任务 / AVSession */
function rollbackSession(
  session: avSession.AVSession,
  context: common.UIAbilityContext,
  stopTask: boolean,
): void {
  if (aliveSession == session) {
    aliveSession = null
  }
  session.destroy().catch((e: BusinessError) => {
    console.warn('[TtsBackgroundKeepAlive] rollback destroy failed ' + e.code)
  })
  if (stopTask) {
    taskStarted = false
    taskContext = null
    backgroundTaskManager.stopBackgroundRunning(context).catch((e: BusinessError) => {
      console.warn('[TtsBackgroundKeepAlive] rollback stop failed ' + e.code)
    })
  }
}

async function startBackgroundAudio(context: common.UIAbilityContext, runToken: number): Promise<void> {
  let session: avSession.AVSession | null = null
  try {
    session = await avSession.createAVSession(context, 'nuwax-tts', 'audio')
    if (runToken != token) {
      session.destroy().catch((err: BusinessError) => {
        console.warn('[TtsBackgroundKeepAlive] stale destroy failed ' + err.code)
      })
      return
    }
    aliveSession = session
    const metadata: avSession.AVMetadata = {
      assetId: 'nuwax-tts',
      title: '语音播报',
    }
    await session.setAVMetadata(metadata)
    const playing: avSession.AVPlaybackState = {
      state: avSession.PlaybackState.PLAYBACK_STATE_PLAY,
    }
    await session.setAVPlaybackState(playing)
    await session.activate()
    if (runToken != token) {
      rollbackSession(session, context, false)
      return
    }
    const want: Want = {
      bundleName: context.abilityInfo.bundleName,
      abilityName: context.abilityInfo.name,
    }
    const wants: Array<Want> = [want]
    const flags: Array<wantAgent.WantAgentFlags> = [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG]
    const info: wantAgent.WantAgentInfo = {
      wants: wants,
      actionType: wantAgent.OperationType.START_ABILITY,
      requestCode: 0,
      actionFlags: flags,
    }
    const agent = await wantAgent.getWantAgent(info)
    if (runToken != token) {
      rollbackSession(session, context, false)
      return
    }
    await backgroundTaskManager.startBackgroundRunning(
      context,
      backgroundTaskManager.BackgroundMode.AUDIO_PLAYBACK,
      agent,
    )
    if (runToken != token) {
      rollbackSession(session, context, true)
      return
    }
    taskStarted = true
    taskContext = context
    console.log('[TtsBackgroundKeepAlive] background audio running')
  } catch (e) {
    const err = e as BusinessError
    console.error(
      '[TtsBackgroundKeepAlive] begin failed code=' + err.code + ' ' + err.message,
    )
    if (session != null) {
      rollbackSession(session, context, false)
    }
    if (runToken == token) {
      active = false
    }
  }
}

export class TtsBackgroundKeepAlive {
  static bind(context: common.UIAbilityContext): void {
    boundContext = context
  }

  /** 渲染器已 start 后调用。已申请过则直接返回。 */
  static begin(): void {
    if (active) {
      return
    }
    const context = boundContext
    if (context == null) {
      console.warn('[TtsBackgroundKeepAlive] begin skipped: no ability context')
      return
    }
    active = true
    token += 1
    const runToken = token
    startBackgroundAudio(context, runToken)
  }

  /** 播完或手动停止。幂等。 */
  static end(): void {
    token += 1
    active = false
    const session = aliveSession
    aliveSession = null
    const ctx = taskContext
    const stopTask = taskStarted
    taskStarted = false
    taskContext = null
    if (session != null) {
      const stopped: avSession.AVPlaybackState = {
        state: avSession.PlaybackState.PLAYBACK_STATE_STOP,
      }
      session.setAVPlaybackState(stopped).catch((e: BusinessError) => {
        console.warn('[TtsBackgroundKeepAlive] set stopped failed ' + e.code)
      })
      session.deactivate().catch((e: BusinessError) => {
        console.warn('[TtsBackgroundKeepAlive] deactivate failed ' + e.code)
      })
      session.destroy().catch((e: BusinessError) => {
        console.warn('[TtsBackgroundKeepAlive] destroy session failed ' + e.code)
      })
    }
    if (stopTask && ctx != null) {
      backgroundTaskManager.stopBackgroundRunning(ctx).catch((e: BusinessError) => {
        console.warn('[TtsBackgroundKeepAlive] stop background failed ' + e.code)
      })
    }
  }
}
