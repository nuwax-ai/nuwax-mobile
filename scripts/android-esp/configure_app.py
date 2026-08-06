#!/usr/bin/env python3
"""
配置 Android 离线宿主（官方 uniappxnativepackage）：
- applicationId / namespace = com.nuwax.app
- DCLOUD_UNI_APPID = __UNI__8BF05E4
- dcloud_appkey
- 从 settings / app / uniappx 去掉示例 UTS 模块依赖，只保留 uniappx + 我们的插件
- 默认 ENABLE_HX_DEBUG=1：拷贝 debug-server → app/libs + DCLOUD_DEBUG（HX 控制台 log）
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_base_paths import default_android_esp_work

WORK = Path(os.environ.get("ANDROID_ESP_WORK", default_android_esp_work()))
PROJ = WORK / "project"
PROJECT_ROOT = Path(__file__).resolve().parents[2]
APP_MANIFEST = json.loads((PROJECT_ROOT / "manifest.json").read_text())
APPID = os.environ.get("APPID", "__UNI__8BF05E4")
BUNDLE = os.environ.get("ANDROID_BUNDLE_ID", "com.nuwax.app")
APP_NAME = os.environ.get("APP_NAME", APP_MANIFEST["name"])
APP_VERSION_NAME = str(APP_MANIFEST.get("versionName", "")).strip()
try:
    APP_VERSION_CODE = int(APP_MANIFEST.get("versionCode", 0))
except (TypeError, ValueError) as exc:
    raise SystemExit("✗ manifest.json versionCode 必须为正整数") from exc
if not APP_VERSION_NAME:
    raise SystemExit("✗ manifest.json versionName 不能为空")
if APP_VERSION_CODE <= 0:
    raise SystemExit("✗ manifest.json versionCode 必须为正整数")
APPKEY = os.environ.get("DCLOUD_APPKEY")
if not APPKEY:
    raise SystemExit("✗ 未设置 DCLOUD_APPKEY（写到 scripts/local-secrets.env，已 gitignore）")
# 是否为 HBuilderX 自定义基座打入调试通道（debug-server + DCLOUD_DEBUG）。
# 默认开启；正式发行包请设 ENABLE_HX_DEBUG=0，否则可能提示「正在加载调试框架」。
ENABLE_HX_DEBUG = os.environ.get("ENABLE_HX_DEBUG", "1") != "0"
# Android 变体签名模式：release 时 debug/release 两个变体统一使用正式证书。
ANDROID_SIGNING_MODE = os.environ.get("ANDROID_SIGNING_MODE", "debug").strip().lower()
if ANDROID_SIGNING_MODE not in {"debug", "release"}:
    raise SystemExit("✗ ANDROID_SIGNING_MODE 仅支持 debug|release")
# 本机若未装 platforms;android-36 / build-tools;35，可降到已安装的 34（官方示例默认常为 36）
# 官方示例默认 compileSdk 36；本机需已装 platforms;android-36
COMPILE_SDK = int(os.environ.get("ANDROID_COMPILE_SDK", "36"))
TARGET_SDK = int(os.environ.get("ANDROID_TARGET_SDK", str(COMPILE_SDK)))
APP_RESOURCES_DIR = Path(
    os.environ.get(
        "APP_RESOURCES_DIR",
        PROJECT_ROOT / "unpackage/resources/app-android",
    )
)

SAMPLE_MODULES = [
    "test-invoke-network-api",
    "uni-getbatteryinfo",
    "uts-openSchema",
    "uts-progressNotification",
    "uts-get-native-view",
    "native-button",
    "native-time-picker",
    "uni-stat",
    "uni-openLocation",
    "uts-button",
    "uni-usercapturescreen",
    "uts-worker",
    "app-comm",
]

# 本地离线基座不需要的远程三方（网络不可达 / 非 ESP 配网必需）
# 个推 Maven 在部分网络下 TLS 握手失败，导致 assembleDebug 无法解析
OPTIONAL_REMOTE_DEPS = [
    r"implementation\s+'com\.getui:gtc-dcloud:[^']+'\s*(//[^\n]*)?\n",
    r"implementation\s*\(\s*'com\.getui:gtsdk:[^']+'\s*\)\s*\{[^}]*\}\s*(//[^\n]*)?\n",
    r'implementation\s+"com\.huawei\.hms:ads-lite:[^"]+"\s*\n',
    r"implementation\s+'com\.tencent\.map:[^']+'\s*\n",
    r"implementation\s+'com\.tencent\.map\.geolocation:[^']+'\s*\n",
    r"implementation\s+'com\.amap\.api:[^']+'\s*\n",
    # media3 1.8 要求 compileSdk>=35；本机若仅有 platform 34，去掉以免卡死
    r'implementation\s+"androidx\.media3:media3-[^"]+"\s*\n',
    # 支付插件自带 wechat-sdk aar，去掉远程同名依赖防 Duplicate class
    r'implementation\s+"com\.tencent\.mm\.opensdk:wechat-sdk-android:[^"]+"\s*\n',
]


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def configure_settings() -> None:
    p = PROJ / "settings.gradle"
    text = p.read_text()
    # 动态读取已注入的 UTS 模块
    injected: set[str] = set()
    marker = WORK / "injected-uts-modules.txt"
    if marker.is_file():
        injected = {x.strip() for x in marker.read_text().splitlines() if x.strip()}
    keep = {"app", "uniappx"} | injected | {"uts-nuwax-esp-provisioning"}
    lines = []
    for line in text.splitlines():
        m = re.match(r"include\s+':([^']+)'", line.strip())
        if m and m.group(1) not in keep:
            if not line.strip().startswith("//"):
                lines.append("// " + line + "  // stripped by configure_app")
                continue
        lines.append(line)
    text = "\n".join(lines) + "\n"
    for name in sorted(keep - {"app", "uniappx"}):
        if f"':{name}'" not in text:
            text += f"include ':{name}'\n"
    text = re.sub(
        r'rootProject\.name\s*=\s*"[^"]*"',
        'rootProject.name = "nuwax-mobile-android-base"',
        text,
    )
    p.write_text(text)
    print(f"✓ settings.gradle 精简 + UTS 模块 {sorted(keep - {'app', 'uniappx'})}")


def strip_optional_remote_deps(gradle_path: Path) -> None:
    """去掉个推/地图等非配网必需且易因 Maven 失败的依赖。"""
    if not gradle_path.is_file():
        return
    text = gradle_path.read_text()
    original = text
    for pat in OPTIONAL_REMOTE_DEPS:
        text = re.sub(pat, "", text)
    if text != original:
        gradle_path.write_text(text)
        print(f"✓ 去掉可选远程依赖: {gradle_path.relative_to(PROJ)}")


def confine_leakcanary_to_debug(gradle_path: Path) -> None:
    """
    官方示例把 LeakCanary 写成 implementation，assembleRelease 会打进非 debuggable 包，
    启动即抛：java.lang.Error: LeakCanary in non-debuggable build（表现为闪退）。
    改为 debugImplementation，Debug 联调仍可用，Release/发测试包不再包含。
    """
    if not gradle_path.is_file():
        return
    text = gradle_path.read_text()
    # 已是 debugImplementation 则跳过；仅改仍挂在 implementation 上的 leakcanary
    text2, n = re.subn(
        r'(?m)^(?P<indent>\s*)implementation(?P<rest>\s+[\'"]com\.squareup\.leakcanary:[^\'"]+[\'"])',
        r"\g<indent>debugImplementation\g<rest>",
        text,
    )
    if n:
        gradle_path.write_text(text2)
        print(
            f"✓ LeakCanary → debugImplementation（{n} 处）: "
            f"{gradle_path.relative_to(PROJ)}"
        )
    elif "leakcanary" in text.lower():
        print(f"✓ LeakCanary 已是 debug 范围: {gradle_path.relative_to(PROJ)}")


def hide_leakcanary_launcher_entry() -> None:
    """保留 Debug 泄漏检测，但不让 LeakCanary 在桌面创建“Leaks”入口。"""
    values_dir = PROJ / "app" / "src" / "debug" / "res" / "values"
    values_dir.mkdir(parents=True, exist_ok=True)
    target = values_dir / "nuwax_leakcanary.xml"
    target.write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<resources>
    <bool name="leak_canary_add_launcher_icon">false</bool>
    <bool name="leak_canary_add_dynamic_shortcut">false</bool>
</resources>
"""
    )
    print("✓ LeakCanary 保留检测能力，已隐藏桌面图标与动态快捷方式")


