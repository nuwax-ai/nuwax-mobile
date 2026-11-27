#!/usr/bin/env python3
"""Generate isolated iOS 5.34 test or full business App hosts; never print signing material."""
import os, json, plistlib, re, shutil, subprocess
from pathlib import Path
from ios_push_config import IOS_LAUNCH_STORYBOARD, IOS_VOIP_RINGTONE, selected_push_configuration
ROOT=Path(__file__).resolve().parents[3]
SDK=Path(os.environ['UNIAPPX_SDK_ROOT']).resolve()
BUSINESS=os.environ.get('NUWAX_VOIP_BUSINESS_HOST')=='1'
HX_DEV=BUSINESS and os.environ.get('NUWAX_IOS_HX_DEV_NATIVE')=='1'
QA_PROJECT=Path(os.environ['NUWAX_IOS_QA_PROJECT']).resolve() if os.environ.get('NUWAX_IOS_QA_PROJECT') else None
STANDALONE=bool(QA_PROJECT) or (BUSINESS and os.environ.get('NUWAX_IOS_STANDALONE')=='1')
assert not (STANDALONE and HX_DEV), 'Standalone and HX development resources must not be mixed'
if QA_PROJECT:
 assert BUSINESS and str(QA_PROJECT).startswith(str(ROOT/'out')+'/'), 'QA source must be isolated under this worktree out/'
 qa=json.loads((QA_PROJECT/'nuwax-local-qa.json').read_text())
 assert qa['flavor']=='voip-business-qa' and qa['apiOrigin']=='https://testagent.xspaceagi.com', 'Invalid QA source variant'
HX_DEV_ROOT=ROOT/'unpackage/dist/dev/app-ios'
PROJECT='VoipBusiness' if BUSINESS else 'VoipDeviceTest'
OUT=ROOT/('out/voip-business-qa-ios' if STANDALONE else 'out/voip-business-ios' if BUSINESS else 'out/voip-device-ios')
RES=ROOT/('unpackage/resources/app-ios' if BUSINESS else 'out/voip-device-project/unpackage/resources/app-ios')
if QA_PROJECT: RES=QA_PROJECT/'unpackage/resources/app-ios'
MANIFEST=json.loads((ROOT/'manifest.json').read_text())
assert SDK.name == 'UniAppX-iOS@5.34' and (SDK/'SDK/Libs').is_dir(), 'Select the iOS 5.34 offline SDK via UNIAPPX_SDK_ROOT'
assert (RES/'__UNI__8BF05E4/www/app-service.js').is_file(), 'Export device project app resources in HBuilderX first'
if HX_DEV:
 assert (HX_DEV_ROOT/'app-service.js').is_file(), 'HX development resources missing: finish the HBuilderX iOS compile before building the development host; never fall back to release resources'
push_info, push_entitlements = selected_push_configuration('com.nuwax.app')
if STANDALONE and push_entitlements['aps-environment'] != 'development':
 raise ValueError('The standalone QA host requires a development APNs profile')
OUT.mkdir(parents=True,exist_ok=True)
APP=OUT/'App'
shutil.copytree(SDK/'UniAppXDemo/UniAppXDemo',APP,dirs_exist_ok=True)
shutil.rmtree(APP/'uni-app-x',ignore_errors=True)
shutil.copytree(RES/'__UNI__8BF05E4',APP/'uni-app-x/apps/__UNI__8BF05E4')
# iOS 系统启动屏：SDK Demo 自带的 LaunchScreen 是官方示例样式（无品牌 Logo，冷启动
# 只见一片白）。用仓库里的自定义 storyboard 覆盖，并补齐 @2x/@3x 图标；manifest.json
# 的同名 zip 给云打包用，两条打包路径共用 nativeResources/ios/launchscreen 这一份源。
LAUNCH_DIR=ROOT/'nativeResources/ios/launchscreen'
if (LAUNCH_DIR/'LaunchScreen.storyboard').is_file():
 for old in list(APP.rglob('LaunchScreen.storyboard'))+list(APP.rglob('LaunchScreen.storyboardc')):
  if old.is_dir(): shutil.rmtree(old,ignore_errors=True)
  else: old.unlink(missing_ok=True)
 icons=sorted(LAUNCH_DIR.glob('dc_launchscreen_icon@*.png'))
 assert icons, f'Missing iOS LaunchScreen icon assets under {LAUNCH_DIR}'
 # 与 SDK Demo 保持一致放进 Base.lproj；没有该目录时退回 App 根。
 storyboard_dir=APP/'Base.lproj' if (APP/'Base.lproj').is_dir() else APP
 shutil.copy2(LAUNCH_DIR/'LaunchScreen.storyboard',storyboard_dir/'LaunchScreen.storyboard')
 for icon in icons: shutil.copy2(icon,APP/icon.name)
