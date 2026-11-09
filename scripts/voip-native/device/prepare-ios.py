#!/usr/bin/env python3
"""Generate isolated iOS 5.34 test or full business App hosts; never print signing material."""
import os, json, plistlib, re, shutil, subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parents[3]
SDK=Path(os.environ['UNIAPPX_SDK_ROOT']).resolve()
BUSINESS=os.environ.get('NUWAX_VOIP_BUSINESS_HOST')=='1'
PROJECT='VoipBusiness' if BUSINESS else 'VoipDeviceTest'
OUT=ROOT/('out/voip-business-ios' if BUSINESS else 'out/voip-device-ios')
RES=ROOT/('unpackage/resources/app-ios' if BUSINESS else 'out/voip-device-project/unpackage/resources/app-ios')
MANIFEST=json.loads((ROOT/'manifest.json').read_text())
assert str(SDK).startswith(str(ROOT/'out')+'/'), 'iOS SDK must be isolated under this worktree out/'
assert (RES/'__UNI__8BF05E4/www/app-service.js').is_file(), 'Export device project app resources in HBuilderX first'
OUT.mkdir(parents=True,exist_ok=True)
APP=OUT/'App'
shutil.copytree(SDK/'UniAppXDemo/UniAppXDemo',APP,dirs_exist_ok=True)
shutil.rmtree(APP/'uni-app-x',ignore_errors=True)
shutil.copytree(RES/'__UNI__8BF05E4',APP/'uni-app-x/apps/__UNI__8BF05E4')
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
 UIBackgroundModes=['audio','voip','remote-notification'])
info['uniapp-x']={'appid':'__UNI__8BF05E4','uniRuntimeVersion':'5.34','ipatype':2,'dcloud_appkey':os.environ['DCLOUD_APPKEY']}
info['NSAppTransportSecurity']={'NSAllowsLocalNetworking':True,'NSAllowsArbitraryLoads':True}
info.pop('UIMainStoryboardFile',None)
for scenes in info.get('UIApplicationSceneManifest',{}).get('UISceneConfigurations',{}).values():
 for item in scenes: item.pop('UISceneStoryboardFile',None)
if BUSINESS:
 info.pop('NuwaxVoipDeviceTest',None)
 info['CFBundleDisplayName']=MANIFEST['name']
 info['uniapp-x']['ipatype']=1
 info.update(MANIFEST.get('app-ios',{}).get('distribute',{}).get('privacyDescription',{}))
 info['NSLocalNetworkUsageDescription']=info.get('NSLocalNetworkUsageDescription') if 'NSLocalNetworkUsageDescription' in MANIFEST.get('app-ios',{}).get('distribute',{}).get('privacyDescription',{}) else '连接您配置的企业服务器及局域网设备。'
 info['NSAppTransportSecurity']={'NSAllowsLocalNetworking':True}
(APP/'Info.plist').write_bytes(plistlib.dumps(info));os.chmod(APP/'Info.plist',0o600)
(APP/'Test.entitlements').write_bytes(plistlib.dumps({'aps-environment':'development'}))
libs={p.stem:p for p in (SDK/'SDK/Libs').glob('*.xcframework')}
libs['DCloudUTSExtAPI']=SDK/'TemporarySampleFramework/DCloudUTSExtAPI.xcframework'
queue=['DCloudUniappRuntime','DCloudUTSFoundation','DCloudUTSExtAPI','DCloudPermissionMicrophone','DCloudPermissionCamera','DCloudPermissionPush'];seen=set()
if BUSINESS: queue.append('DCloudDebugServe')
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
for p in sorted((RES/'uni_modules').iterdir()):
 src=p/'utssdk/app-ios/src'
 if not src.is_dir():continue
 module='unimodule'+''.join(x[0].upper()+x[1:] for x in p.name.split('-'))
 dest=OUT/'Modules'/module
 shutil.copytree(src,dest,dirs_exist_ok=True)
 settings={'PRODUCT_BUNDLE_IDENTIFIER':('com.nuwax.app.module.' if BUSINESS else 'com.nuwax.test.')+module,'GENERATE_INFOPLIST_FILE':'YES','DEFINES_MODULE':'YES'}
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
 if p.name=='nuwax-voip':
  deps += [{'package':'LiveKit','product':'LiveKit'},{'sdk':'LiveCommunicationKit.framework','weak':True},{'sdk':'PushKit.framework'},{'sdk':'AVFoundation.framework'},{'sdk':'Security.framework'},{'sdk':'UserNotifications.framework'}]
 spec['targets'][module]={'type':'framework','platform':'iOS','sources':[str(dest)],'dependencies':deps,'settings':{'base':settings}}
 modules.append({'target':module,'embed':True,'codeSign':True})
