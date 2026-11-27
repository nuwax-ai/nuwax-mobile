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

let delayId: number = -1
let holdingCall: boolean = false
let taskContext: common.UIAbilityContext | null = null
let taskStarted: boolean = false
let token: number = 0

function requestCallDelay(): void {
  if (!holdingCall) {
    return
  }
  try {
    const info = backgroundTaskManager.requestSuspendDelay('voice-note-call', (): void => {
      requestCallDelay()
    })
    delayId = info.requestId
  } catch (eDelay) {
    console.warn('[voice-note] suspend delay failed', eDelay)
  }
}

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

  /**
   * 系统可能因通话停录取消了长时任务。只清本地标记，不主动 stop。
   * 挂断后重新开录再申请；任务其实还在时，再次申请会按已在运行处理。
   */
  static markStale(): void {
    taskStarted = false
  }

  /**
   * 必须在刚退后台的几秒内申请。接通时再申请会返回 9900002。
   * 到期后续上，进程才能在通话停录后仍留在后台，对原来的录音器 resume。
   */
  static holdForCall(): void {
    if (holdingCall) {
      return
    }
    holdingCall = true
    requestCallDelay()
  }

  /** 已经重新开录。当前这段短时保活用完即止，不再续。 */
  static releaseCallHold(): void {
    holdingCall = false
  }
}