if HX_DEV:
 shutil.rmtree(APP/'uni-app-x/apps/__UNI__8BF05E4/www')
 shutil.copytree(HX_DEV_ROOT,APP/'uni-app-x/apps/__UNI__8BF05E4/www')
if BUSINESS:
 # The offline SDK host explicitly restores the already consented native call
 # context before page initialization; it must not rely on a JS page opening.
 delegate=APP/'AppDelegate.m'
 text=delegate.read_text().replace('#import "UniAppX-Swift.h"', '#import "UniAppX-Swift.h"\n#import <unimoduleNuwaxVoip/unimoduleNuwaxVoip-Swift.h>')
 anchor='    [UniAppBridge applicationDidFinishLaunchingWithOptions:application :launchOptions];'
 assert text.count(anchor)==1, 'Offline SDK launch template changed; review native VoIP bootstrap'
 delegate.write_text(text.replace(anchor, anchor+'\n    [NuwaxVoipBridge restoreOnLaunch];'))
# The official demo replaces the SDK root with sample buttons. Keep its SDK scene lifecycle instead.
scene=APP/'SceneDelegate.m'
s=scene.read_text();start=s.index('    UIStoryboard *storyboard');end=s.index('\n}',start)
s=s[:start]+'''    self.window = self.sdkSceneDelegate.window;
    if (!self.window) {
        self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
        self.window.rootViewController = [[UniAppRootViewController alloc] init];
    }
    ((AppDelegate *)UIApplication.sharedApplication.delegate).window = self.window;
    [self.window makeKeyAndVisible];'''+s[end:]
scene.write_text(s)
# The SDK may restore the demo storyboard when rebuilding a scene. Its root must
# enter the test app automatically, including after a cold launch or SDK exit.
(APP/'ViewController.m').write_text('''#import "ViewController.h"
#import "UniAppX-Swift.h"

@interface ViewController ()
@property (nonatomic) BOOL openingTestApp;
@end

@implementation ViewController
- (void)viewDidAppear:(BOOL)animated {
    [super viewDidAppear:animated];
    if (self.openingTestApp || self.presentedViewController) return;
    self.openingTestApp = YES;
    [UniAppBridge presentWithDefaultAnimationWithRootViewController:self];
    self.openingTestApp = NO;
}
@end
''')
info=plistlib.loads((APP/'Info.plist').read_bytes())
version=json.loads((RES/'__UNI__8BF05E4/www/manifest.json').read_text())['version']
info.update(CFBundleIdentifier='$(PRODUCT_BUNDLE_IDENTIFIER)',CFBundleExecutable='$(EXECUTABLE_NAME)',CFBundleName='$(PRODUCT_NAME)',CFBundlePackageType='APPL',CFBundleInfoDictionaryVersion='6.0',
 CFBundleDisplayName='Nuwax VoIP Test',CFBundleShortVersionString=str(version['name']),CFBundleVersion=str(version['code']),NuwaxVoipDeviceTest=True,
 NSMicrophoneUsageDescription='用于您主动拨打或接听测试通话；通话期间后台和锁屏继续采集，挂断后释放。',
 NSCameraUsageDescription='用于您主动拨打或接听视频通话后的前台画面采集。',
 NSLocalNetworkUsageDescription='连接您指定的局域网 VoIP 测试服务，验证两台手机之间的语音和视频通话。',
 UILaunchStoryboardName='LaunchScreen',
 UIBackgroundModes=['audio','voip','remote-notification'])
