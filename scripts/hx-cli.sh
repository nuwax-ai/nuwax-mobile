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

exec "$CLI" "${args[@]}"
