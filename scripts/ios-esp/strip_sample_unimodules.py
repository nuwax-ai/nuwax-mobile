#!/usr/bin/env python3
"""
从 UniAppXDemo.pbxproj 去掉示例 unimodule*.framework 引用，
保留 unimoduleNuwaxEspProvisioning（ESP 配网插件）。

环境变量：UNIAPPX_DEMO_PBXPROJ
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_base_paths import default_demo_pbx

DEFAULT_PBX = default_demo_pbx()

KEEP = "unimoduleNuwaxEspProvisioning"
# 匹配示例 unimoduleXxx.framework（不含我们的 Nuwax 插件）
SAMPLE_RE = re.compile(r"unimodule(?!NuwaxEspProvisioning)[A-Za-z0-9]+\.framework")


def main() -> int:
    path = os.environ.get("UNIAPPX_DEMO_PBXPROJ", DEFAULT_PBX)
    if not os.path.isfile(path):
        print(f"✗ 找不到 {path}", file=sys.stderr)
        return 1
    lines = open(path, encoding="utf-8").read().splitlines(True)
    kept: list[str] = []
    removed = 0
    for line in lines:
        if SAMPLE_RE.search(line):
            removed += 1
            continue
        kept.append(line)
    with open(path, "w", encoding="utf-8") as f:
        f.writelines(kept)
    print(f"✓ 已移除 {removed} 行示例 unimodule 引用（保留 {KEEP}）→ {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
