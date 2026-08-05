#!/usr/bin/env python3
"""切换 HBuilderX 已导出的 Android appResource API 环境。

5.23 蒸汽（vapor/bytecode）模式：业务代码编译为 __UNI__<appid>/www/app-service.js，
API_BASE_URL 就内联在该 JS 里（不再是旧版 uniappx/app-android/src/index.kt）。
本脚本在 app-service.js 中做端点替换，并保证结果只含目标环境地址。
"""
from __future__ import annotations

import argparse
from pathlib import Path


ENDPOINTS = {
    "test": "https://testagent.xspaceagi.com",
    "production": "https://agent.nuwax.com",
}


def find_service_js(resources_dir: Path) -> Path:
    """定位 app-service.js：__UNI__*/www/app-service.js（蒸汽模式业务产物）。"""
    # 优先精确匹配常见 appid 目录
    for app_dir in sorted(resources_dir.glob("__UNI__*")):
        candidate = app_dir / "www" / "app-service.js"
        if candidate.is_file():
            return candidate
    # 兜底：全资源目录搜
    matches = sorted(resources_dir.rglob("app-service.js"))
    if matches:
        return matches[0]
    raise SystemExit(f"✗ 找不到 app-service.js（vapor 业务产物）: {resources_dir}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", choices=ENDPOINTS)
    parser.add_argument("resources_dir", type=Path)
    args = parser.parse_args()

    source = find_service_js(args.resources_dir)

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
    print(f"✓ Android appResource API 环境={args.environment}: {expected} ({source.name})")


if __name__ == "__main__":
    main()
