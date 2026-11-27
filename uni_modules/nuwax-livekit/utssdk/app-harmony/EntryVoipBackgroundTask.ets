import { common, wantAgent, Want } from '@kit.AbilityKit'
import { util } from '@kit.ArkTS'
import { backgroundTaskManager } from '@kit.BackgroundTasksKit'

/** EntryAbility has a single VOIP task on API 20. Meeting and native voice share its ownership. */
export class EntryVoipBackgroundTask {
  private static owners: Set<string> = new Set<string>()
  private static context: common.UIAbilityContext | undefined
  private static launchId: string = ''
  private static queue: Promise<void> = Promise.resolve()

  static acquire(owner: string, context: common.UIAbilityContext, needed: () => boolean): Promise<boolean> {
    const operation = EntryVoipBackgroundTask.queue.then(async (): Promise<boolean> => {
      if (!needed()) return false
      if (EntryVoipBackgroundTask.owners.has(owner)) return true
      if (!EntryVoipBackgroundTask.context) {
        const launchId = util.generateRandomUUID(true)
        const target = await wantAgent.getWantAgent({
          wants: [{ bundleName: context.abilityInfo.bundleName, moduleName: context.abilityInfo.moduleName,
            abilityName: 'EntryAbility', parameters: { nuwaxMeetingTask: launchId } }],
          actionType: wantAgent.OperationType.START_ABILITY, requestCode: parseInt(launchId.substring(0, 7), 16),
          actionFlags: [wantAgent.WantAgentFlags.UPDATE_PRESENT_FLAG],
        })
        if (!needed()) return false
        await backgroundTaskManager.startBackgroundRunning(context, backgroundTaskManager.BackgroundMode.VOIP, target)
        EntryVoipBackgroundTask.context = context
        EntryVoipBackgroundTask.launchId = launchId
      }
      EntryVoipBackgroundTask.owners.add(owner)
      return true
    })
    EntryVoipBackgroundTask.queue = operation.then(() => {}, () => {})
    return operation
  }

  static acceptsNotification(want: Want): boolean {
    const launchId = EntryVoipBackgroundTask.launchId
    return launchId.length > 0 && want.parameters?.['nuwaxMeetingTask'] === launchId
  }

  static release(owner: string): Promise<void> {
    const operation = EntryVoipBackgroundTask.queue.then(async (): Promise<void> => {
      if (!EntryVoipBackgroundTask.owners.delete(owner) || EntryVoipBackgroundTask.owners.size > 0) return
      const context = EntryVoipBackgroundTask.context
      EntryVoipBackgroundTask.context = undefined
      EntryVoipBackgroundTask.launchId = ''
      if (context) await backgroundTaskManager.stopBackgroundRunning(context)
    })
    EntryVoipBackgroundTask.queue = operation.catch(() => {})
    return operation
  }
}
