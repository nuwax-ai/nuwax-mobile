#!/usr/bin/env python3
"""对照 www/manifest.json 的 app-ios.distribute.modules，校验 ExtAPI 二进制是否含关键符号。"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

# 模块名 → 用于 strings 探测的关键词（启发式，非 ABI 保证）
HINTS = {
    "uni-storage": ["uni-storage", "UTSStorage", "SetStorageSuccess"],
    "uni-getSystemInfo": ["uni-getSystemInfo", "GetSystemInfoResult"],
    "uni-barcode-scanning": ["BarcodeScanning", "FrameScanner"],
    "uni-scanCode": ["uni-scanCode", "ScanCode"],
    "uni-network": ["uni-network"],
    "uni-prompt": ["uni-prompt"],
    "uni-event": ["uni-event", "UniEvent", "event-native", "UTSSDKModulesDCloudUniEvent"],
    "uni-web-view": ["uni-web-view", "InnerWebView"],
    "uni-media": ["uni-media"],
    "uni-clipboard": ["uni-clipboard"],
    "uni-fileSystemManager": ["uni-fileSystemManager", "FileSystemManager"],
    "uni-recorder": ["uni-recorder"],
    "uni-websocket": ["uni-websocket"],
    "uni-secure-network": ["uni-secure-network"],
    "uni-previewImage": ["uni-previewImage"],
    "uni-keyboard": ["uni-keyboard"],
    "uni-createInnerAudioContext": ["uni-createInnerAudioContext", "InnerAudio"],
    "uni-showLoading": ["uni-showLoading"],
    "uni-getElementById": ["uni-getElementById", "GetElementById", "DCUniGetElementById"],
    "uni-getAppAuthorizeSetting": ["uni-getAppAuthorizeSetting"],
    "uni-openAppAuthorizeSetting": ["uni-openAppAuthorizeSetting"],
    "uni-getAppBaseInfo": ["uni-getAppBaseInfo"],
    "uni-getDeviceInfo": ["uni-getDeviceInfo"],
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", required=True)
    ap.add_argument("--extapi-binary", required=True)
    args = ap.parse_args()

    manifest = json.loads(Path(args.manifest).read_text())
    modules = list(
        (
            ((manifest.get("app-ios") or {}).get("distribute") or {}).get("modules") or {}
        ).keys()
    )
    if not modules:
        print("⚠ manifest 无 modules")
        return 0

    binary = Path(args.extapi_binary)
    if not binary.is_file():
        print(f"✗ ExtAPI 二进制不存在: {binary}", file=sys.stderr)
        return 1

    raw = subprocess.check_output(["strings", str(binary)], stderr=subprocess.DEVNULL)
    text = raw.decode("utf-8", errors="ignore")

    ok = 0
    miss = 0
    skip = 0
    print(f"校验 ExtAPI vs {len(modules)} 个 manifest 模块：")
    for m in sorted(modules):
        hints = HINTS.get(m)
        if not hints:
            print(f"  · {m}: (无探测关键词，跳过)")
            skip += 1
            continue
        if any(h in text for h in hints):
            print(f"  ✓ {m}")
            ok += 1
        else:
            print(f"  ✗ {m}  未命中 {hints}")
            miss += 1

    print(f"汇总: ok={ok} miss={miss} skip={skip}")
    # 启发式校验：仅告警，不阻断流水线（ExtAPI 预置包可能用不同符号名）
    if miss:
        print("⚠ 部分模块未命中探测关键词（请人工确认，不作为硬失败）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
