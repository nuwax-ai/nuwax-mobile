#!/usr/bin/env python3
"""
配置 UniAppXDemo：appid / dcloud_appkey / 签名 / 蓝牙权限文案。

敏感值通过环境变量注入，不写死进仓库：
  DCLOUD_APPKEY                 离线打包 AppKey（必填，除非 Info.plist 已有）
  IOS_DEVELOPMENT_TEAM          Apple Team ID（必填，写 scripts/local-secrets.env）
  IOS_BUNDLE_ID                 默认 com.nuwax.app
  IOS_PROVISIONING_PROFILE_UUID 描述文件 UUID（手动签名时必填）
  UNIAPPX_SDK_ROOT              Demo 所在 SDK 根目录
  UNIAPPX_APPID                 默认 __UNI__8BF05E4
  UNIAPPX_IPATYPE               1=自定义基座(HX 联调) 2=正式包；默认 1
"""
from __future__ import annotations

import json
import os
import plistlib
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_base_paths import default_uniappx_ios_sdk

DEFAULT_SDK = default_uniappx_ios_sdk()
# 本地离线基座必须自带的隐私声明兜底值（manifest.json 缺失时使用）。
# 缺 NSBluetoothAlwaysUsageDescription 时 iOS 不弹授权框、也不解析 CBCentralManager 状态，
# state 永远停在 .unknown(0)，centralManagerDidUpdateState 一次都不回调 → BLE 扫描根本起不来。
REQUIRED_PRIVACY_FALLBACK = {
    "NSBluetoothAlwaysUsageDescription": "用于通过蓝牙为桌搭设备配网（连接 Wi-Fi）",
    "NSBluetoothPeripheralUsageDescription": "用于通过蓝牙为桌搭设备配网（连接 Wi-Fi）",
}

# pbxproj 的 INFOPLIST_KEY_* 仅在 GENERATE_INFOPLIST_FILE=YES 时生效；本 Demo 用显式
# INFOPLIST_FILE，所以这两键只是保险，真正起作用的是上面写进 Info.plist 的隐私声明。
BLE_ALWAYS = REQUIRED_PRIVACY_FALLBACK["NSBluetoothAlwaysUsageDescription"]
BLE_PERIPH = REQUIRED_PRIVACY_FALLBACK["NSBluetoothPeripheralUsageDescription"]


def _strip_jsonc(text: str) -> str:
    """manifest.json 是 jsonc（带 // 注释），json 模块不认。按行剥掉行注释。"""
    out = []
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("//"):
            continue
        out.append(line)
    return "\n".join(out)


def read_manifest_privacy(main_root: Path) -> dict:
    """读 manifest.json 的 app-plus.distribute.ios.privacyDescription。

    云打包由 DCloud 服务端把这些键写进 Info.plist；本地离线基座没有这一步，
    Info.plist 直接沿用 UniAppXDemo 示例工程的默认值（只有相机/麦克风/相册）。
    所以这里必须补，且以 manifest.json 为唯一事实源，避免两条打包路径权限文案漂移。
    """
    manifest = main_root / "manifest.json"
    result = dict(REQUIRED_PRIVACY_FALLBACK)
    try:
        raw = json.loads(_strip_jsonc(manifest.read_text(encoding="utf-8")))
    except Exception as exc:  # noqa: BLE001 - 读不到就用兜底，不阻断打包
        print(f"ℹ 未能解析 {manifest}（{exc}），隐私声明使用兜底值")
        return result
    # uni-app x 的正解路径是 app-ios.distribute.privacyDescription（HBuilderX manifest 界面写这里，
    # 云打包也只读这里）；app-plus.distribute.ios.privacyDescription 是 uni-app(vue) 旧路径，
    # 仅作兼容兜底先读，再被新路径覆盖，保证本地基座与云打包 Info.plist 同源。
    legacy = (
        raw.get("app-plus", {})
        .get("distribute", {})
        .get("ios", {})
        .get("privacyDescription", {})
    )
    current = raw.get("app-ios", {}).get("distribute", {}).get("privacyDescription", {})
    for source in (legacy, current):
        if isinstance(source, dict):
            result.update({k: v for k, v in source.items() if isinstance(v, str) and v})
    return result