info['uniapp-x']={'appid':'__UNI__8BF05E4','uniRuntimeVersion':'5.34','ipatype':2,'dcloud_appkey':os.environ['DCLOUD_APPKEY']}
info['NSAppTransportSecurity']={'NSAllowsLocalNetworking':True,'NSAllowsArbitraryLoads':True}
# UIKit uses the launch storyboard declaration to size the app on older iPhones.
assert (APP/'Base.lproj'/f'{IOS_LAUNCH_STORYBOARD}.storyboard').is_file(), 'Missing SDK launch storyboard'
info['UILaunchStoryboardName']=IOS_LAUNCH_STORYBOARD
info.pop('UIMainStoryboardFile',None)
info.pop('UILaunchScreen',None)
for scenes in info.get('UIApplicationSceneManifest',{}).get('UISceneConfigurations',{}).values():
 for item in scenes: item.pop('UISceneStoryboardFile',None)
if BUSINESS:
 info.pop('NuwaxVoipDeviceTest',None)
 info['CFBundleDisplayName']=MANIFEST['name']
 info['uniapp-x']['ipatype']=2 if STANDALONE else 1
 if QA_PROJECT:
  info['NuwaxBuildFlavor']='voip-business-qa'
  info['NuwaxAPIOrigin']=qa['apiOrigin']
  info['NuwaxSourceDigest']=qa['sourceDigest']
 info.update(MANIFEST.get('app-ios',{}).get('distribute',{}).get('privacyDescription',{}))
 info['NSLocalNetworkUsageDescription']=info.get('NSLocalNetworkUsageDescription') if 'NSLocalNetworkUsageDescription' in MANIFEST.get('app-ios',{}).get('distribute',{}).get('privacyDescription',{}) else '连接您配置的企业服务器及局域网设备。'
 info['NSAppTransportSecurity']={'NSAllowsLocalNetworking':True}
info.update(push_info)
(APP/'Info.plist').write_bytes(plistlib.dumps(info));os.chmod(APP/'Info.plist',0o600)
if BUSINESS:
 # Use the real product icon in both the HX host and the standalone QA App.
 icon=ROOT/MANIFEST['app-ios']['distribute']['icons']['appstore']
 assets=APP/'Assets.xcassets/AppIcon.appiconset'
 assert icon.is_file() and assets.is_dir(), 'Missing real App icon or SDK asset catalog'
 shutil.copy2(icon,assets/'Nuwax-1024.png')
 (assets/'Contents.json').write_text(json.dumps({'images':[{'idiom':'universal','platform':'ios','size':'1024x1024','filename':'Nuwax-1024.png'}],'info':{'author':'xcode','version':1}}))
(APP/'Test.entitlements').write_bytes(plistlib.dumps(push_entitlements))
libs={p.stem:p for p in (SDK/'SDK/Libs').glob('*.xcframework')}
libs['DCloudUTSExtAPI']=SDK/'TemporarySampleFramework/DCloudUTSExtAPI.xcframework'
queue=['DCloudUniappRuntime','DCloudUTSFoundation','DCloudUTSExtAPI','DCloudPermissionMicrophone','DCloudPermissionCamera','DCloudPermissionPush'];seen=set()
if BUSINESS and not STANDALONE: queue.append('DCloudDebugServe')
while queue:
 n=queue.pop()
 if n in seen:continue
 seen.add(n);p=libs[n]
 b=next(b for b in p.rglob(n+'.framework/'+n) if 'simulator' not in str(b))
 text=subprocess.check_output(['otool','-L',str(b)],text=True)
 queue.extend(x for x in re.findall(r'@rpath/([^/]+)\.framework/',text) if not x.startswith('libswift') and x not in seen)
