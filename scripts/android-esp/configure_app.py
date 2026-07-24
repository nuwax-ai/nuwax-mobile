#!/usr/bin/env python3
"""
配置 Android 离线宿主（官方 uniappxnativepackage）：
- applicationId / namespace = com.nuwax.nuwa
- DCLOUD_UNI_APPID = __UNI__8BF05E4
- dcloud_appkey
- 从 settings / app / uniappx 去掉示例 UTS 模块依赖，只保留 uniappx + 我们的插件
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
APPKEY = os.environ.get(
    "DCLOUD_APPKEY",
    "02c109ded799bad828c3183534b330e3",  # 与 iOS 离线 AppKey 同源
)
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
    p.write_text(text)
    print(
        f"✓ app applicationId/namespace={BUNDLE} "
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
    p.write_text(text)
    print(f"✓ uniappx AndroidManifest appid={APPID} dcloud_appkey=***")


def patch_sdk_libs_excludes(gradle_path: Path) -> None:
    """官方示例 SDK/libs 含广告等可选 AAR；本地配网基座排除以免缺 HMS 资源导致 aapt 失败。"""
    if not gradle_path.is_file():
        return
    text = gradle_path.read_text()
    # 扩展 exclude 列表（保留原有 beizi / debug-server）
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
    """applicationId/namespace 改为 com.nuwax.nuwa 后，示例 MainActivity 包名必须同步，否则 R 类解析失败。"""
    old_root = PROJ / "app/src/main/java/com/example/uniappx_native_package"
    new_root = PROJ / "app/src/main/java" / Path(*BUNDLE.split("."))
    old_file = old_root / "MainActivity.kt"
    if not old_file.is_file():
        # 已迁移
        if (new_root / "MainActivity.kt").is_file():
            print("✓ MainActivity 包名已是", BUNDLE)
        return
    new_root.mkdir(parents=True, exist_ok=True)
    text = old_file.read_text()
    text = text.replace(
        "package com.example.uniappx_native_package",
        f"package {BUNDLE}",
    )
    # 自定义基座：启动即进入 uni-app（官方 UniAppActivity），保留按钮作调试兜底
    if "UniAppXSDK.start(null" in text and "autoStart" not in text:
        text = text.replace(
            "setContentView(R.layout.main_activity)",
            "setContentView(R.layout.main_activity)\n"
            "        // autoStart: 自定义基座默认直接进入业务 App\n"
            "        UniAppXSDK.start(null, this@MainActivity)",
        )
    (new_root / "MainActivity.kt").write_text(text)
    shutil.rmtree(old_root)
    print(f"✓ MainActivity → package {BUNDLE}")


def main() -> None:
    if not (PROJ / "settings.gradle").is_file():
        die(f"找不到工程 {PROJ}，请先跑 official/setup_sdk.sh")
    configure_settings()
    configure_app_gradle()
    relocate_main_activity()
    strip_project_deps(PROJ / "app" / "build.gradle")
    strip_project_deps(PROJ / "uniappx" / "build.gradle")
    strip_optional_remote_deps(PROJ / "app" / "build.gradle")
    patch_sdk_libs_excludes(PROJ / "app" / "build.gradle")
    patch_sdk_libs_excludes(PROJ / "uniappx" / "build.gradle")
    configure_manifest()
    print("完成 configure_app")


if __name__ == "__main__":
    main()