def patch_info_plist(
    path: str, appid: str, appkey: str | None, ipatype: int, privacy: dict
) -> None:
    with open(path, "rb") as f:
        data = plistlib.load(f)
    uni = data.get("uniapp-x")
    if not isinstance(uni, dict):
        uni = {}
        data["uniapp-x"] = uni
    uni["appid"] = appid
    uni["uniRuntimeVersion"] = uni.get("uniRuntimeVersion") or "5.23"
    # 官方文档：1=自定义基座(HX 调试) 2=正式包
    # https://doc.dcloud.net.cn/uni-app-x/native/use/ios.html
    uni["ipatype"] = ipatype
    if appkey:
        uni["dcloud_appkey"] = appkey
    elif not uni.get("dcloud_appkey"):
        raise SystemExit(
            "✗ 未设置 DCLOUD_APPKEY，且 Info.plist 中无 dcloud_appkey。"
            "请到 https://dev.dcloud.net.cn 为 appid 申请离线 AppKey。"
        )
    # 隐私声明：manifest.json 为准，覆盖 UniAppXDemo 示例工程的默认文案
    added = []
    for key, desc in sorted(privacy.items()):
        if data.get(key) != desc:
            added.append(key)
        data[key] = desc
    missing = [k for k in REQUIRED_PRIVACY_FALLBACK if not data.get(k)]
    if missing:
        raise SystemExit(f"✗ Info.plist 缺少必需的隐私声明：{', '.join(missing)}")
    with open(path, "wb") as f:
        plistlib.dump(data, f, sort_keys=False)
    print(f"✓ Info.plist appid={appid} ipatype={ipatype} dcloud_appkey=***")
    print(f"✓ Info.plist 隐私声明 {len(privacy)} 项（更新 {len(added)} 项）：{', '.join(sorted(privacy))}")


# UniAppXDemo 示例工程默认开了 Sign In with Apple，但本项目没用到
# （manifest.json 的 oauth 为空、modules 只有 Record/Camera/Gallery/File），
# 而 NuwaxAppProfile 描述文件也没申请该能力 → xcodebuild 直接报
# "doesn't include the com.apple.developer.applesignin entitlement" 失败。
# 这里按能力白名单剥掉示例残留，保持与描述文件一致。
UNUSED_ENTITLEMENTS = ("com.apple.developer.applesignin",)


def patch_entitlements(sdk: str) -> None:
    root = Path(sdk) / "UniAppXDemo"
    files = sorted(root.rglob("*.entitlements"))
    if not files:
        print("ℹ 未找到 .entitlements，跳过")
        return
    for f in files:
        with open(f, "rb") as fh:
            data = plistlib.load(fh)
        removed = [k for k in UNUSED_ENTITLEMENTS if k in data]
        if not removed:
            continue
        for k in removed:
            del data[k]
        with open(f, "wb") as fh:
            plistlib.dump(data, fh, sort_keys=False)
        print(f"✓ entitlements 移除 {', '.join(removed)} → {f.name}")


