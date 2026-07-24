#!/usr/bin/env bash
# 兼容入口：转发到 inject_all_uts_modules.py（官方：业务依赖的全部 UTS 插件都要进宿主）
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
exec python3 "$SCRIPT_DIR/inject_all_uts_modules.py"
