#!/usr/bin/env python3
"""Generate and verify the standalone iOS tester host from the 11.24 app resources."""

import json
import os
import plistlib
import re
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts/ios-esp"))
from configure_demo import read_manifest_privacy

MANIFEST = json.loads((ROOT / "manifest.json").read_text())
IOS = MANIFEST["app-ios"]["distribute"]
APP_ID = MANIFEST["appid"]
BUNDLE_ID = IOS["appid"]
DEPLOYMENT = IOS["deploymentTarget"]
SDK_VERSION = "5.34"
SDK = Path(os.environ["UNIAPPX_SDK_ROOT"]).expanduser().resolve()
PROJECT_NAME = "NuwaxIOSTester"


def read_json(path):
    return json.loads(path.read_text())


def dump_plist(path, data):
    path.write_bytes(plistlib.dumps(data))


def provisioning_profile():
    uuid = os.environ["IOS_PROVISIONING_PROFILE_UUID"]
    supplied = os.environ.get("IOS_PROVISIONING_PROFILE_PATH")
    candidates = [Path(supplied).expanduser()] if supplied else [
        Path.home() / folder / f"{uuid}.mobileprovision"
        for folder in ("Library/Developer/Xcode/UserData/Provisioning Profiles",
                       "Library/MobileDevice/Provisioning Profiles")
    ]
    profile_path = next((p for p in candidates if p.is_file()), None)
    if profile_path is None:
        raise ValueError("找不到开发描述文件，请检查 UUID 或设置 IOS_PROVISIONING_PROFILE_PATH")
    profile = plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", str(profile_path)]))
    entitlements = profile["Entitlements"]
    team = os.environ["IOS_DEVELOPMENT_TEAM"]
    if (profile["UUID"].lower() != uuid.lower() or team not in profile["TeamIdentifier"]
            or entitlements["application-identifier"].split(".", 1)[1] != BUNDLE_ID
            or entitlements.get("aps-environment") != "development"
            or entitlements.get("get-task-allow") is not True or not profile.get("ProvisionedDevices")
            or profile["ExpirationDate"].replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc)):
        raise ValueError("需要同团队、同包名、未过期并授权 development APNs 的真机开发描述文件")
    return profile


def getui_configuration():
    source = Path(os.environ["NUWAX_IOS_UNIPUSH_CLIENT_IPA"]).expanduser()
    with zipfile.ZipFile(source) as ipa:
        paths = [name for name in ipa.namelist() if re.fullmatch(r"Payload/[^/]+\.app/Info\.plist", name)]
        if len(paths) != 1:
            raise ValueError("UniPush 基座需包含唯一的主 App")
        info = plistlib.loads(ipa.read(paths[0]))
    config = info.get("getui", {})
    keys = ("appid", "appKey", "appSecret")
    if (info.get("CFBundleIdentifier") != BUNDLE_ID or not isinstance(config, dict)
            or any(not isinstance(config.get(k), str) or not re.fullmatch(r"[A-Za-z0-9]+", config[k])
                   or config[k].lower() in ("appid", "appkey", "appsecret", "placeholder") for k in keys)):
        raise ValueError("UniPush 配置必须来自同包名且已配置普通推送的 iOS 基座")
    return {key: config[key] for key in keys}


