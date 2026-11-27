#!/usr/bin/env bash
# HBuilderX CLI 薄封装：统一路径与项目名，供 package.json scripts / make 调用。
#
# 用法：bash scripts/hx-cli.sh <cli 原生子命令…>
# 例： bash scripts/hx-cli.sh devices list
#      bash scripts/hx-cli.sh launch app-android --project nuwax-mobile
#      bash scripts/hx-cli.sh publish app --type appResource
#      bash scripts/hx-cli.sh pack --config /absolute/path/to/pack.json
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
cmd="${1:-}"
action="${2:-}"
project_arg=""
config_arg=""
help_requested=0
for ((i = 1; i < $#; i++)); do
  case "${args[i]}" in
    --project) project_arg="${args[i+1]:-}" ;;
    --config) config_arg="${args[i+1]:-}" ;;
    --help|-h) help_requested=1 ;;
  esac
done
case "$cmd" in
  launch|logcat|publish|pack)
    if [[ -z "$project_arg" && ( "$cmd" != pack || -z "$config_arg" ) && "$help_requested" == 0 ]]; then
      args+=(--project "$PROJECT")
    fi
    ;;
esac

# App 编译必须带入与当前源码匹配的完整离线资源。
hx_run() {
  "${HX_NODE:-/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node}" "$@"
}
cli_kind=""
prepare_scripts="$SCRIPT_DIR"
case "$cmd:$action" in
  launch:app-android)
    bash "$SCRIPT_DIR/patch-hx-android-base-appid.sh"
    ;;
esac
case "$cmd:$action" in
  launch:app-*|publish:app|publish:app-android|pack:app*)
    cli_kind="$cmd:$action"
    ;;
  pack:|pack:--*)
    if [[ "$help_requested" == 0 ]]; then
      cli_kind="pack:cloud"
      pack_project="${project_arg:-$PROJECT}"
      if [[ -n "$config_arg" ]]; then
        config_project="$(hx_run -e '
          try {
            const config = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
            process.stdout.write(typeof config.project === "string" ? config.project : "");
          } catch {
            console.error("无法读取云打包配置，请检查文件路径和 JSON 格式。");
            process.exit(1);
          }
        ' "$config_arg")"
        pack_project="${config_project:-$pack_project}"
        if [[ -z "$config_project" && -z "$project_arg" ]]; then
          args+=(--project "$pack_project")
        fi
      fi
      if [[ -d "$pack_project/scripts" ]]; then
        prepare_scripts="$(cd "$pack_project/scripts" && pwd)"
      elif [[ "$pack_project" != "$(basename "$ROOT_DIR")" && "$pack_project" != "$ROOT_DIR" ]]; then
        echo "无法定位云打包项目的脚本目录，请使用已导入项目的绝对路径：$pack_project" >&2
        exit 1
      fi
    fi
    ;;
esac
if [[ -n "$cli_kind" ]]; then
  hx_run "$prepare_scripts/generate-app-privacy-policy.mjs"
  hx_run "$prepare_scripts/prepare-offline-h5.mjs"
  hx_run "$prepare_scripts/prepare-voip-media.mjs"
  if [[ "$cli_kind" == pack:cloud ]]; then
    hx_run "$prepare_scripts/verify-offline-h5-package.mjs" "$prepare_scripts/../static/app/offline-h5"
  fi
fi

cli_status=0
"$CLI" "${args[@]}" || cli_status=$?

# 编译成功不代表离线资源完整：uni 编译器会按平台过滤 static/ 下的目录段
# （如 static/web），编译后必须对最终 App 资源跑清单校验，缺文件直接失败。
if [[ "$cli_kind" == pack:cloud && $cli_status -eq 0 ]]; then
  echo "[cloud-pack] 下载 APK/IPA 后运行 pnpm app:cloud:verify <产物路径> 核对裁剪和离线资源。"
elif [[ -n "$cli_kind" && $cli_status -eq 0 ]]; then
  verify_targets=()
  case "$cli_kind" in
    launch:app-*)
      # launch 装进设备的是 dist/dev 编译产物，只校验本次目标平台，避免陈旧的其他平台产物误报
      platform="${2#app-}" # ios / android / harmony
      if [[ "$platform" == "harmony" ]]; then
        # 鸿蒙的静态资源位于原生工程 resfile/www，而非 app-harmony/static。
        for d in "$ROOT_DIR"/unpackage/dist/dev/app-harmony/entry/src/main/resources/resfile/uni-app-x/apps/*/www/static/app/offline-h5; do
          [[ -d "$d" ]] && verify_targets+=("$d")
        done
      else
        d="$ROOT_DIR/unpackage/dist/dev/app-$platform/static/app/offline-h5"
        [[ -d "$d" ]] && verify_targets+=("$d")
      fi
      if [[ ${#verify_targets[@]} -eq 0 ]]; then
        echo "[offline-h5] 错误：app-$platform 编译产物缺少离线 H5 资源，请执行 pnpm offline-h5:prepare 后重新编译" >&2
        exit 1
      fi
      ;;
    publish:app|publish:app-android)
      resource_platform=app-android
      [[ "$cli_kind" != publish:app ]] || resource_platform='app-*'
      for d in "$ROOT_DIR"/unpackage/resources/$resource_platform/*/www/static/app/offline-h5; do
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