def strip_project_deps(gradle_path: Path) -> None:
    if not gradle_path.is_file():
        return
    text = gradle_path.read_text()
    for mod in SAMPLE_MODULES:
        text = re.sub(
            rf"\s*implementation\s+project\(':?{re.escape(mod)}'\)\s*\n",
            "\n",
            text,
        )
    # 确保注入的 UTS 模块依赖存在
    injected: list[str] = []
    marker = WORK / "injected-uts-modules.txt"
    if marker.is_file():
        injected = [x.strip() for x in marker.read_text().splitlines() if x.strip()]
    if not injected:
        injected = ["uts-nuwax-esp-provisioning"]
    for name in injected:
        needle = f"implementation project(':{name}')"
        if needle not in text and "dependencies {" in text:
            text = text.replace(
                "dependencies {",
                f"dependencies {{\n    {needle}",
                1,
            )
    gradle_path.write_text(text)
    print(f"✓ 精简依赖: {gradle_path.relative_to(PROJ)}")


def configure_release_signing(text: str) -> str:
    """为 debug/release 变体确定性配置签名，不把密码写入工程。"""
    marker_pattern = re.compile(
        r"\n\s*// BEGIN NUWAX RELEASE SIGNING.*?"
        r"// END NUWAX RELEASE SIGNING\s*\n",
        flags=re.DOTALL,
    )
    text = marker_pattern.sub("\n", text)

    signing_name = "debug"
    if ANDROID_SIGNING_MODE == "release":
        required = [
            "ANDROID_RELEASE_STORE_FILE",
            "ANDROID_RELEASE_STORE_PASSWORD",
            "ANDROID_RELEASE_KEY_ALIAS",
            "ANDROID_RELEASE_KEY_PASSWORD",
        ]
        missing = [name for name in required if not os.environ.get(name)]
        if missing:
            die(f"正式签名配置缺失: {', '.join(missing)}")
        store_file = Path(os.environ["ANDROID_RELEASE_STORE_FILE"]).expanduser()
        if not store_file.is_file():
            die(f"正式签名证书不存在: {store_file}")
        signing_block = """
    // BEGIN NUWAX RELEASE SIGNING — values are read from process environment
    signingConfigs {
        release {
            storeFile file(System.getenv("ANDROID_RELEASE_STORE_FILE"))
            storePassword System.getenv("ANDROID_RELEASE_STORE_PASSWORD")
            keyAlias System.getenv("ANDROID_RELEASE_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_RELEASE_KEY_PASSWORD")
            storeType System.getenv("ANDROID_RELEASE_STORE_TYPE") ?: "JKS"
        }
    }
    // END NUWAX RELEASE SIGNING
"""
        signing_name = "release"

    def _set_signing(m: re.Match[str]) -> str:
        block = re.sub(
            r"^[ \t]*signingConfig[ \t]+signingConfigs\.(?:debug|release)[ \t]*\n?",
            "",
            m.group(0),
            flags=re.MULTILINE,
        )
        return re.sub(
            r"((?:debug|release)\s*\{\s*\n)",
            rf"\1            signingConfig signingConfigs.{signing_name}\n",
            block,
            count=1,
        )

    text, release_count = re.subn(
        r"release\s*\{[^{}]*\}",
        _set_signing,
        text,
        count=1,
    )
    if release_count != 1:
        die("app/build.gradle 缺少可识别的 release buildType")
    text, debug_count = re.subn(
        r"debug\s*\{[^{}]*\}",
        _set_signing,
        text,
        count=1,
    )
    if debug_count == 0:
        text = text.replace(
            "    buildTypes {",
            "    buildTypes {\n"
            "        debug {\n"
            f"            signingConfig signingConfigs.{signing_name}\n"
            "        }",
            1,
        )
    if ANDROID_SIGNING_MODE == "release":
        if "buildTypes {" not in text:
            die("app/build.gradle 缺少 buildTypes，无法配置正式签名")
        text = text.replace("    buildTypes {", signing_block + "\n    buildTypes {", 1)
    print(f"✓ debug/release signingConfig=signingConfigs.{signing_name}")
    return text