def configure_app(app, resources, metadata):
    shutil.copytree(SDK / "UniAppXDemo/UniAppXDemo", app)
    shutil.rmtree(app / "uni-app-x")
    shutil.copytree(resources / APP_ID, app / "uni-app-x/apps" / APP_ID)

    # Keep the SDK scene lifecycle and avoid exposing the sample app menu.
    scene = app / "SceneDelegate.m"
    source = scene.read_text()
    start = source.index("    UIStoryboard *storyboard")
    end = source.index("\n}", start)
    scene.write_text(source[:start] + """    self.window = self.sdkSceneDelegate.window;
    if (!self.window) {
        self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene *)scene];
        self.window.rootViewController = [[UniAppRootViewController alloc] init];
    }
    ((AppDelegate *)UIApplication.sharedApplication.delegate).window = self.window;
    [self.window makeKeyAndVisible];""" + source[end:])
    (app / "ViewController.m").write_text("""#import "ViewController.h"
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
""")

    info = plistlib.loads((app / "Info.plist").read_bytes())
    version = read_json(resources / APP_ID / "www/manifest.json")["version"]
    info["NSLocalNetworkUsageDescription"] = "连接您配置的企业服务器及局域网设备。"
    info.update(read_manifest_privacy(ROOT))
    info.update({
        "CFBundleIdentifier": "$(PRODUCT_BUNDLE_IDENTIFIER)",
        "CFBundleExecutable": "$(EXECUTABLE_NAME)",
        "CFBundleName": "$(PRODUCT_NAME)",
        "CFBundlePackageType": "APPL",
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleDisplayName": MANIFEST["name"],
        "CFBundleShortVersionString": str(version["name"]),
        "CFBundleVersion": str(version["code"]),
        "CFBundleURLTypes": [{"CFBundleURLSchemes": [IOS["urltypes"]]}],
        "LSApplicationQueriesSchemes": MANIFEST["app-ios"]["urlschemewhitelist"],
        "NuwaxBuildFlavor": metadata["flavor"],
        "NuwaxAPIOrigin": metadata["apiOrigin"],
        "NuwaxSourceDigest": metadata["sourceDigest"],
        "UILaunchStoryboardName": "LaunchScreen",
        "UIBackgroundModes": IOS["UIBackgroundModes"],
        "ITSAppUsesNonExemptEncryption": False,
        "NSAppTransportSecurity": {"NSAllowsLocalNetworking": True},
        "getui": getui_configuration(),
        "uniapp-x": {
            "appid": APP_ID, "uniRuntimeVersion": SDK_VERSION, "ipatype": 2,
            "dcloud_appkey": os.environ["DCLOUD_APPKEY"],
        },
    })
    info.pop("UIMainStoryboardFile", None)
    info.pop("UILaunchScreen", None)
    for scenes in info["UIApplicationSceneManifest"]["UISceneConfigurations"].values():
        for item in scenes:
            item.pop("UISceneStoryboardFile", None)
    dump_plist(app / "Info.plist", info)
    (app / "Info.plist").chmod(0o600)
    dump_plist(app / "Tester.entitlements", {"aps-environment": "development"})

    icon_set = app / "Assets.xcassets/AppIcon.appiconset"
    shutil.copy2(ROOT / IOS["icons"]["appstore"], icon_set / "Nuwax-1024.png")
    (icon_set / "Contents.json").write_text(json.dumps({
        "images": [{"idiom": "universal", "platform": "ios", "size": "1024x1024", "filename": "Nuwax-1024.png"}],
        "info": {"author": "xcode", "version": 1},
    }))


def sdk_frameworks():
    libraries = {p.stem: p for p in (SDK / "SDK/Libs").glob("*.xcframework")}
    libraries["DCloudUTSExtAPI"] = SDK / "TemporarySampleFramework/DCloudUTSExtAPI.xcframework"
    base = ["DCloudUniappRuntime", "DCloudUTSFoundation", "DCloudUTSExtAPI"]
    pending = base + ["DCloudPermissionMicrophone", "DCloudPermissionCamera", "DCloudPermissionPush"]
    dependencies = set()
    while pending:
        name = pending.pop()
        if name in dependencies:
            continue
        dependencies.add(name)
        binary = next(p for p in libraries[name].glob(f"*/{name}.framework/{name}") if "simulator" not in p.parent.parent.name)
        linked = subprocess.check_output(["otool", "-L", str(binary)], text=True)
        pending.extend(name for name in re.findall(r"@rpath/([^/]+)\.framework/", linked)
                       if not name.startswith("libswift"))
    embedded = [{"framework": str(libraries[name]), "embed": True, "codeSign": True} for name in sorted(dependencies)]
    linked = [{"framework": str(libraries[name]), "embed": False} for name in base]
    return embedded, linked


