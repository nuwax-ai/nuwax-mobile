#!/usr/bin/env bash
# 一键归档崩溃 / 性能日志到 docs/perf-baseline/diag-<tag>/（方便后续分析）。
#
# 抓取内容：
#   1. logcat（GC / 流式 StreamRequest / PerfProbe / SseStall / FATAL / ANR）
#   2. bugreport（含 MIUI SCOUT self-trace，全线程栈；约 1–2min）
#   3. 所有 APP_SCOUT_HANG 的主线程栈（提取关键行，定位卡死点）
#   4. 进程 / 内存快照（pidof / top / dumpsys meminfo）
#
# 用法：
#   bash scripts/grab-diag.sh                    # 目录名 = 当前时间戳
#   bash scripts/grab-diag.sh 20260807-anr       # 指定目录名
#   PERF_DEV=<serial> bash scripts/grab-diag.sh  # 多设备指定
set -uo pipefail

ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb
DEV="${PERF_DEV:-8PNNT4TKHIJVU8RO}"
PKG="${PERF_PKG:-com.nuwax.app}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TAG="${1:-$(date +%Y%m%d-%H%M%S)}"
OUT="$ROOT/.diag/$TAG"
mkdir -p "$OUT"

echo "==== 归档目标：$OUT （设备 $DEV）===="

echo "[1/4] logcat（GC/流式/性能探针/崩溃）→ logcat.txt"
"$ADB" -s "$DEV" logcat -d 2>/dev/null \
  | grep -iE 'StreamRequest|decodeUTF8|utf8ArrayToString|PerfProbe|SseStall|concurrent GC|sticky GC|non sticky GC|Forcing collection|clamping|out of memory|WaitForGc|GC count|Background concurrent|MIUIScout.*(StreamRequest|main)|FATAL|ANR in com.nuwax|reacting to signal 3' \
  > "$OUT/logcat.txt"
echo "    $(wc -l < "$OUT/logcat.txt") 行"

echo "[2/4] bugreport（含 SCOUT self-trace；约 1–2min）..."
"$ADB" -s "$DEV" bugreport "$OUT/bugreport.zip" 2>&1 | tail -1
mkdir -p "$OUT/bugreport" && (cd "$OUT/bugreport" && unzip -oq "$OUT/bugreport.zip" 2>/dev/null)

echo "[3/4] 提取所有 APP_SCOUT_HANG 主线程栈 → main-stacks.txt"
PID=$("$ADB" -s "$DEV" shell "pidof $PKG" | tr -d '\r\n ')
{
  for d in $(ls -d "$OUT"/bugreport/FS/data/miuilog/stability/scout/app/*APP_SCOUT_HANG 2>/dev/null | sort); do
    ts=$(basename "$d" | grep -oE '[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}-[0-9]{2}' | head -1)
    pid_in_name=$(basename "$d" | grep -oE "$PKG-[0-9]+" | grep -oE '[0-9]+')
    trace=$(find "$d" -name '*self-trace' 2>/dev/null | head -1)
    [ -z "$trace" ] && continue
    echo "==================== HANG @ $ts (pid $pid_in_name) ===================="
    awk '/^"main" prio/{f=1} f{print} f&&/^$/{exit}' "$trace" 2>/dev/null \
      | grep -E 'prio=|state=|WaitingFor|native: #0[0-4]|at uni\.|at uts\.|at java\.lang\.String' | head -18
    echo ""
  done
  # 非 MIUI 设备兜底：从 ANR traces.txt 提取（需 root / shell 可读）
  if [ ! -s "$OUT/main-stacks.txt" ]; then
    echo "（MIUI SCOUT 无 HANG 记录，尝试 /data/anr/traces.txt）"
    "$ADB" -s "$DEV" shell "cat /data/anr/traces.txt 2>/dev/null" \
      | awk -v pkg="$PKG" '
        /Cmdline: / { inapp = ($0 ~ pkg) }
        /^----- pid / { if (inapp && main) exit; inapp = 0 }
        inapp && /^"main"/ { main = 1 }
        main { print }
      ' | head -60
  fi
} > "$OUT/main-stacks.txt" 2>&1
echo "    $(wc -l < "$OUT/main-stacks.txt") 行"

echo "[4/4] 进程 / 内存快照 → proc-mem.txt"
{
  echo "=== pidof ==="; "$ADB" -s "$DEV" shell "pidof $PKG" 2>/dev/null
  echo "=== top ===";   "$ADB" -s "$DEV" shell "top -n1 -b 2>/dev/null | grep -i $PKG" 2>/dev/null | head -3
  echo "=== dumpsys meminfo ==="; "$ADB" -s "$DEV" shell "dumpsys meminfo $PKG 2>/dev/null" | head -45
} > "$OUT/proc-mem.txt" 2>&1

echo ""
echo "==== 归档完成 → $OUT ===="
ls -la "$OUT"
echo ""
echo "提示："
echo "  - 主线程卡点看 main-stacks.txt（at uni.* / at uts.* 行）"
echo "  - GC 风暴看 logcat.txt（sticky GC / non sticky GC 频率）"
echo "  - 完整栈 / 其它线程：$OUT/bugreport/ 下 SCOUT self-trace 文件"