def configure_app_gradle() -> None:
    p = PROJ / "app" / "build.gradle"
    text = p.read_text()
    # 同时覆盖官方模板与已有工作副本中的旧包名，确保包名迁移后再次构建即可生效。
    text = re.sub(r"namespace\s+['\"][^'\"]+['\"]", f"namespace '{BUNDLE}'", text, count=1)
    text = re.sub(
        r"applicationId\s+['\"][^'\"]+['\"]",
        f'applicationId "{BUNDLE}"',
        text,
        count=1,
    )
    # minSdk 至少 26（ESP 插件要求）
    text = re.sub(r"minSdk\s+\d+", "minSdk 26", text, count=1)
    # compileSdk / targetSdk：对齐本机已安装 platform
    text = re.sub(r"compileSdk\s+\d+", f"compileSdk {COMPILE_SDK}", text, count=1)
    text = re.sub(r"targetSdk\s+\d+", f"targetSdk {TARGET_SDK}", text, count=1)
    # 仅打 arm64-v8a：真机唯一需要的目标 ABI；去掉 armeabi-v7a/x86/x86_64 等约 127MB 死重量原生库。
    if "abiFilters 'arm64-v8a'" not in text and 'abiFilters "arm64-v8a"' not in text:
        text = re.sub(
            r"(targetSdk\s+\d+\s*\n)",
            r"\1        ndk {\n            abiFilters 'arm64-v8a'\n        }\n",
            text,
            count=1,
        )
    # manifest.json 是应用版本的唯一来源，避免离线宿主保留 SDK 示例版本。
    text = re.sub(
        r"versionCode\s+\d+", f"versionCode {APP_VERSION_CODE}", text, count=1
    )
    text = re.sub(
        r"versionName\s+['\"][^'\"]*['\"]",
        f'versionName "{APP_VERSION_NAME}"',
        text,
        count=1,
    )
    text = configure_release_signing(text)
    p.write_text(text)
    print(
        f"✓ app applicationId/namespace={BUNDLE} "
        f"versionName={APP_VERSION_NAME} versionCode={APP_VERSION_CODE} "
        f"minSdk=26 compileSdk={COMPILE_SDK} targetSdk={TARGET_SDK}"
    )


