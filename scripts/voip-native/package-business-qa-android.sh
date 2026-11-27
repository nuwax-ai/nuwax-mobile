#!/usr/bin/env bash
# 兼容旧入口，直接从当前项目生成 Android 测试包。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
echo '旧 VoIP QA 打包入口已切换到当前项目的 android-tester。'
exec bash "$ROOT/scripts/android-esp/build_tester_release_apk.sh" "$@"
