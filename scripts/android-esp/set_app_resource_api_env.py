#!/usr/bin/env python3
"""切换 HBuilderX 已导出的 Android appResource API 环境。"""
from __future__ import annotations

import argparse
from pathlib import Path


ENDPOINTS = {
    "test": "https://testagent.xspaceagi.com",
    "production": "https://agent.nuwax.com",
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=ENDPOINTS)
    parser.add_argument("resources_dir", type=Path)
    args = parser.parse_args()

    source = (
        args.resources_dir
        / "uniappx"
        / "app-android"
        / "src"
        / "index.kt"
    )
    if not source.is_file():
        raise SystemExit(f"✗ 找不到 Android appResource 源码: {source}")

    text = source.read_text()
    known_count = sum(text.count(endpoint) for endpoint in ENDPOINTS.values())
    if known_count == 0:
        raise SystemExit("✗ appResource 中未找到已知 API 地址，拒绝生成环境不明的 APK")

    expected = ENDPOINTS[args.environment]
    for endpoint in ENDPOINTS.values():
        text = text.replace(endpoint, expected)
    source.write_text(text)

    if expected not in text:
        raise SystemExit(f"✗ appResource API 环境写入失败: {expected}")
    unexpected = [
        endpoint
        for name, endpoint in ENDPOINTS.items()
        if name != args.environment and endpoint in text
    ]
    if unexpected:
        raise SystemExit(f"✗ appResource 仍包含非目标 API 地址: {unexpected}")
    print(f"✓ Android appResource API 环境={args.environment}: {expected}")


if __name__ == "__main__":
    main()