def configure_manifest() -> None:
    # uniappx module manifest
    p = PROJ / "uniappx" / "src" / "main" / "AndroidManifest.xml"
    text = p.read_text()
    text = re.sub(
        r'android:name="DCLOUD_UNI_APPID"\s+android:value="[^"]*"',
        f'android:name="DCLOUD_UNI_APPID" android:value="{APPID}"',
        text,
    )
    # dcloud_appkey
    if "dcloud_appkey" not in text and "DCLOUD_APPKEY" not in text:
        text = text.replace(
            "</application>",
            f'        <meta-data android:name="dcloud_appkey" android:value="{APPKEY}" />\n    </application>',
        )
    else:
        text = re.sub(
            r'android:name="dcloud_appkey"\s+android:value="[^"]*"',
            f'android:name="dcloud_appkey" android:value="{APPKEY}"',
            text,
        )
        text = re.sub(
            r'android:name="DCLOUD_APPKEY"\s+android:value="[^"]*"',
            f'android:name="DCLOUD_APPKEY" android:value="{APPKEY}"',
            text,
        )
    # scheme
    text = text.replace("hellouniappx", "nuwax")
    text = text.replace("uniappxhello", "nuwaxapp")
    text = text.replace(
        '@style/UniAppX.Activity.DefaultTheme',
        '@style/Theme.Nuwax.UniAppContent',
    )
    p.write_text(text)
    print(f"✓ uniappx AndroidManifest appid={APPID} dcloud_appkey=***")


def upsert_style(
    resources: ET.Element,
    name: str,
    parent: str,
    items: dict[str, str],
) -> None:
    """新增或更新 Android style，并保持脚本重复执行时结果稳定。"""
    style = next(
        (node for node in resources.findall("style") if node.get("name") == name),
        None,
    )
    if style is None:
        style = ET.SubElement(resources, "style", {"name": name, "parent": parent})
    else:
        style.set("parent", parent)

    existing = {node.get("name"): node for node in style.findall("item")}
    for item_name, value in items.items():
        node = existing.get(item_name)
        if node is None:
            node = ET.SubElement(style, "item", {"name": item_name})
        node.text = value


def write_resources_xml(path: Path, root: ET.Element) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    ET.indent(root, space="    ")
    ET.ElementTree(root).write(path, encoding="utf-8", xml_declaration=True)


def configure_app_name() -> None:
    """让离线 Android 宿主使用 manifest.json 中的应用显示名称。"""
    strings_path = PROJ / "app/src/main/res/values/strings.xml"
    if strings_path.is_file():
        tree = ET.parse(strings_path)
        resources = tree.getroot()
    else:
        resources = ET.Element("resources")

    app_name = next(
        (
            node
            for node in resources.findall("string")
            if node.get("name") == "app_name"
        ),
        None,
    )
    if app_name is None:
        app_name = ET.SubElement(resources, "string", {"name": "app_name"})
    app_name.text = APP_NAME
    write_resources_xml(strings_path, resources)
    print(f"✓ Android 应用名称={APP_NAME}")


