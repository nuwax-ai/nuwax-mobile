import { UIAbility, Want, AbilityConstant } from '@kit.AbilityKit'
import { window } from '@kit.ArkUI'
import { VoipBridge } from '@uni_modules/nuwax-voip'

export default class NuwaxVoipMediaAbility extends UIAbility {
  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void { VoipBridge.mediaContext = this.context }
  onWindowStageCreate(stage: window.WindowStage): void {
    stage.loadContent('pages/NuwaxVoipMedia').catch(() => VoipBridge.finish('mediaHostFailed'))
  }
  onBackground(): void { VoipBridge.media(JSON.stringify({ op: 'background', hidden: true })) }
  onForeground(): void { VoipBridge.media(JSON.stringify({ op: 'background', hidden: false })) }
  onDestroy(): void {
    VoipBridge.controller = null; VoipBridge.mediaReady = false; VoipBridge.mediaContext = null
    if (VoipBridge.current) VoipBridge.action('end')
  }
}
