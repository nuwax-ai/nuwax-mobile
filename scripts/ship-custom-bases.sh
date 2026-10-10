#!/usr/bin/env bash
# 维护者一键流水线：生成本地打包 App 资源 → 打自定义基座 → 上传 S3
#
# 对应 make 目标：base-ship（不改变 base-all「仅出包」语义）
#
# 步骤：
#   ① HBuilderX CLI：publish app --type appResource
#      （等价菜单：发行 → 原生App-本地打包 → 生成本地打包App资源）
#   ② package-custom-bases.sh：Android + iOS 真机 + iOS 模拟器 → unpackage/debug/
#   ③ publish-custom-base-s3.sh：上传并更新 latest / channels/debug
#
# 前置：
#   - HBuilderX 已启动，且本项目已导入
#   - 离线 SDK / work 目录就绪（见 scripts/local-base-env.sh）
#   - 发 S3 需 NUWAX_S3_* 或 ~/.aws（SKIP_PUBLISH=1 时可跳过）
#
# 环境变量：
#   SKIP_APP_RESOURCE=1  跳过 ①（本地资源已生成且未改业务/插件时）
#   SKIP_PUBLISH=1       跳过 ③（只本地出包，不上 S3）
#   TARGETS=…            传给出包脚本，默认 all（android,ios-device,ios-simulator）
#   HX_CLI / HX_PROJECT  覆盖 HBuilderX CLI 路径与项目（默认本仓绝对路径）
#
# 用法：
#   bash scripts/ship-custom-bases.sh
#   SKIP_APP_RESOURCE=1 bash scripts/ship-custom-bases.sh   # 跳过资源生成
#   SKIP_PUBLISH=1 bash scripts/ship-custom-bases.sh        # 只出包不上传
#   TARGETS=android bash scripts/ship-custom-bases.sh       # 只打 Android
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

SKIP_APP_RESOURCE="${SKIP_APP_RESOURCE:-0}"
SKIP_PUBLISH="${SKIP_PUBLISH:-0}"
TARGETS="${TARGETS:-all}"

echo "======== base-ship：自定义基座一键发布 ========"
echo "ROOT=$ROOT_DIR"
echo "TARGETS=$TARGETS"
echo "SKIP_APP_RESOURCE=$SKIP_APP_RESOURCE"
echo "SKIP_PUBLISH=$SKIP_PUBLISH"
echo ""

# ---------- ① 生成本地打包 App 资源 ----------
if [[ "$SKIP_APP_RESOURCE" == "1" ]]; then
  echo "######## [1/3] 跳过 appResource（SKIP_APP_RESOURCE=1）########"
else
  echo "######## [1/3] HX CLI：生成本地打包 App 资源 ########"
  echo "提示：需 HBuilderX 主程序已打开，且项目已导入。"
  # --platform APP + --type appResource：写出 unpackage/resources/app-android|app-ios
  bash "$SCRIPT_DIR/hx-cli.sh" publish app \
    --platform APP \
    --type appResource \
    --project "$ROOT_DIR"
  echo ""
fi

# ---------- ② 打三端（或 TARGETS 裁剪）自定义基座 ----------
echo "######## [2/3] 出包 → unpackage/debug/ ########"
TARGETS="$TARGETS" bash "$SCRIPT_DIR/package-custom-bases.sh"
echo ""

# ---------- ③ 上传 S3 ----------
if [[ "$SKIP_PUBLISH" == "1" ]]; then
  echo "######## [3/3] 跳过 S3 上传（SKIP_PUBLISH=1）########"
else
  echo "######## [3/3] 上传 S3（更新 latest）########"
  # 将 TARGETS=all 映射为 publish 脚本识别的平台列表；单平台则原样传递
  publish_targets="android,ios-device,ios-simulator"
  if [[ "$TARGETS" != "all" ]]; then
    publish_targets="$TARGETS"
  fi
  bash "$SCRIPT_DIR/publish-custom-base-s3.sh" --targets "$publish_targets"
fi

echo ""
echo "======== base-ship 完成 ========"
echo "本地产物: $ROOT_DIR/unpackage/debug/"
if [[ "$SKIP_PUBLISH" != "1" ]]; then
  echo "同事拉取: make base-fetch  （或不指定版本拉最新）"
fi