def configure_splash_screen() -> None:
    """
    把 appResource 中的 Splash 图片注入离线 Android 宿主。

    manifest.json 的 splashScreens 属于云打包配置；离线 SDK 不会自动把这些
    Web 资源转换为 Android drawable/theme，因此 android:tester 必须显式同步。
    """
    src_root = APP_RESOURCES_DIR / APPID / "www/static/splash"
    res_root = PROJ / "app/src/main/res"
    densities = ("xhdpi", "xxhdpi", "xxxhdpi")

    required = [src_root / f"launch-{density}.png" for density in densities]
    required += [src_root / f"icon-{density}.png" for density in densities]
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        die("缺少 Android 启动页资源：\n  " + "\n  ".join(missing))

    for density in densities:
        drawable = res_root / f"drawable-{density}"
        drawable.mkdir(parents=True, exist_ok=True)
        shutil.copy2(
            src_root / f"launch-{density}.png",
            drawable / "nuwax_splash_screen.png",
        )
        shutil.copy2(
            src_root / f"icon-{density}.png",
            drawable / "nuwax_splash_icon.png",
        )

    drawable_root = res_root / "drawable"
    drawable_root.mkdir(parents=True, exist_ok=True)
    (drawable_root / "nuwax_splash_background.xml").write_text(
        """<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item>
        <shape android:shape="rectangle">
            <solid android:color="#FFFFFF" />
        </shape>
    </item>
    <item>
        <bitmap
            android:gravity="center"
            android:src="@drawable/nuwax_splash_screen" />
    </item>
</layer-list>
"""
    )

    themes_path = res_root / "values/themes.xml"
    tree = ET.parse(themes_path)
    resources = tree.getroot()
    upsert_style(
        resources,
        "Theme.Uniappxnativepackage",
        "Theme.AppCompat.Light",
        {
            "android:windowBackground": "@drawable/nuwax_splash_background",
            "android:windowNoTitle": "true",
        },
    )
    upsert_style(
        resources,
        "Theme.Nuwax.UniAppContent",
        "@style/UniAppX.Activity.DefaultTheme",
        {"android:windowBackground": "@drawable/nuwax_splash_background"},
    )
    write_resources_xml(themes_path, resources)

    values_v31 = ET.Element("resources")
    upsert_style(
        values_v31,
        "Theme.Uniappxnativepackage",
        "Theme.AppCompat.Light",
        {
            "android:windowSplashScreenBackground": "#FFFFFF",
            "android:windowSplashScreenAnimatedIcon": "@drawable/nuwax_splash_icon",
            "android:windowSplashScreenIconBackgroundColor": "#FFFFFF",
            "android:windowBackground": "@drawable/nuwax_splash_background",
            "android:windowNoTitle": "true",
        },
    )
    write_resources_xml(res_root / "values-v31/themes.xml", values_v31)
    print("✓ Android Splash 已注入 drawable/theme（Android 12+ 与低版本）")


def configure_launcher_icon() -> None:
    """把项目应用图标注入离线 Android 宿主，替换 SDK 示例机器人图标。"""
    src_root = APP_RESOURCES_DIR / APPID / "www/static/app-icon"
    res_root = PROJ / "app/src/main/res"
    densities = ("mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi")

    required = [src_root / f"launcher-{density}.png" for density in densities]
    required.append(src_root / "launcher-adaptive-foreground.png")
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        die("缺少 Android 应用图标资源：\n  " + "\n  ".join(missing))

    for density in densities:
        mipmap = res_root / f"mipmap-{density}"
        mipmap.mkdir(parents=True, exist_ok=True)
        for old_icon in (
            mipmap / "ic_launcher.webp",
            mipmap / "ic_launcher.png",
            mipmap / "ic_launcher_round.webp",
            mipmap / "ic_launcher_round.png",
        ):
            if old_icon.is_file():
                old_icon.unlink()
        shutil.copy2(src_root / f"launcher-{density}.png", mipmap / "ic_launcher.png")
        shutil.copy2(
            src_root / f"launcher-{density}.png",
            mipmap / "ic_launcher_round.png",
        )

    adaptive_dir = res_root / "drawable-xxxhdpi"
    adaptive_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(
        src_root / "launcher-adaptive-foreground.png",
        adaptive_dir / "nuwax_launcher_foreground.png",
    )

    colors_path = res_root / "values/colors.xml"
    colors_tree = ET.parse(colors_path)
    colors = colors_tree.getroot()
    background = next(
        (
            node
            for node in colors.findall("color")
            if node.get("name") == "nuwax_launcher_background"
        ),
        None,
    )
    if background is None:
        background = ET.SubElement(
            colors,
            "color",
            {"name": "nuwax_launcher_background"},
        )
    background.text = "#EFEDFB"
    write_resources_xml(colors_path, colors)

    adaptive_xml = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/nuwax_launcher_background" />
    <foreground android:drawable="@drawable/nuwax_launcher_foreground" />
