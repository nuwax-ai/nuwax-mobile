#!/usr/bin/env bash
# Android 模拟器中文输入一键配置（HBuilderX / Android Studio AVD 通用）
#
# 用法：
#   chmod +x scripts/setup-android-emulator-chinese-ime.sh
#   ./scripts/setup-android-emulator-chinese-ime.sh
#
# 说明：
# - 方案 A（推荐）：Mac 宿主输入法 — 模拟器聚焦输入框后，用 Mac 切换中文（Control+Space）
# - 方案 B：模拟器内安装中文 IME（本脚本自动设置语言并打开 Play 商店 / 输入法设置）
# - 方案 C：ADBKeyBoard — 仅用于 adb 脚本注入中文，不适合手动点键盘输入

set -euo pipefail

ADB="${ADB:-adb}"
DEVICE="${ANDROID_SERIAL:-}"

adb_cmd() {
  if [[ -n "$DEVICE" ]]; then
    "$ADB" -s "$DEVICE" "$@"
  else
    "$ADB" "$@"
  fi
}

pick_device() {
  local count
  count="$(adb_cmd devices | awk 'NR>1 && $2=="device"{print $1}' | wc -l | tr -d ' ')"
  if [[ "$count" == "0" ]]; then
    echo "❌ 未检测到在线 Android 设备/模拟器，请先启动 HBuilderX 模拟器或 AVD。"
    exit 1
  fi
  if [[ "$count" != "1" && -z "$DEVICE" ]]; then
    echo "⚠️  检测到多个设备，将使用第一个 online 设备。可 export ANDROID_SERIAL=emulator-5554 指定。"
    DEVICE="$(adb_cmd devices | awk 'NR>1 && $2=="device"{print $1; exit}')"
  fi
}

echo "==> 1/5 检测设备"
pick_device
ABI="$(adb_cmd shell getprop ro.product.cpu.abi | tr -d '\r')"
SDK="$(adb_cmd shell getprop ro.build.version.sdk | tr -d '\r')"
echo "    设备: ${DEVICE:-default}  ABI: ${ABI}  API: ${SDK}"

echo "==> 2/5 设置系统语言为简体中文"
adb_cmd shell cmd locale set-device-locale zh-Hans-CN || true
adb_cmd shell settings put system system_locales zh-Hans-CN,en-US || true
echo "    当前 locale: $(adb_cmd shell cmd locale get-device-locale | tr -d '\r')"

echo "==> 3/5 恢复 Gboard 为默认输入法（便于手动输入）"
adb_cmd shell ime enable --user 0 com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME || true
adb_cmd shell ime set --user 0 com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME || true

echo "==> 4/5 打开 Play 商店（搜狗输入法）与系统输入法设置"
adb_cmd shell am start -a android.intent.action.VIEW -d "market://details?id=com.sohu.inputmethod.sogou" >/dev/null 2>&1 || true
sleep 1
adb_cmd shell am start -a android.settings.INPUT_METHOD_SETTINGS >/dev/null 2>&1 || true

echo "==> 5/5（可选）安装 ADBKeyBoard — 供 adb 注入中文，非手动键盘"
TMP_APK="$(mktemp /tmp/ADBKeyboard.XXXXXX.apk)"
if curl -fsSL "https://github.com/senzhk/ADBKeyBoard/raw/master/ADBKeyboard.apk" -o "$TMP_APK"; then
  adb_cmd install -r "$TMP_APK" >/dev/null || true
  adb_cmd shell ime enable --user 0 com.android.adbkeyboard/.AdbIME >/dev/null 2>&1 || true
  echo "    ADBKeyBoard 已安装。注入中文示例："
  echo "    adb shell ime set --user 0 com.android.adbkeyboard/.AdbIME"
  echo "    adb shell am broadcast -a ADB_INPUT_TEXT --es msg '你好世界'"
  echo "    adb shell ime set --user 0 com.google.android.inputmethod.latin/com.android.inputmethod.latin.LatinIME"
else
  echo "    跳过 ADBKeyBoard（网络不可用）"
fi
rm -f "$TMP_APK"

cat <<'EOF'

✅ 自动步骤已完成。请在模拟器内手动完成（约 1 分钟）：

【方案 A — Mac 宿主输入法，最快】
  1. Mac：系统设置 → 键盘 → 输入法 → 添加「简体拼音」
  2. 模拟器内点击 App 输入框
  3. Mac 按 Control+Space 切到中文，直接打字（无需装 Android 中文键盘）

【方案 B — 模拟器内中文键盘】
  1. 在已打开的 Play 商店安装「搜狗输入法」
  2. 设置 → 系统 → 语言和输入法 → 屏幕键盘 → 启用搜狗
  3. 默认输入法选搜狗；或输入框长按 → 切换输入法

【Gboard 用户】
  设置 → Gboard → 语言 → 添加「中文（简体）」→ 完成

架构提示：当前 ABI 为 arm64-v8a 时安装 arm64 版 APK；x86_64 模拟器需 x86 版 APK。

EOF
