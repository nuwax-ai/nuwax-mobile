#!/usr/bin/env python3
"""
配置 Android 离线宿主（官方 uniappxnativepackage）：
- applicationId / namespace = com.nuwax.nuwa
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
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_base_paths import default_android_esp_work

WORK = Path(os.environ.get("ANDROID_ESP_WORK", default_android_esp_work()))
PROJ = WORK / "project"
APPID = os.environ.get("APPID", "__UNI__8BF05E4")
BUNDLE = os.environ.get("ANDROID_BUNDLE_ID", "com.nuwax.nuwa")
APPKEY = os.environ.get("DCLOUD_APPKEY")
if not APPKEY:
    raise SystemExit("✗ 未设置 DCLOUD_APPKEY（写到 scripts/local-secrets.env，已 gitignore）")
# 是否为 HBuilderX 自定义基座打入调试通道（debug-server + DCLOUD_DEBUG）。
# 默认开启；正式发行包请设 ENABLE_HX_DEBUG=0，否则可能提示「正在加载调试框架」。
ENABLE_HX_DEBUG = os.environ.get("ENABLE_HX_DEBUG", "1") != "0"
# 本机若未装 platforms;android-36 / build-tools;35，可降到已安装的 34（官方示例默认常为 36）
# 官方示例默认 compileSdk 36；本机需已装 platforms;android-36
COMPILE_SDK = int(os.environ.get("ANDROID_COMPILE_SDK", "36"))
TARGET_SDK = int(os.environ.get("ANDROID_TARGET_SDK", str(COMPILE_SDK)))

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


def ensure_release_uses_debug_signing(text: str) -> tuple[str, bool]:
    """
    内测 Release 包：debuggable=false、无 HX debug-server，但用 debug keystore 签名，
    以便 assembleRelease 无需正式证书即可安装。上架请另配正式 signingConfig。
    """
    changed = False
    # 已配置则跳过，避免重复插入
    if re.search(
        r"buildTypes\s*\{[^}]*release\s*\{[^}]*signingConfig\s+signingConfigs\.debug",
        text,
        flags=re.DOTALL,
    ):
        return text, False

    def _inject_signing(m: re.Match[str]) -> str:
        nonlocal changed
        block = m.group(0)
        if "signingConfig" in block:
            return block
        changed = True
        # 插在 release { 后第一行，保持原缩进风格
        return re.sub(
            r"(release\s*\{\s*\n)",
            r"\1            signingConfig signingConfigs.debug\n",
            block,
            count=1,
        )

    text2 = re.sub(
        r"release\s*\{[^{}]*\}",
        _inject_signing,
        text,
        count=1,
    )
    return text2, changed


def configure_app_gradle() -> None:
    p = PROJ / "app" / "build.gradle"
    text = p.read_text()
    text = text.replace(
        "namespace 'com.example.uniappx_native_package'",
        f"namespace '{BUNDLE}'",
    )
    text = text.replace(
        'applicationId "com.example.uniappx_native_package"',
        f'applicationId "{BUNDLE}"',
    )
    # minSdk 至少 26（ESP 插件要求）
    text = re.sub(r"minSdk\s+\d+", "minSdk 26", text, count=1)
    # compileSdk / targetSdk：对齐本机已安装 platform
    text = re.sub(r"compileSdk\s+\d+", f"compileSdk {COMPILE_SDK}", text, count=1)
    text = re.sub(r"targetSdk\s+\d+", f"targetSdk {TARGET_SDK}", text, count=1)
    text, signed = ensure_release_uses_debug_signing(text)
    p.write_text(text)
    print(
        f"✓ app applicationId/namespace={BUNDLE} "
        f"minSdk=26 compileSdk={COMPILE_SDK} targetSdk={TARGET_SDK}"
    )
    if signed:
        print("✓ release 使用 signingConfigs.debug（内测 assembleRelease 可装）")


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
    p.write_text(text)
    print(f"✓ uniappx AndroidManifest appid={APPID} dcloud_appkey=***")


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
    # 扩展 exclude 列表（保留 beizi；debug-server 仍从 SDK/libs 排除，改走 app/libs）
    new_exclude = (
        "exclude: ["
        "'**/beizi_fusion_sdk_*.aar', "
        "'**/uniad_bz_adapter_*.aar', "
        "'**/uniad_bz-adapter*.aar', "
        "'**/debug-server-release.aar', "
        "'**/uniad-*.aar', "
        "'**/uni-ad-*.aar', "
        "'**/Baidu_MobAds_SDK.aar', "
        "'**/GDTSDK*.aar', "
        "'**/ks_adsdk*.aar', "
        "'**/Funlink_adapter_uniad*.aar', "
        "'**/advista-uniad*.aar', "
        "'**/mm_adapter_uniad*.aar'"
        "]"
    )
    if "**/uniad-*.aar" in text:
        print(f"✓ SDK libs exclude 已含广告排除: {gradle_path.relative_to(PROJ)}")
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
    old_root = PROJ / "app/src/main/java/com/example/uniappx_native_package"
    new_root = PROJ / "app/src/main/java" / Path(*BUNDLE.split("."))
    old_file = old_root / "MainActivity.kt"
    activity_file = new_root / "MainActivity.kt"

    if old_file.is_file():
        new_root.mkdir(parents=True, exist_ok=True)
        text = old_file.read_text().replace(
            "package com.example.uniappx_native_package", f"package {BUNDLE}"
        )
        activity_file.write_text(text)
        shutil.rmtree(old_root)
        print(f"✓ MainActivity → package {BUNDLE}")
    elif not activity_file.is_file():
        print("⚠ 未找到 SDK MainActivity，跳过入口页处理")
        return

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
    patch_sdk_libs_excludes(PROJ / "app" / "build.gradle")
    patch_sdk_libs_excludes(PROJ / "uniappx" / "build.gradle")
    configure_manifest()
    enable_hx_debug_channel()
    print("完成 configure_app")


if __name__ == "__main__":
    main()
