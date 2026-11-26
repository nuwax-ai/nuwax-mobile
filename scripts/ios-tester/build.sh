#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$ROOT"
export HX_CLI="${HX_CLI:-/Applications/HBuilderX.app/Contents/MacOS/cli}"
[[ -x "$HX_CLI" ]] || { echo "找不到 HBuilderX CLI：$HX_CLI" >&2; exit 1; }
[[ -d node_modules ]] || { echo '请先运行 pnpm install --frozen-lockfile' >&2; exit 1; }

for command in xcodebuild xcodegen pod python3; do
  command -v "$command" >/dev/null || { echo "请先安装 $command" >&2; exit 1; }
done

SIGNING_ENV="${NUWAX_SIGNING_ENV:-}"
if [[ -z "$SIGNING_ENV" ]]; then
  SIGNING_ENV="$ROOT/scripts/local-secrets.env"
  if [[ ! -f "$SIGNING_ENV" ]]; then
    SIGNING_ENV="${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env"
  fi
fi
if [[ -f "$SIGNING_ENV" ]]; then
  set -a
  source "$SIGNING_ENV"
  set +a
elif [[ -n "${NUWAX_SIGNING_ENV:-}" ]]; then
  echo "找不到签名配置：$SIGNING_ENV" >&2
  exit 1
fi
: "${DCLOUD_APPKEY:?请配置 DCLOUD_APPKEY}"
: "${IOS_DEVELOPMENT_TEAM:?请配置 IOS_DEVELOPMENT_TEAM}"
: "${IOS_PROVISIONING_PROFILE_UUID:?请配置 IOS_PROVISIONING_PROFILE_UUID}"
: "${NUWAX_IOS_UNIPUSH_CLIENT_IPA:?请配置同应用的 UniPush 基座 IPA}"
export DCLOUD_APPKEY IOS_DEVELOPMENT_TEAM IOS_PROVISIONING_PROFILE_UUID NUWAX_IOS_UNIPUSH_CLIENT_IPA

OUT="$ROOT/out/ios-tester"
mkdir -p "$OUT/packages"
LOCK="$OUT/.build-lock"
mkdir "$LOCK" 2>/dev/null || { echo 'iOS tester 正在打包，或上次打包锁仍存在。' >&2; exit 1; }
STAGE=""
cleanup() {
  if [[ -n "$STAGE" ]]; then rm -rf -- "$STAGE"; fi
  rmdir "$LOCK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -z "${UNIAPPX_SDK_ROOT:-}" ]]; then
  SDK_NAME='UniAppX-iOS@5.34'
  SDK_HOME="${NUWAX_OFFLINE_SDK_HOME:-$HOME/workspace/nuwax-mobile-offline-sdk}"
  UNIAPPX_SDK_ROOT="$SDK_HOME/sdk/ios/5.34/$SDK_NAME"
  if [[ ! -d "$UNIAPPX_SDK_ROOT/SDK/Libs" ]]; then
    UNIAPPX_SDK_ROOT="$OUT/sdk/$SDK_NAME"
    if [[ ! -d "$UNIAPPX_SDK_ROOT/SDK/Libs" ]]; then
      STAGE="$(mktemp -d "$OUT/.sdk.XXXXXXXX")"
      curl -fL --retry 2 --connect-timeout 15 -o "$STAGE/sdk.zip" \
        'https://web-ext-storage.dcloud.net.cn/uni-app-x/sdk/iOS/UniAppX-iOS%405.34.zip'
      unzip -q "$STAGE/sdk.zip" -d "$STAGE"
      test -d "$STAGE/$SDK_NAME/SDK/Libs"
      mkdir -p "$OUT/sdk"
      mv "$STAGE/$SDK_NAME" "$OUT/sdk/"
      rm -rf -- "$STAGE"
      STAGE=""
    fi
  fi
fi
export UNIAPPX_SDK_ROOT

python3 "$SCRIPT_DIR/prepare-host.py" check
PROJECT="$OUT/project"
HOST="$OUT/host"
DERIVED="$OUT/derived"
rm -rf -- "$PROJECT" "$HOST"
node scripts/generate-app-privacy-policy.mjs
node scripts/prepare-offline-h5.mjs
node "$SCRIPT_DIR/prepare-source.mjs" "$PROJECT"
"$HX_CLI" project open --path "$PROJECT"
python3 "$SCRIPT_DIR/run-hx-local-build.py" publish app --type appResource --project "$PROJECT"
python3 "$SCRIPT_DIR/prepare-host.py" generate "$PROJECT" "$HOST"
xcodebuild -workspace "$HOST/NuwaxIOSTester.xcworkspace" -scheme UniAppX -configuration Debug \
  -destination 'generic/platform=iOS' -derivedDataPath "$DERIVED" build
APP="$DERIVED/Build/Products/Debug-iphoneos/UniAppX.app"
python3 "$SCRIPT_DIR/prepare-host.py" verify "$PROJECT" "$APP"

STAGE="$(mktemp -d "$OUT/.package.XXXXXXXX")"
mkdir "$STAGE/Payload"
ditto "$APP" "$STAGE/Payload/UniAppX.app"
IPA="Nuwax-iOS-Test-$(date +%Y%m%d-%H%M%S).ipa"
(cd "$STAGE" && zip -qry "$IPA" Payload)
python3 scripts/check-app-no-voip.py "$STAGE/$IPA"
node scripts/verify-offline-h5-artifact.mjs "$STAGE/$IPA"
cp "$PROJECT/nuwax-ios-tester.json" "$STAGE/$IPA.json"
(cd "$STAGE" && shasum -a 256 "$IPA" > "$IPA.sha256")
mv "$STAGE/$IPA" "$STAGE/$IPA.json" "$STAGE/$IPA.sha256" "$OUT/packages/"
ln -sfn "$IPA" "$OUT/packages/Nuwax-iOS-Test-latest.ipa"
printf '已验签的测试 IPA：%s\n' "$OUT/packages/$IPA"
