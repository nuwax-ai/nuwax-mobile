#!/usr/bin/env bash
# HBuilderX 读取自定义基座 apk 时，用 endsWith("manifest.json") 取最后一个清单的 id。
# 离线包清单若也以 manifest.json 结尾，会盖掉真正的 www/manifest.json，appid 变成空，
# 同步目录变成 apps/null，基座弹出「未检测到应用资源」。
# 这里把匹配收窄为 /www/manifest.json。已打进 apk 的旧清单不用重打基座也能避开。
# HBuilderX 升级后若这段代码被覆盖，下次 android 运行会再打上；正在运行的 HX 需要重启一次才生效。
set -euo pipefail

HX_ROOT="${HX_APP_ROOT:-/Applications/HBuilderX.app/Contents/HBuilderX}"
TARGET="$HX_ROOT/plugins/launcher/out/main.js"
OLD='getZipEntriesFile)(t,"manifest.json")'
NEW='getZipEntriesFile)(t,"/www/manifest.json")'

if [[ ! -f "$TARGET" ]]; then
  echo "未找到 HBuilderX 启动器: $TARGET" >&2
  exit 1
fi

if grep -qF "$NEW" "$TARGET"; then
  exit 0
fi

if ! grep -qF "$OLD" "$TARGET"; then
  echo "HBuilderX 启动器里没有预期的 manifest.json 匹配，可能已升级。请重启 HBuilderX 后再运行一次。" >&2
  exit 1
fi

python3 - "$TARGET" "$OLD" "$NEW" << 'PY'
import pathlib, sys
path, old, new = sys.argv[1:]
file = pathlib.Path(path)
file.write_text(file.read_text(encoding="utf-8").replace(old, new, 1), encoding="utf-8")
PY
echo "已让 HBuilderX 只从 www/manifest.json 读取自定义基座 appid。请完全退出并重新打开 HBuilderX 后再运行到 Android。"
