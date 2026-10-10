#!/usr/bin/env python3
"""
把 ESP 配网相关 xcframework 注入 UniAppXDemo 主工程（Link + Embed&Sign + Frameworks 组）。

环境变量（均可选，有默认值）：
  UNIAPPX_DEMO_PBXPROJ  UniAppXDemo.xcodeproj/project.pbxproj 绝对路径
  UNIAPPX_SDK_LIBS_REL  相对 pbxproj 的 Libs 路径前缀（默认 ../SDK/Libs）

修复点（相对 2026-07-24 backup）：
  原先生成了 Embed 的 PBXBuildFile 行（fw_embed）但从未写入 PBXBuildFile section，
  只在 Embed Frameworks phase 的 files 列表里引用了 ID → Xcode 链接残缺。
"""
from __future__ import annotations

import hashlib
import os
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_base_paths import default_demo_pbx

DEFAULT_PBX = default_demo_pbx()

FW = ["SwiftProtobuf", "ESPProvision", "unimoduleNuwaxEspProvisioning"]


def fid(name: str, kind: str) -> str:
    """24-hex 确定性 ID（C0FFEE 前缀便于在 pbxproj 中识别）。"""
    return ("C0FFEE" + hashlib.md5((name + kind).encode()).hexdigest().upper())[:24]


def main() -> int:
    pbx_path = os.environ.get("UNIAPPX_DEMO_PBXPROJ", DEFAULT_PBX)
    libs_rel = os.environ.get("UNIAPPX_SDK_LIBS_REL", "../SDK/Libs")

    if not os.path.isfile(pbx_path):
        print(f"✗ 找不到 pbxproj: {pbx_path}", file=sys.stderr)
        print("  请先解压 UniAppX-iOS@5.15，或设置 UNIAPPX_DEMO_PBXPROJ", file=sys.stderr)
        return 1

    src = open(pbx_path, encoding="utf-8").read()

    # 幂等：若已注入过 fileref，直接退出
    if fid(FW[0], "fileref") in src:
        print("✓ 已注入过（检测到 C0FFEE fileref），跳过")
        return 0

    fileref_lines: list[str] = []
    fw_link: list[str] = []
    fw_embed: list[str] = []
    group_lines: list[str] = []

    for n in FW:
        fr = fid(n, "fileref")
        bflink = fid(n, "link")
        bfembed = fid(n, "embed")
        fileref_lines.append(
            f"\t\t{fr} /* {n}.xcframework */ = {{isa = PBXFileReference; "
            f"lastKnownFileType = wrapper.xcframework; name = {n}.xcframework; "
            f'path = {libs_rel}/{n}.xcframework; sourceTree = "<group>"; }};'
        )
        fw_link.append(
            f"\t\t{bflink} /* {n}.xcframework in Frameworks */ = "
            f"{{isa = PBXBuildFile; fileRef = {fr} /* {n}.xcframework */; }};"
        )
        # Embed 必须带 CodeSignOnCopy，否则真机动态库无法加载
        fw_embed.append(
            f"\t\t{bfembed} /* {n}.xcframework in Embed Frameworks */ = "
            f"{{isa = PBXBuildFile; fileRef = {fr} /* {n}.xcframework */; "
            f"settings = {{ATTRIBUTES = (CodeSignOnCopy, RemoveHeadersOnCopy, ); }}; }};"
        )
        group_lines.append(f"\t\t\t\t{fr} /* {n}.xcframework */,")

    anchor_ref = "DCloudUTSFoundation.xcframework */ = {isa = PBXFileReference"
    anchor_link = "DCloudUTSFoundation.xcframework in Frameworks */ = {isa = PBXBuildFile"
    anchor_embed_member = "DCloudUTSFoundation.xcframework in Embed Frameworks */,"

    out: list[str] = []
    for line in src.split("\n"):
        out.append(line)
        if anchor_ref in line:
            out.extend(fileref_lines)
        elif anchor_link in line:
            # 关键修复：同时写入 Link 与 Embed 的 PBXBuildFile 定义
            out.extend(fw_link)
            out.extend(fw_embed)
        elif anchor_embed_member in line:
            for n in FW:
                out.append(
                    f"\t\t\t\t{fid(n, 'embed')} /* {n}.xcframework in Embed Frameworks */,"
                )

    src2 = "\n".join(out)

    # Frameworks 组成员
    lines = src2.split("\n")
    res: list[str] = []
    for line in lines:
        res.append(line)
        if re.search(r"/\* DCloudUTSFoundation\.xcframework \*/,\s*$", line):
            res.extend(group_lines)
    src3 = "\n".join(res)

    # Frameworks 链接阶段 files 成员
    lines = src3.split("\n")
    res = []
    for line in lines:
        res.append(line)
        if re.search(r"/\* DCloudUTSFoundation\.xcframework in Frameworks \*/,\s*$", line):
            for n in FW:
                res.append(
                    f"\t\t\t\t{fid(n, 'link')} /* {n}.xcframework in Frameworks */,"
                )
    src4 = "\n".join(res)

    with open(pbx_path, "w", encoding="utf-8") as f:
        f.write(src4)

    print(f"✓ 注入完成 → {pbx_path}")
    for n in FW:
        for kind in ["fileref", "link", "embed"]:
            print(f"  {n} {kind}: {fid(n, kind)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