def patch_pbxproj(
    path: str,
    team: str,
    bundle_id: str,
    profile_uuid: str | None,
) -> None:
    src = open(path, encoding="utf-8").read()
    # 仅改 app target 常见键；幂等替换
    replacements = {
        r"PRODUCT_BUNDLE_IDENTIFIER = [^;]+;": f"PRODUCT_BUNDLE_IDENTIFIER = {bundle_id};",
        r"DEVELOPMENT_TEAM = [^;]+;": f"DEVELOPMENT_TEAM = {team};",
        r'INFOPLIST_KEY_NSBluetoothAlwaysUsageDescription = "[^"]*";':
            f'INFOPLIST_KEY_NSBluetoothAlwaysUsageDescription = "{BLE_ALWAYS}";',
        r'INFOPLIST_KEY_NSBluetoothPeripheralUsageDescription = "[^"]*";':
            f'INFOPLIST_KEY_NSBluetoothPeripheralUsageDescription = "{BLE_PERIPH}";',
    }
    out = src
    for pat, repl in replacements.items():
        out, n = re.subn(pat, repl, out)
        if n == 0 and "Bluetooth" in pat:
            # 原工程可能没有这两键，在 CODE_SIGN_STYLE 后插入（Debug/Release 各一次）
            pass

    if profile_uuid:
        if "PROVISIONING_PROFILE_SPECIFIER" in out:
            out = re.sub(
                r"PROVISIONING_PROFILE_SPECIFIER = [^;]+;",
                f"PROVISIONING_PROFILE_SPECIFIER = {profile_uuid};",
                out,
            )
        else:
            out = out.replace(
                f"DEVELOPMENT_TEAM = {team};",
                f"DEVELOPMENT_TEAM = {team};\n\t\t\t\tPROVISIONING_PROFILE_SPECIFIER = {profile_uuid};",
            )
        # 手动签名
        out = re.sub(r"CODE_SIGN_STYLE = Automatic;", "CODE_SIGN_STYLE = Manual;", out)

    # 若无蓝牙文案键，在每个 DEVELOPMENT_TEAM 块附近补（简单：全局确保至少有 build setting）
    if "INFOPLIST_KEY_NSBluetoothAlwaysUsageDescription" not in out:
        out = out.replace(
            f"DEVELOPMENT_TEAM = {team};",
            f"DEVELOPMENT_TEAM = {team};\n"
            f'\t\t\t\tINFOPLIST_KEY_NSBluetoothAlwaysUsageDescription = "{BLE_ALWAYS}";\n'
            f'\t\t\t\tINFOPLIST_KEY_NSBluetoothPeripheralUsageDescription = "{BLE_PERIPH}";',
        )

    with open(path, "w", encoding="utf-8") as f:
        f.write(out)
    print(f"✓ pbxproj bundle={bundle_id} team={team} profile={profile_uuid or '(unchanged)'}")


def main() -> int:
    sdk = os.path.expanduser(os.environ.get("UNIAPPX_SDK_ROOT", DEFAULT_SDK))
    appid = os.environ.get("UNIAPPX_APPID", "__UNI__8BF05E4")
    appkey = os.environ.get("DCLOUD_APPKEY") or None
    team = os.environ.get("IOS_DEVELOPMENT_TEAM")
    bundle_id = os.environ.get("IOS_BUNDLE_ID", "com.nuwax.app")
    profile = os.environ.get("IOS_PROVISIONING_PROFILE_UUID") or None
    # 默认 1：HX「运行到自定义基座」；发版离线包再设 UNIAPPX_IPATYPE=2
    ipatype = int(os.environ.get("UNIAPPX_IPATYPE", "1"))

    info = os.path.join(sdk, "UniAppXDemo", "UniAppXDemo", "Info.plist")
    pbx = os.path.join(sdk, "UniAppXDemo", "UniAppXDemo.xcodeproj", "project.pbxproj")
    if not os.path.isfile(info) or not os.path.isfile(pbx):
        print(f"✗ Demo 不完整：{sdk}/UniAppXDemo", file=sys.stderr)
        return 1

    # 敏感值一律走环境变量（scripts/local-secrets.env，gitignore），不再硬编码或从本机 backup 猜。
    if not team:
        raise SystemExit("✗ 未设置 IOS_DEVELOPMENT_TEAM（写到 scripts/local-secrets.env）")
    if not profile:
        print("ℹ 未设置 IOS_PROVISIONING_PROFILE_UUID → pbxproj 不写 profile（走自动签名）")

    main_root = Path(os.environ.get("NUWAX_MAIN_ROOT") or Path(__file__).resolve().parents[2])
    patch_info_plist(info, appid, appkey, ipatype, read_manifest_privacy(main_root))
    patch_entitlements(sdk)
    patch_pbxproj(pbx, team, bundle_id, profile)
    print("完成。请用 Xcode 打开 UniAppXDemo.xcodeproj 真机 Run。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
