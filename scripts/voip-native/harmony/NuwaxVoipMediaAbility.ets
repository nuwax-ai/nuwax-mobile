import { UIAbility, Want, AbilityConstant } from '@kit.AbilityKit'
import { window } from '@kit.ArkUI'
import { VoipBridge } from '@uni_modules/nuwax-voip'

export default class NuwaxVoipMediaAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void { VoipBridge.mediaContext = this.context }
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.loadContent('pages/NuwaxVoipMedia').then(() => {
      if (VoipBridge.mediaContext !== this.context) return
      VoipBridge.mediaContentLoaded = true
      VoipBridge.resumeSystemVideoAnswer()
      stage.getMainWindow().then(mainWindow => mainWindow.setWindowSystemBarProperties({
        statusBarColor: '#00000000', statusBarContentColor: '#FFFFFF',
        navigationBarColor: '#00000000', navigationBarContentColor: '#FFFFFF'
      })).catch(() => {})
    }).catch(() => VoipBridge.finish('mediaHostFailed'))
  }
  onBackground(): void {
    VoipBridge.mediaForeground = false
    VoipBridge.media(JSON.stringify({ op: 'background', hidden: true }))
  }
  onForeground(): void {
    VoipBridge.mediaForeground = true
    VoipBridge.media(JSON.stringify({ op: 'background', hidden: false }))
    VoipBridge.resumeSystemVideoAnswer()
  }
  onDestroy(): void {
    if (VoipBridge.mediaContext !== this.context) return
    const callId = VoipBridge.current?.callId
    if (callId && VoipBridge.mediaId === callId && VoipBridge.nativeVoiceCallId !== callId) {
      VoipBridge.action('end')
    }
    VoipBridge.controller = null; VoipBridge.mediaReady = false; VoipBridge.mediaContext = null
    VoipBridge.mediaForeground = false; VoipBridge.mediaContentLoaded = false
  }
}
