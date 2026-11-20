/**
 * 伙伴页录音退后台继续采集。
 *
 * 一个 UIAbility 同时只能有一个长时任务。开录时若播报占着 AUDIO_PLAYBACK，先让出来，
 * 再申请 AUDIO_RECORDING。系统会校验当前确实在录音，所以要在 AVRecorder.start 成功之后调用。
 * 暂停、完成、放弃时 end，避免没在录还占着长时任务。
 */
import { backgroundTaskManager } from '@kit.BackgroundTasksKit'
import { common, wantAgent, Want } from '@kit.AbilityKit'
import { BusinessError } from '@kit.BasicServicesKit'
import { TtsBackgroundKeepAlive } from './TtsBackgroundKeepAlive.ets'

let taskContext: common.UIAbilityContext | null = null
let taskStarted: boolean = false
let token: number = 0

function delay(ms: number): Promise<void> {
  return new Promise<void>((resolve: () => void): void => {
    setTimeout((): void => {
      resolve()
    }, ms)
  })
}

async function applyRecordingTask(context: common.UIAbilityContext): Promise<void> {
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
  await backgroundTaskManager.startBackgroundRunning(
    context,
    backgroundTaskManager.BackgroundMode.AUDIO_RECORDING,
    agent,
  )
  taskContext = context
}

function stopRecordingTask(): void {
  const ctx = taskContext
  taskStarted = false
  taskContext = null
  if (ctx != null) {
    backgroundTaskManager.stopBackgroundRunning(ctx).catch((e: BusinessError) => {
      console.warn('[voice-note] stop background failed ' + e.code)
    })
  }
}

function keepStarted(runToken: number): void {
  if (runToken != token) {
    stopRecordingTask()
    return
  }
  taskStarted = true
  console.log('[voice-note] background recording running')
}

/** 长时任务已经在跑时再申请会返回 9800005，视为成功。 */
function alreadyRunning(err: BusinessError): boolean {
  return err.code == 9800005
}

async function ensure(context: common.UIAbilityContext, runToken: number): Promise<void> {
  TtsBackgroundKeepAlive.end()
  if (runToken != token || taskStarted) {
    return
  }
  try {
    await applyRecordingTask(context)
    keepStarted(runToken)
  } catch (e) {
    const err = e as BusinessError
    if (alreadyRunning(err)) {
      keepStarted(runToken)
      return
    }
    console.warn('[voice-note] background recording failed ' + err.code + ' ' + err.message)
    await delay(300)
    if (runToken != token || taskStarted) {
      return
    }
    try {
      await applyRecordingTask(context)
      keepStarted(runToken)
    } catch (e2) {
      const err2 = e2 as BusinessError
      if (alreadyRunning(err2)) {
        keepStarted(runToken)
        return
      }
      console.warn('[voice-note] background recording retry failed ' + err2.code + ' ' + err2.message)
    }
  }
}

export class VoiceNoteRecordKeepAlive {
  /** 录音器已经 start / resume 之后调用。已申请过则直接返回。 */
  static begin(context: common.UIAbilityContext): void {
    if (taskStarted) {
      return
    }
    token += 1
    const runToken = token
    ensure(context, runToken)
  }

  /** 暂停、完成或放弃。幂等。 */
  static end(): void {
    token += 1
    stopRecordingTask()
  }
}
