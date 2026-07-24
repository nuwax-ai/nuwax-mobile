#!/usr/bin/env bash
# HBuilderX CLI 薄封装：统一路径与项目名，供 package.json scripts 调用。
# 用法：bash scripts/hx-cli.sh <cli 原生子命令…>
# 例： bash scripts/hx-cli.sh devices list
#      bash scripts/hx-cli.sh launch app-android --project nuwax-mobile
set -euo pipefail

CLI="${HX_CLI:-/Applications/HBuilderX.app/Contents/MacOS/cli}"
PROJECT="${HX_PROJECT:-nuwax-mobile}"

if [[ ! -x "$CLI" ]]; then
  echo "找不到 HBuilderX CLI: $CLI" >&2
  echo "请安装 HBuilderX 5.15+，或设置 HX_CLI=/path/to/cli" >&2
  exit 1
fi

# 若子命令是 launch / logcat 且未显式传 --project，则补上默认项目名
args=("$@")
if [[ ${#args[@]} -gt 0 ]]; then
  cmd="${args[0]}"
  if [[ "$cmd" == "launch" || "$cmd" == "logcat" ]]; then
    has_project=0
    for a in "${args[@]}"; do
      if [[ "$a" == "--project" ]]; then has_project=1; break; fi
    done
    if [[ "$has_project" -eq 0 ]]; then
      args+=(--project "$PROJECT")
    fi
  fi
fi

exec "$CLI" "${args[@]}"