frameworks=[{'framework':str(libs[n]),'embed':True,'codeSign':True} for n in sorted(seen)]
base={'SWIFT_VERSION':'5.0','IPHONEOS_DEPLOYMENT_TARGET':'15.0','ENABLE_MODULE_VERIFIER':'NO','SWIFT_STRICT_CONCURRENCY':'minimal','CLANG_ENABLE_MODULES':'YES','CODE_SIGN_IDENTITY':'Apple Development','DEVELOPMENT_TEAM':os.environ['IOS_DEVELOPMENT_TEAM']}
spec={'name':PROJECT,'options':{'deploymentTarget':{'iOS':'15.0'},'transitivelyLinkDependencies':True},'settings':{'base':base,'configs':{'Debug':{'SWIFT_ACTIVE_COMPILATION_CONDITIONS':'$(inherited) DEBUG'},'Release':{'SWIFT_ACTIVE_COMPILATION_CONDITIONS':'$(inherited)'}}},'packages':{'LiveKit':{'url':'https://github.com/livekit/client-sdk-swift.git','exactVersion':'2.19.0'}},'targets':{}}
modules=[]
pods={}
pod_sources=set()
if BUSINESS:
 # The meeting and VoIP frameworks import the same LiveKit module. Link one
 # CocoaPods version into the business host instead of also embedding SwiftPM's.
 spec.pop('packages')
 livekit_config=json.loads((ROOT/'uni_modules/nuwax-livekit/utssdk/app-ios/config.json').read_text())
for p in sorted((RES/'uni_modules').iterdir()):
 src=p/'utssdk/app-ios/src'
 if not src.is_dir():continue
 module='unimodule'+''.join(x[0].upper()+x[1:] for x in p.name.split('-'))
 dest=OUT/'Modules'/module
 shutil.rmtree(dest,ignore_errors=True)
 shutil.copytree(src,dest)
 if HX_DEV:
  dev_src=HX_DEV_ROOT/'uni_modules'/p.name/'utssdk/app-ios'
  if dev_src.is_dir(): shutil.copytree(dev_src,dest,dirs_exist_ok=True)
 # Native Swift implementations are authoritative in the module source. HX's
 # generated index.swift remains the UTS wrapper; cached copies must not replace
 # a newer private native implementation when rebuilding the offline host.
 for swift in (ROOT/'uni_modules'/p.name/'utssdk/app-ios').glob('*.swift'):
  shutil.copy2(swift,dest/swift.name)
 # PRODUCT_NAME must be explicit: newer Xcode no longer falls back to $(TARGET_NAME)
 # for framework targets, which produced '.framework' and a duplicate-output error.
 settings={'PRODUCT_BUNDLE_IDENTIFIER':('com.nuwax.app.module.' if BUSINESS else 'com.nuwax.test.')+module,'PRODUCT_NAME':module,'GENERATE_INFOPLIST_FILE':'YES','DEFINES_MODULE':'YES'}
 deps=[{'framework':str(libs[n]),'embed':False} for n in ['DCloudUTSFoundation','DCloudUniappRuntime','DCloudUTSExtAPI']]
 if BUSINESS:
  config_file=ROOT/'uni_modules'/p.name/'utssdk/app-ios/config.json'
  config=json.loads(config_file.read_text()) if config_file.exists() else {}
  for framework in config.get('frameworks',[]):
   if not framework.startswith('Frameworks/'): continue
   library=ROOT/'uni_modules'/p.name/'utssdk/app-ios'/framework
   assert library.exists(), f'Missing native dependency: {library}'
   deps.append({'framework':str(library),'embed':False})
   frameworks.append({'framework':str(library),'embed':True,'codeSign':True})
  if config.get('dependencies-pods'): pods[module]=config['dependencies-pods']
  pod_sources.update(config.get('dependencies-pod-sources', []))
 if p.name=='nuwax-voip':
  deps += [{'sdk':'LiveCommunicationKit.framework','weak':True},{'sdk':'CallKit.framework'},{'sdk':'PushKit.framework'},{'sdk':'AVFoundation.framework'},{'sdk':'Security.framework'},{'sdk':'UserNotifications.framework'}]
  if BUSINESS:
   pods[module]=livekit_config['dependencies-pods']
   pod_sources.update(livekit_config['dependencies-pod-sources'])
  else:
   deps.append({'package':'LiveKit','product':'LiveKit'})
 spec['targets'][module]={'type':'framework','platform':'iOS','sources':[str(dest)],'dependencies':deps,'settings':{'base':settings}}
 modules.append({'target':module,'embed':True,'codeSign':True})