def module_targets(resources, project, host, embedded, linked):
    targets = {}
    pods = {}
    pod_sources = set()
    for export in sorted((resources / "uni_modules").iterdir()):
        source = export / "utssdk/app-ios/src"
        if not source.is_dir():
            continue
        module = "unimodule" + "".join(word[0].upper() + word[1:] for word in export.name.split("-"))
        destination = host / "Modules" / module
        shutil.copytree(source, destination)
        native = project / "uni_modules" / export.name / "utssdk/app-ios"
        for swift in native.glob("*.swift"):
            shutil.copy2(swift, destination / swift.name)
        config = read_json(native / "config.json") if (native / "config.json").is_file() else {}
        dependencies = list(linked)
        for framework in config.get("frameworks", []):
            if not framework.startswith("Frameworks/"):
                continue
            library = native / framework
            if not library.is_dir():
                raise ValueError(f"缺少原生依赖：{library}")
            dependencies.append({"framework": str(library), "embed": False})
            embedded.append({"framework": str(library), "embed": True, "codeSign": True})
        if config.get("dependencies-pods"):
            pods[module] = [(entry["name"], entry["version"]) for entry in config["dependencies-pods"]]
            pod_sources.update(config.get("dependencies-pod-sources", []))
        targets[module] = {
            "type": "framework", "platform": "iOS", "sources": [str(destination)],
            "dependencies": dependencies,
            "settings": {"base": {
                "PRODUCT_BUNDLE_IDENTIFIER": f"{BUNDLE_ID}.module.{module}",
                "GENERATE_INFOPLIST_FILE": "YES", "DEFINES_MODULE": "YES",
            }},
        }
    return targets, pods, pod_sources


def generate(project, host):
    resources = project / "unpackage/resources/app-ios"
    if not (resources / APP_ID / "www/app-service.js").is_file():
        raise ValueError("HBuilderX 没有生成本次 iOS appResource")
    app = host / "App"
    configure_app(app, resources, read_json(project / "nuwax-ios-tester.json"))
    embedded, linked = sdk_frameworks()
    targets, pods, pod_sources = module_targets(resources, project, host, embedded, linked)
    dependencies = embedded + [{"target": module, "embed": True, "codeSign": True} for module in targets]
    sdk_resources = SDK / "SDK/Resources"
    targets["UniAppX"] = {
        "type": "application", "platform": "iOS",
        "sources": [
            {"path": str(app), "excludes": ["Info.plist", "*.entitlements", "uni-app-x"]},
            *({"path": str(folder), "type": "folder", "buildPhase": "resources"}
              for folder in (app / "uni-app-x", sdk_resources / "uni-static")),
            *({"path": str(sdk_resources / name), "buildPhase": "resources"}
              for name in ("uni-prompt.bundle", "DCSVProgressHUD.bundle")),
        ],
        "dependencies": dependencies,
        "settings": {"base": {
            "PRODUCT_BUNDLE_IDENTIFIER": BUNDLE_ID, "PRODUCT_NAME": "UniAppX",
            "SWIFT_OBJC_INTERFACE_HEADER_NAME": "UniAppX-Swift.h",
            "SWIFT_OBJC_BRIDGING_HEADER": "App/UniAppXDemo-Bridging-Header.h",
            "INFOPLIST_FILE": "App/Info.plist", "INFOPLIST_OUTPUT_FORMAT": "binary",
            "CODE_SIGN_ENTITLEMENTS": "App/Tester.entitlements", "CODE_SIGN_STYLE": "Manual",
            "PROVISIONING_PROFILE_SPECIFIER": os.environ["IOS_PROVISIONING_PROFILE_UUID"],
            "OTHER_LDFLAGS": ["$(inherited)", "-ObjC", "-lc++", "-lz", "-lsqlite3"],
            "ASSETCATALOG_COMPILER_APPICON_NAME": "AppIcon", "TARGETED_DEVICE_FAMILY": "1,2",
        }},
    }
    spec = {
        "name": PROJECT_NAME,
        "options": {"deploymentTarget": {"iOS": DEPLOYMENT}, "transitivelyLinkDependencies": True},
        "settings": {"base": {
            "SWIFT_VERSION": "5.0", "ENABLE_MODULE_VERIFIER": "NO",
            "SWIFT_STRICT_CONCURRENCY": "minimal", "CLANG_ENABLE_MODULES": "YES",
            "CODE_SIGN_IDENTITY": "Apple Development", "DEVELOPMENT_TEAM": os.environ["IOS_DEVELOPMENT_TEAM"],
        }},
        "targets": targets,
    }
    spec_path = host / "project.json"
    spec_path.write_text(json.dumps(spec, indent=2))
    subprocess.run(["xcodegen", "generate", "--spec", str(spec_path), "--project", str(host)], check=True)

    lines = [f"source '{source}'" for source in sorted(pod_sources)]
    lines += [f"platform :ios, '{DEPLOYMENT}'", f"project '{PROJECT_NAME}.xcodeproj'", "use_frameworks!"]
    for target, entries in [*pods.items(), ("UniAppX", [entry for group in pods.values() for entry in group])]:
        lines.append(f"target '{target}' do")
        for name, version in dict.fromkeys([*entries, ("SwiftProtobuf", "1.22.1")]):
            lines.append(f"  pod '{name}', '{version}'")
        lines.append("end")
    lines += [
        "post_install do |installer|",
        "  installer.pods_project.targets.each do |target|",
        "    target.build_configurations.each do |config|",
        f"      config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '{DEPLOYMENT}'",
        "      config.build_settings['CODE_SIGNING_ALLOWED'] = 'NO'",
        "    end",
        "  end",
        "end",
    ]
    (host / "Podfile").write_text("\n".join(lines) + "\n")
    subprocess.run(["pod", "install", f"--project-directory={host}"], check=True)


