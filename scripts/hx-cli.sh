#!/usr/bin/env bash
# HBuilderX CLI 薄封装：统一路径与项目名，供 package.json scripts / make 调用。
#
# 用法：bash scripts/hx-cli.sh <cli 原生子命令…>
# 例： bash scripts/hx-cli.sh devices list
#      bash scripts/hx-cli.sh launch app-android --project nuwax-mobile
#      bash scripts/hx-cli.sh publish app --type appResource
#
# 环境变量：
#   HX_CLI      CLI 可执行文件（默认 /Applications/HBuilderX.app/Contents/MacOS/cli）
#   HX_PROJECT  项目名或绝对路径（默认：本仓绝对路径；launch/logcat 也可用项目名 nuwax-mobile）
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

CLI="${HX_CLI:-/Applications/HBuilderX.app/Contents/MacOS/cli}"
# publish appResource 官方更推荐绝对路径；launch/logcat 用已导入项目名亦可
PROJECT="${HX_PROJECT:-$ROOT_DIR}"

if [[ ! -x "$CLI" ]]; then
  echo "找不到 HBuilderX CLI: $CLI" >&2
  echo "请安装 HBuilderX 5.15+，或设置 HX_CLI=/path/to/cli" >&2
  exit 1
fi

# 对需要 --project 的子命令：若调用方未显式传入，则自动补上默认项目
# - launch / logcat：运行与看日志
# - publish：发行（含生成本地打包 App 资源 appResource、打 wgt）
# - pack：云打包 / 鸿蒙本地打包等
args=("$@")
if [[ ${#args[@]} -gt 0 ]]; then
  cmd="${args[0]}"
  case "$cmd" in
    launch|logcat|publish|pack)
      has_project=0
      for a in "${args[@]}"; do
        if [[ "$a" == "--project" ]]; then
          has_project=1
          break
        fi
      done
      if [[ "$has_project" -eq 0 ]]; then
        args+=(--project "$PROJECT")
      fi
      ;;
  esac
fi

# App 编译必须带入与当前源码匹配的完整离线资源。
hx_run() {
  "${HX_NODE:-/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node}" "$@"
}
cli_kind=""
case "${1:-}:${2:-}" in
  launch:app-*|publish:app|pack:app*)
    hx_run "$SCRIPT_DIR/prepare-offline-h5.mjs"
    cli_kind="${1}:${2}"
    ;;
esac

cli_status=0
"$CLI" "${args[@]}" || cli_status=$?

# 编译成功不代表离线资源完整：uni 编译器会按平台过滤 static/ 下的目录段
# （如 static/web），编译后必须对最终 App 资源跑清单校验，缺文件直接失败。
if [[ -n "$cli_kind" && $cli_status -eq 0 ]]; then
  verify_targets=()
  case "$cli_kind" in
    launch:app-*)
      # launch 装进设备的是 dist/dev 编译产物，只校验本次目标平台，避免陈旧的其他平台产物误报
      platform="${2#app-}" # ios / android / harmony
      d="$ROOT_DIR/unpackage/dist/dev/app-$platform/static/app/offline-h5"
      [[ -d "$d" ]] && verify_targets+=("$d")
      ;;
    publish:app)
      # appResource 发行产物在 unpackage/resources/app-*（iOS/Android 各一份）
      for d in "$ROOT_DIR"/unpackage/resources/app-*/static/app/offline-h5; do
        [[ -d "$d" ]] && verify_targets+=("$d")
      done
      ;;
    pack:app*)
      # 云打包/本地打包优先校验 resources，缺失时告警跳过
      for d in "$ROOT_DIR"/unpackage/resources/app-*/static/app/offline-h5; do
        [[ -d "$d" ]] && verify_targets+=("$d")
      done
      ;;
  esac
  if [[ ${#verify_targets[@]} -eq 0 ]]; then
    echo "[offline-h5] 跳过最终包校验：未找到本地编译产物目录（云打包等场景）" >&2
  else
    for d in "${verify_targets[@]}"; do
      echo "[offline-h5] 校验最终包: ${d#"$ROOT_DIR"/}"
      hx_run "$SCRIPT_DIR/verify-offline-h5-package.mjs" "$d" || cli_status=1
    done
  fi
fi
exit $cli_status