spec['targets']['UniAppX']={'type':'application','platform':'iOS','sources':[{'path':str(APP),'excludes':['Info.plist','*.entitlements','uni-app-x']}],
 'dependencies':frameworks+modules,
 'settings':{'base':{'PRODUCT_BUNDLE_IDENTIFIER':'com.nuwax.app','PRODUCT_NAME':'UniAppX','SWIFT_OBJC_INTERFACE_HEADER_NAME':'UniAppX-Swift.h','SWIFT_OBJC_BRIDGING_HEADER':'App/UniAppXDemo-Bridging-Header.h','INFOPLIST_FILE':'App/Info.plist','INFOPLIST_OUTPUT_FORMAT':'binary','CODE_SIGN_ENTITLEMENTS':'App/Test.entitlements','CODE_SIGN_STYLE':'Manual','PROVISIONING_PROFILE_SPECIFIER':os.environ['IOS_PROVISIONING_PROFILE_UUID'],'OTHER_LDFLAGS':['$(inherited)','-ObjC','-lc++','-lz','-lsqlite3'],'LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks'],'ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','TARGETED_DEVICE_FAMILY':'1,2'}}}
spec['targets']['UniAppX']['sources'] += [
 {'path':str(APP/'uni-app-x'),'type':'folder','buildPhase':'resources'},
 {'path':str(SDK/'SDK/Resources/uni-static'),'type':'folder','buildPhase':'resources'},
 {'path':str(SDK/'SDK/Resources/uni-prompt.bundle'),'buildPhase':'resources'},
 {'path':str(SDK/'SDK/Resources/DCSVProgressHUD.bundle'),'buildPhase':'resources'}]
if 'unimoduleNuwaxVoip' in spec['targets']:
 assert IOS_VOIP_RINGTONE.is_file(), 'Missing native iOS VoIP ringtone source'
 # CallKit and LiveCommunicationKit resolve the sound by name in the host App bundle.
 spec['targets']['UniAppX']['sources'].append({'path':str(IOS_VOIP_RINGTONE),'buildPhase':'resources'})
(OUT/'project.json').write_text(json.dumps(spec,indent=2))
print('Generated isolated iOS host:',OUT,'with',len(modules),'UTS modules and',len(frameworks),'SDK frameworks')
subprocess.run(['xcodegen','generate','--spec',str(OUT/'project.json'),'--project',str(OUT)],check=True)

if BUSINESS and pods:
 lines=[f"source '{source}'" for source in sorted(pod_sources)]
 lines += ["platform :ios, '15.0'", f"project '{PROJECT}.xcodeproj'", "use_frameworks!"]
 for target, entries in list(pods.items())+[('UniAppX',[entry for entries in pods.values() for entry in entries])]:
  lines.append(f"target '{target}' do")
  for name, version in dict.fromkeys((entry['name'], entry['version']) for entry in entries):
   lines.append(f"  pod '{name}', '{version}'")
  lines.append("  pod 'SwiftProtobuf', '1.22.1'")
  lines.append('end')
 lines += ["post_install do |installer|", "  installer.pods_project.targets.each do |target|", "    target.build_configurations.each do |config|", "      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'", "      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'", "    end", "  end", "end"]
 (OUT/'Podfile').write_text('\n'.join(lines)+'\n')
 subprocess.run(['pod','install','--project-directory='+str(OUT)],check=True)