</adaptive-icon>
"""
    anydpi = res_root / "mipmap-anydpi-v26"
    anydpi.mkdir(parents=True, exist_ok=True)
    (anydpi / "ic_launcher.xml").write_text(adaptive_xml)
    (anydpi / "ic_launcher_round.xml").write_text(adaptive_xml)
    print("✓ Android 应用图标已注入 legacy/adaptive launcher 资源")


def find_debug_server_aar() -> Path | None:
    """在离线 SDK 中定位 debug-server-release.aar（HX 日志/资源同步依赖）。"""
    candidates = [
        WORK / "sdk-root" / "SDK" / "libs" / "debug-server-release.aar",
        WORK / "Android-uni-app-x-SDK@14915-5.15" / "SDK" / "libs" / "debug-server-release.aar",
        # project/app → ../../SDK/libs（官方示例相对路径）
        PROJ / ".." / "SDK" / "libs" / "debug-server-release.aar",
    ]
    for c in candidates:
        if c.is_file():
            return c.resolve()
    return None


def enable_hx_debug_channel() -> None:
    """
    按官方「原生联调」为自定义调试基座打入 HX 控制台通道：
    1) 复制 debug-server-release.aar → app/libs（主模块 fileTree 会打进包）
    2) app Manifest 写入 DCLOUD_DEBUG=true
    SDK/libs 的 fileTree 仍 exclude debug-server，避免与广告排除策略纠缠；正式包用 ENABLE_HX_DEBUG=0。
    """
    app_libs = PROJ / "app" / "libs"
    app_manifest = PROJ / "app" / "src" / "main" / "AndroidManifest.xml"
    dest_aar = app_libs / "debug-server-release.aar"

    if not ENABLE_HX_DEBUG:
        # 关闭时移除残留，避免误带进「正式向」本地包
        if dest_aar.is_file():
            dest_aar.unlink()
            print("✓ 已移除 app/libs/debug-server-release.aar（ENABLE_HX_DEBUG=0）")
        if app_manifest.is_file():
            text = app_manifest.read_text()
            text2 = re.sub(
                r'\s*<meta-data\s+android:name="DCLOUD_DEBUG"\s+android:value="[^"]*"\s*/>\s*',
                "\n",
                text,
            )
            if text2 != text:
                app_manifest.write_text(text2)
                print("✓ 已移除 app Manifest DCLOUD_DEBUG（ENABLE_HX_DEBUG=0）")
        return

    src = find_debug_server_aar()
    if src is None:
        die(
            "找不到 debug-server-release.aar（ENABLE_HX_DEBUG=1）。"
            "请确认离线 SDK 含 SDK/libs/debug-server-release.aar，或设 ENABLE_HX_DEBUG=0"
        )
    app_libs.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest_aar)
    print(f"✓ 已复制 debug-server → app/libs/ ({src})")

    if not app_manifest.is_file():
        die(f"找不到 {app_manifest}")
    text = app_manifest.read_text()
    if 'android:name="DCLOUD_DEBUG"' in text:
        text = re.sub(
            r'android:name="DCLOUD_DEBUG"\s+android:value="[^"]*"',
            'android:name="DCLOUD_DEBUG" android:value="true"',
            text,
        )
    else:
        if "</application>" not in text:
            die("app AndroidManifest 缺少 </application>，无法写入 DCLOUD_DEBUG")
        text = text.replace(
            "</application>",
            '        <!-- HX 自定义基座：控制台 log / 资源同步（正式发行请 ENABLE_HX_DEBUG=0） -->\n'
            '        <meta-data android:name="DCLOUD_DEBUG" android:value="true"/>\n'
            "    </application>",
        )
    app_manifest.write_text(text)
    print("✓ app AndroidManifest DCLOUD_DEBUG=true")


def patch_sdk_libs_excludes(gradle_path: Path) -> None:
    """官方示例 SDK/libs 含广告等可选 AAR；本地配网基座排除以免缺 HMS 资源导致 aapt 失败。
    仍 exclude debug-server：调试通道改由 app/libs 显式拷贝（见 enable_hx_debug_channel）。
    """
    if not gradle_path.is_file():
        return
    text = gradle_path.read_text()
    # 规范化 exclude 列表：广告 SDK（App 无广告）+ 未用的直播/画布/阿里人脸安全。
    excludes = [
        "'**/debug-server-release.aar'",
        "'**/beizi_fusion_sdk_*.aar'", "'**/uniad_bz_adapter_*.aar'", "'**/uniad_bz-adapter*.aar'",
        "'**/uniad-*.aar'", "'**/uni-ad-*.aar'", "'**/Baidu_MobAds_SDK.aar'", "'**/GDTSDK*.aar'",
        "'**/ks_adsdk*.aar'", "'**/Funlink_adapter_uniad*.aar'", "'**/advista-uniad*.aar'",
        "'**/mm_adapter_uniad*.aar'", "'**/open_ad_sdk*.aar'", "'**/wm_ad_sdk*.aar'", "'**/windAd.aar'",
        "'**/octopus_ad_sdk*.aar'", "'**/adalliance_adn_sdk*.aar'", "'**/Funlink_*release.aar'",
        "'**/funlink_*release.aar'", "'**/advista-*release.aar'",
        "'**/uni-live-pusher-release.aar'", "'**/uni-canvas-component-release.aar'",
        "'**/APSecuritySDK-deepSec-*.aar'", "'**/Android-AliyunFaceGuard-*.aar'", "'**/aliyun-*.aar'",
        "'**/facialRecognitionVerify-*.aar'", "'**/uni-facialVerify-*.aar'",
    ]
    # vapor 模式（5.21+）：运行时由 app/vapor-libs 提供，排除 SDK/libs 副本以免重复类。
    # VDOM 模式（如 5.15）：运行时必须从 SDK/libs 取，绝不能排除，否则断运行时。
    is_vapor = (PROJ / "app" / "vapor-libs").is_dir()
    if is_vapor:
        excludes = ["'**/app-runtime-release.aar'", "'**/uts-runtime-release.aar'"] + excludes
    new_exclude = "exclude: [" + ", ".join(excludes) + "]"
    if "**/uni-facialVerify-*.aar" in text:
        print(f"✓ SDK libs exclude 已是规范化清单(vapor={is_vapor}): {gradle_path.relative_to(PROJ)}")
        return
    text2, n = re.subn(
        r"exclude:\s*\[[^\]]*\]",
        new_exclude,
        text,
        count=1,
    )
    if n:
        gradle_path.write_text(text2)
        print(f"✓ 扩展 SDK/libs exclude（广告）: {gradle_path.relative_to(PROJ)}")
    else:
        # 无 exclude 时尝试在 fileTree( dir SDK/libs ) 后插入
        text2, n = re.subn(
            r"(fileTree\(\s*\n?\s*dir:\s*'../../SDK/libs',\s*\n?\s*include:\s*\[[^\]]+\])",
            r"\1,\n            " + new_exclude,
            text,
            count=1,
        )
        if n:
            gradle_path.write_text(text2)
            print(f"✓ 写入 SDK/libs exclude: {gradle_path.relative_to(PROJ)}")
        else:
            print(f"⚠ 未改 SDK libs exclude: {gradle_path.relative_to(PROJ)}")


def relocate_main_activity() -> None:
    """迁移 SDK 示例入口，并将其改为无界面的业务 App 跳板。"""
    java_root = PROJ / "app/src/main/java"
    template_root = java_root / "com/example/uniappx_native_package"
    new_root = java_root / Path(*BUNDLE.split("."))
    old_file = template_root / "MainActivity.kt"
    activity_file = new_root / "MainActivity.kt"

    # 包名迁移后的工作副本不再位于官方模板目录。目标文件不存在时，在 app
    # 模块中定位已有入口类，避免 Manifest 的相对类名解析到一个不存在的类。
    if not old_file.is_file() and not activity_file.is_file():
        candidates = [
            path
            for path in java_root.rglob("MainActivity.kt")
            if path != activity_file
        ]
        if len(candidates) == 1:
            old_file = candidates[0]
        elif len(candidates) > 1:
            die(f"发现多个 MainActivity，无法确定迁移来源: {candidates}")

    if old_file.is_file() and old_file != activity_file:
        new_root.mkdir(parents=True, exist_ok=True)
        text, package_count = re.subn(
            r"^package\s+[A-Za-z_][\w.]*",
            f"package {BUNDLE}",
            old_file.read_text(),
            count=1,
            flags=re.MULTILINE,
        )
        if package_count != 1:
            die(f"未能更新 {old_file} 的 package 声明")
        activity_file.write_text(text)
        old_file.unlink()
        old_root = old_file.parent
        while old_root != java_root and not any(old_root.iterdir()):
            old_root.rmdir()
            old_root = old_root.parent
        print(f"✓ MainActivity → package {BUNDLE}")
    elif not activity_file.is_file():
        die(f"未找到 SDK MainActivity，目标入口应为 {activity_file}")

    # SDK 默认 MainActivity 会显示两个「uni-app x-Native」示例按钮。它只应作为
    # 启动业务 UniAppActivity 的跳板，启动后立即结束，避免启动失败或返回时露出示例页。
    text = activity_file.read_text()
    already_redirects = (
        "UniAppXSDK.start(null, this@MainActivity)" in text and "finish()" in text
    )
    text, layout_count = re.subn(
        r"setContentView\(R\.layout\.main_activity\)",
        "UniAppXSDK.start(null, this@MainActivity)\n        finish()",
        text,
        count=1,
    )
    # 兼容已由旧脚本注入过 autoStart 的工作副本，去掉 finish() 后重复的启动调用。
    text = re.sub(
        r"(finish\(\)\s*)(?://[^\n]*\n\s*)?"
        r"UniAppXSDK\.start\(null, this@MainActivity\)\s*",
        r"\1",
        text,
        count=1,
    )
    text = re.sub(
        r"\s*findViewById<View>\(R\.id\.btn_goto\)\.setOnClickListener\s*\{.*?\n\s*}\n",
        "\n",
        text,
        count=1,
        flags=re.DOTALL,
    )
    text = re.sub(
        r"\s*findViewById<View>\(R\.id\.btn_go_view\)\.setOnClickListener\s*\{.*?\n\s*}\n",
        "\n",
        text,
        count=1,
        flags=re.DOTALL,
    )
    if layout_count != 1 and not already_redirects:
        die(f"未能改写 {activity_file} 的 SDK 示例入口")
    if "findViewById<View>(R.id.btn_" in text:
        die(f"未能移除 {activity_file} 的 SDK 示例按钮绑定")
    activity_file.write_text(text)
    print("✓ MainActivity 已改为直接启动业务 App，不显示 SDK 示例页")


def patch_gradle_properties() -> None:
    """调优 gradle.properties：抬高 JVM 堆（R8/全量构建所需）、开启并行与构建缓存。"""
    p = PROJ / "gradle.properties"
    if not p.is_file():
        return
    text = p.read_text()
    text = re.sub(
        r"org\.gradle\.jvmargs\s*=.*",
        "org.gradle.jvmargs=-Xmx8g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8",
        text,
    )
    for key in ("org.gradle.parallel", "org.gradle.caching"):
        if key in text:
            # 已存在（可能被注释）：取消注释并置 true
            text = re.sub(r"#\s*" + re.escape(key) + r"\s*=.*", f"{key}=true", text)
            text = re.sub(re.escape(key) + r"\s*=.*", f"{key}=true", text)
        else:
            text = text.rstrip() + f"\n{key}=true\n"
    p.write_text(text)
    print("✓ gradle.properties: jvmargs=-Xmx8g, parallel=true, caching=true")


def main() -> None:
    if not (PROJ / "settings.gradle").is_file():
        die(f"找不到工程 {PROJ}，请先跑 official/setup_sdk.sh")
    configure_settings()
    configure_app_gradle()
    relocate_main_activity()
    strip_project_deps(PROJ / "app" / "build.gradle")
    strip_project_deps(PROJ / "uniappx" / "build.gradle")
    strip_optional_remote_deps(PROJ / "app" / "build.gradle")
    # Release 闪退修复：LeakCanary 不得进非 debuggable 包
    confine_leakcanary_to_debug(PROJ / "app" / "build.gradle")
    confine_leakcanary_to_debug(PROJ / "uniappx" / "build.gradle")
    hide_leakcanary_launcher_entry()
    patch_sdk_libs_excludes(PROJ / "app" / "build.gradle")
    patch_sdk_libs_excludes(PROJ / "uniappx" / "build.gradle")
    patch_gradle_properties()
    configure_manifest()
    configure_app_name()
    configure_splash_screen()
    configure_launcher_icon()
    enable_hx_debug_channel()
    print("完成 configure_app")


if __name__ == "__main__":
    main()