def verify(project, app):
    subprocess.run(["codesign", "--verify", "--deep", "--strict", str(app)], check=True)
    signing = plistlib.loads(subprocess.check_output(["codesign", "-d", "--entitlements", ":-", str(app)]))
    embedded = plistlib.loads(subprocess.check_output([
        "security", "cms", "-D", "-i", str(app / "embedded.mobileprovision"),
    ]))
    info = plistlib.loads((app / "Info.plist").read_bytes())
    metadata = read_json(project / "nuwax-ios-tester.json")
    if (info["CFBundleIdentifier"] != BUNDLE_ID or signing.get("aps-environment") != "development"
            or embedded["UUID"].lower() != provisioning_profile()["UUID"].lower()
            or info["uniapp-x"]["ipatype"] != 2 or info["getui"] != getui_configuration()
            or info["NuwaxSourceDigest"] != metadata["sourceDigest"]
            or info["NuwaxAPIOrigin"] != metadata["apiOrigin"]
            or (app / "Frameworks/DCloudDebugServe.framework").exists()):
        raise ValueError("IPA 的身份、签名、推送或独立运行配置与本次测试构建不符")
    export = project / "unpackage/resources/app-ios" / APP_ID / "www"
    packaged = app / "uni-app-x/apps" / APP_ID / "www"
    expected_version = read_json(export / "manifest.json")["version"]
    if (info["CFBundleShortVersionString"] != str(expected_version["name"])
            or info["CFBundleVersion"] != str(expected_version["code"])
            or metadata["apiOrigin"].encode() not in (packaged / "app-service.js").read_bytes()):
        raise ValueError("App 版本或测试环境与本次资源导出不符")
    for file in export.rglob("*"):
        if file.is_file() and file.name != ".DS_Store":
            relative = file.relative_to(export)
            if file.read_bytes() != (packaged / relative).read_bytes():
                raise ValueError(f"包内业务资源与本次导出不一致：{relative}")
    print(f"已验签：{BUNDLE_ID} {info['CFBundleShortVersionString']} ({info['CFBundleVersion']})")


if __name__ == "__main__":
    command, *args = sys.argv[1:]
    if command == "check":
        if not (SDK / "SDK/Libs").is_dir() or SDK.name != f"UniAppX-iOS@{SDK_VERSION}":
            raise SystemExit(f"需要原始 UniAppX-iOS@{SDK_VERSION} 离线 SDK")
        provisioning_profile()
        getui_configuration()
    elif command == "generate":
        generate(*map(Path, args))
    elif command == "verify":
        verify(*map(Path, args))
