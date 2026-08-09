#!/usr/bin/env bash
# nuwax 卡死/卡顿现场一键抓取(adb)。
# 用法:
#   bash scripts/grab-freeze-state.sh                 # 仅一台真机时自动选
#   bash scripts/grab-freeze-state.sh RFGYB3E15TZ     # 多设备时必须指定 serial
#   bash scripts/grab-freeze-state.sh RFGYB3E15TZ com.nuwax.app
# 抓取:全量/错误/app-tag logcat、整机&app 线程 CPU、线程 wchan、dumpsys 状态/内存/帧率、ANR 尝试
# 输出到 /tmp/nuwax-grab-<时间>-<serial>-pid<pid>/
set -uo pipefail
ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb
PKG="${2:-com.nuwax.app}"

# ---- 选设备:多台真机时强制要求 serial,避免抓错 ----
DEVS=()
while read -r line; do [ -n "$line" ] && DEVS+=("$line"); done < <("$ADB" devices | awk 'NR>1 && $2=="device" && $1!~/emulator/{print $1}')
DEV="${1:-}"
if [ -z "$DEV" ]; then
  case "${#DEVS[@]}" in
    0) echo "✗ 无设备连接"; exit 1 ;;
    1) DEV="${DEVS[0]}" ;;
    *) echo "✗ 检测到多台真机: ${DEVS[*]}"; echo "  请指定 serial:bash $0 <serial> [package]"; exit 1 ;;
  esac
fi

PID="$("$ADB" -s "$DEV" shell pidof "$PKG" 2>/dev/null | tr -d '\r')"
if [ -z "$PID" ]; then echo "✗ $PKG 未在 $DEV 运行(先装包/启动)"; exit 1; fi

OUT="/tmp/nuwax-grab-$(date +%Y%m%d-%H%M%S)-${DEV}-pid${PID}"
mkdir -p "$OUT"
echo "设备=$DEV  $PKG PID=$PID"
echo "输出=$OUT"
echo "----------------------------"

# 1) logcat:全量 / 仅错误 / app 相关 tag
"$ADB" -s "$DEV" logcat -d -v time     > "$OUT/01_logcat_full.txt" 2>&1
"$ADB" -s "$DEV" logcat -d -v time *:E > "$OUT/02_logcat_errors.txt" 2>&1
"$ADB" -s "$DEV" logcat -d -v time -s "console:V" "UniAppX:V" "UTS:V" "jsLog:V" "vconsole:V" "AndroidRuntime:E" > "$OUT/03_logcat_app_tags.txt" 2>&1

# 2) CPU:整机 top + app 线程 top(两次采样)
"$ADB" -s "$DEV" shell top    -n 2 -d 1 -q -m 20       > "$OUT/04_system_top.txt" 2>&1
"$ADB" -s "$DEV" shell top -H -n 2 -d 1 -q -p "$PID"   > "$OUT/05_app_threads_top.txt" 2>&1

# 3) app 线程名 + wchan(权限不够会空;可调试/root 下能看到 futex/poll 等)
"$ADB" -s "$DEV" shell "for t in \$(ls /proc/$PID/task 2>/dev/null); do printf '%s ' \$t; cat /proc/$PID/task/\$t/comm 2>/dev/null; printf ' | wchan='; cat /proc/$PID/task/\$t/wchan 2>/dev/null; echo; done" > "$OUT/06_threads_wchan.txt" 2>&1

# 4) dumpsys:进程状态/adj/ANR / 内存 / 前台 activity / 帧率jank
"$ADB" -s "$DEV" shell dumpsys activity processes > "$OUT/07_dumpsys_processes.txt" 2>&1
"$ADB" -s "$DEV" shell dumpsys meminfo "$PKG"      > "$OUT/08_meminfo.txt" 2>&1
"$ADB" -s "$DEV" shell dumpsys activity activities > "$OUT/09_dumpsys_activities.txt" 2>&1
"$ADB" -s "$DEV" shell dumpsys gfxinfo "$PKG"      > "$OUT/10_gfxinfo.txt" 2>&1

# 5) 线程栈(需可调试;release 会失败,忽略)
"$ADB" -s "$DEV" shell "run-as $PKG kill -3 $PID 2>/dev/null; run-as $PKG cat /data/anr/traces.txt 2>/dev/null" > "$OUT/11_stack_attempt.txt" 2>&1

# 6) 设备 & 应用版本
"$ADB" -s "$DEV" shell "getprop ro.product.model; getprop ro.product.manufacturer; getprop ro.build.version.release; getprop ro.build.display.id" > "$OUT/12_device_info.txt" 2>&1
"$ADB" -s "$DEV" shell dumpsys package "$PKG" | grep -E "versionName|versionCode|lastUpdateTime" >> "$OUT/12_device_info.txt" 2>&1

echo "================ 完成 ================"
ls -lh "$OUT"
echo
echo "👉 重点:05/06(线程) · 08(内存) · 02/03(报错&app日志)"
echo "   打包:tar czf /tmp/nuwax-grab.tgz -C \"$OUT\" ."
