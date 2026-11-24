import { UIAbility, Want, AbilityConstant } from '@kit.AbilityKit'
import { window } from '@kit.ArkUI'
import { VoipBridge } from '@uni_modules/nuwax-voip'

export default class NuwaxVoipMediaAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void { VoipBridge.mediaContext = this.context }
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.getMainWindow().then(mainWindow => mainWindow.setWindowSystemBarProperties({
      statusBarColor: '#46534F', statusBarContentColor: '#FFFFFF',
      navigationBarColor: '#202827', navigationBarContentColor: '#FFFFFF'
    })).catch(() => {})
    stage.loadContent('pages/NuwaxVoipMedia').catch(() => VoipBridge.finish('mediaHostFailed'))
  }
  onBackground(): void { VoipBridge.media(JSON.stringify({ op: 'background', hidden: true })) }
  onForeground(): void { VoipBridge.media(JSON.stringify({ op: 'background', hidden: false })) }
  onDestroy(): void {
    if (VoipBridge.mediaContext !== this.context) return
    const callId = VoipBridge.current?.callId
    if (callId && VoipBridge.mediaId === callId && VoipBridge.nativeVoiceCallId !== callId) {
      VoipBridge.action('end')
    }
    VoipBridge.controller = null; VoipBridge.mediaReady = false; VoipBridge.mediaContext = null
  }
}