spec['targets']['UniAppX']={'type':'application','platform':'iOS','sources':[{'path':str(APP),'excludes':['Info.plist','*.entitlements','uni-app-x']}],
 'dependencies':frameworks+modules,
 'settings':{'base':{'PRODUCT_BUNDLE_IDENTIFIER':'com.nuwax.app','PRODUCT_NAME':'UniAppX','SWIFT_OBJC_INTERFACE_HEADER_NAME':'UniAppX-Swift.h','SWIFT_OBJC_BRIDGING_HEADER':str(APP/'UniAppXDemo-Bridging-Header.h'),'INFOPLIST_FILE':str(APP/'Info.plist'),'INFOPLIST_OUTPUT_FORMAT':'binary','CODE_SIGN_ENTITLEMENTS':str(APP/'Test.entitlements'),'CODE_SIGN_STYLE':'Manual','PROVISIONING_PROFILE_SPECIFIER':os.environ['IOS_PROVISIONING_PROFILE_UUID'],'OTHER_LDFLAGS':['$(inherited)','-ObjC','-lc++','-lz','-lsqlite3'],'LD_RUNPATH_SEARCH_PATHS':['$(inherited)','@executable_path/Frameworks'],'ASSETCATALOG_COMPILER_APPICON_NAME':'AppIcon','TARGETED_DEVICE_FAMILY':'1,2'}}}
spec['targets']['UniAppX']['sources'] += [
 {'path':str(APP/'uni-app-x'),'type':'folder','buildPhase':'resources'},
 {'path':str(SDK/'SDK/Resources/uni-static'),'type':'folder','buildPhase':'resources'},
 {'path':str(SDK/'SDK/Resources/uni-prompt.bundle'),'buildPhase':'resources'},
 {'path':str(SDK/'SDK/Resources/DCSVProgressHUD.bundle'),'buildPhase':'resources'}]
(OUT/'project.json').write_text(json.dumps(spec,indent=2))
print('Generated isolated iOS host:',OUT,'with',len(modules),'UTS modules and',len(frameworks),'SDK frameworks')
subprocess.run(['xcodegen','generate','--spec',str(OUT/'project.json'),'--project',str(OUT)],check=True)

if BUSINESS and pods:
 lines=["platform :ios, '15.0'", f"project '{PROJECT}.xcodeproj'", "use_frameworks!"]
 for target, entries in list(pods.items())+[('UniAppX',[entry for entries in pods.values() for entry in entries])]:
  lines.append(f"target '{target}' do")
  for entry in entries: lines.append(f"  pod '{entry['name']}', '{entry['version']}'")
  lines.append("  pod 'SwiftProtobuf', '1.22.1'")
  lines.append('end')
 lines += ["post_install do |installer|", "  installer.pods_project.targets.each do |target|", "    target.build_configurations.each do |config|", "      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '15.0'", "      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'", "    end", "  end", "end"]
 (OUT/'Podfile').write_text('\n'.join(lines)+'\n')
 subprocess.run(['pod','install','--project-directory='+str(OUT)],check=True)
