#!/bin/bash
# 运行 uni-app x Android 编译并提取关键错误
# usage: ./scripts/run-uni-build.sh [show-log]

set -u
cd "$(dirname "$0")/.."

pkill -f "uni.js -p app" 2>/dev/null
sleep 1
rm -f /tmp/uni-app-build.log

export HX_APP_ROOT="/Applications/HBuilderX.app/Contents/HBuilderX"
export UNI_INPUT_DIR="$PWD"
export UNI_APP_X=true
export UNI_UTS_PLATFORM=app-android
export UNI_PLATFORM=app
export RUN_BY_HBUILDERX=1
export HX_Version=5.07

/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node \
  --max-old-space-size=3072 \
  --no-warnings \
  -r /Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-extension/static/kill.js \
  /Applications/HBuilderX.app/Contents/HBuilderX/plugins/uniapp-cli-vite/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js \
  -p app \
  > /tmp/uni-app-build.log 2>&1 &
BUILD_PID=$!

# 等编译结束（最多 100s，日志稳定 3 次相同就提前结束）
echo "started pid=$BUILD_PID"
PREV_LINES=0
STABLE_COUNT=0
for i in $(seq 1 20); do
  sleep 5
  if ! ps -p $BUILD_PID > /dev/null 2>&1; then
    echo "[$((i*5))s] exited"
    break
  fi
  LINES=$(wc -l < /tmp/uni-app-build.log | tr -d ' ')
  echo "[$((i*5))s] running, $LINES lines"
  if [ "$LINES" = "$PREV_LINES" ]; then
    STABLE_COUNT=$((STABLE_COUNT+1))
    [ "$STABLE_COUNT" -ge 3 ] && break
  else
    STABLE_COUNT=0
    PREV_LINES=$LINES
  fi
done

pkill -f "uni.js -p app" 2>/dev/null
sleep 1

echo ""
echo "===log size==="
wc -lc /tmp/uni-app-build.log

echo ""
echo "===关键阻塞错误（非 CSS）==="
grep -E "Could not resolve|Cannot find module|Single file component|Build failed|error TS|✗" /tmp/uni-app-build.log | grep -v "app-uvue-css" | head -30

echo ""
echo "===Build failed 计数==="
grep -c "Build failed" /tmp/uni-app-build.log

if [ "${1:-}" = "show-log" ]; then
  echo ""
  echo "===最后 60 行==="
  tail -60 /tmp/uni-app-build.log
fi
