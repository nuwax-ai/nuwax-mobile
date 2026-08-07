#!/usr/bin/env bash
# 性能测试采数：从 logcat 解析 fps / maxGap / full_parse_large / el_stuck / render:fail。
# 配合 pages/test-stream-perf：每条 case「跑前 clear、跑完 grab」。
# 指标字符串约定见 docs/perf-verification-plan.md（[PerfProbe]/[SseStall] 探针输出）。
#
# 用法：
#   bash scripts/grab-perf-stats.sh clear            # 跑 case 前清缓冲
#   bash scripts/grab-perf-stats.sh grab A1          # 跑完抓数（A1=case 编号，写进结果行）
#   bash scripts/grab-perf-stats.sh grab A1 <serial> # 多设备指定 serial
#   PERF_DEV=<serial> bash scripts/grab-perf-stats.sh grab A1
set -uo pipefail
ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb
ACT="${1:-grab}"
CASE="${2:-}"
DEV="${3:-${PERF_DEV:-8PNNT4TKHIJVU8RO}}"

grab() {
  local D; D="$("$ADB" -s "$DEV" logcat -d 2>/dev/null)"
  local fps gap fp el rf
  fps=$(printf '%s\n' "$D" | grep -oE 'fps=[0-9]+' | grep -oE '[0-9]+' \
        | awk '{s+=$1;n++;if($1<m||m==0)m=$1;if($1>x)x=$1}END{if(n>0)printf "avg=%.0f min=%d max=%d(n=%d)",s/n,m,x,n;else printf "n/a"}')
  gap=$(printf '%s\n' "$D" | grep -oE 'maxGap=[0-9]+ms' | grep -oE '[0-9]+' \
        | awk '{s+=$1;n++;if($1<m||m==0)m=$1;if($1>x)x=$1}END{if(n>0)printf "avg=%.0f min=%d max=%d(n=%d)",s/n,m,x,n;else printf "n/a"}')
  fp=$(printf '%s\n' "$D" | grep -cE 'full_parse_large')
  el=$(printf '%s\n' "$D" | grep -cE 'el_stuck')
  rf=$(printf '%s\n' "$D" | grep -cE 'render: fail')
  echo "| ${CASE:-?} | fps $fps | maxGap ${gap}ms | full_parse=$fp | el_stuck=$el | render:fail=$rf |"
}

case "$ACT" in
  clear) "$ADB" -s "$DEV" logcat -c && echo "logcat 已清 ($DEV) — 去真机跑 case，跑完喊一声再 grab" ;;
  grab)  grab ;;
  *) echo "用法: $0 clear|grab [case-id] [serial]" >&2; exit 1 ;;
esac
