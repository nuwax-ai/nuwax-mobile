# 本地离线自定义基座（仅出包，不安装/不唤起设备）
# 详见 docs/local-custom-base-maintenance.md · docs/custom-base-distribution-s3.md
.PHONY: help base-env base-android base-ios-device base-ios-simulator base-all base-ship base-harmony base-publish base-fetch sdk-publish sdk-fetch app-resource android-tester android-release

ROOT := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))
HX_CLI ?= /Applications/HBuilderX.app/Contents/MacOS/cli

help:
	@echo "自定义基座 · 只生成包 → unpackage/debug/"
	@echo "  make base-android         # android_debug.apk"
	@echo "  make base-ios-device       # iOS_debug.ipa（真机）"
	@echo "  make base-ios-simulator   # Pandora_simulator_debug.app（模拟器）"
	@echo "  make base-all             # 上述三份（仅出包，不生成资源、不上 S3）"
	@echo "  make base-ship            # 一键：appResource → 出包 → 上传 S3"
	@echo "  make base-env             # 打印路径"
	@echo "  make app-resource         # 生成本地打包App资源（HX CLI，iOS+Android，需 HX 已启动）"
	@echo "  make android-tester       # 发测试：appResource → Release APK（无 HX 调试）"
	@echo "  make android-release      # 正式上架：生产资源 → 正式签名 APK+AAB"
	@echo ""
	@echo "S3 分发（版本 = manifest versionName；同版本覆盖；fetch 默认最新）"
	@echo "  make base-publish         # 上传当前 unpackage/debug 产物"
	@echo "  make base-fetch           # 拉取最新基座（不指定版本）"
	@echo ""
	@echo "离线 SDK S3 分发（版本 = NUWAX_HX_VERSION；打包 sdk/+archives，不含 work）"
	@echo "  make sdk-publish          # 打包并上传离线 SDK"
	@echo "  make sdk-fetch            # 拉取离线 SDK 到 NUWAX_OFFLINE_SDK_HOME"
	@echo ""
	@echo "base-ship 开关：SKIP_APP_RESOURCE=1 / SKIP_PUBLISH=1 / TARGETS=android,…"
	@echo "android-tester 开关：SKIP_APP_RESOURCE=1 / DELIVER_NAME=xxx.apk"
	@echo "真机与模拟器是两套包，勿混用。"

base-env:
	@NUWAX_LOCAL_BASE_ENV_VERBOSE=1 bash -c 'source "$(ROOT)scripts/local-base-env.sh"'

base-android:
	@bash "$(ROOT)scripts/android-esp/package_custom_base.sh"

# 发给测试同学：流程化打接近发行性能的完整 APK（非上架证书）
android-tester:
	@bash "$(ROOT)scripts/android-esp/build_tester_release_apk.sh"

# 应用市场正式包：生产配置、正式证书、APK+AAB，并执行签名/版本验收
android-release:
	@bash "$(ROOT)scripts/android-esp/build_store_release.sh"

base-ios-device:
	@bash "$(ROOT)scripts/ios-esp/package_device_base.sh"

base-ios-simulator:
	@bash "$(ROOT)scripts/ios-esp/package_simulator_base.sh"

base-all:
	@TARGETS=all bash "$(ROOT)scripts/package-custom-bases.sh"

# 维护者一键：HX 生成本地打包资源 → 打三端基座 → 上传 S3
base-ship:
	@bash "$(ROOT)scripts/ship-custom-bases.sh"

# 兼容旧目标名 → 真机包
base-ios: base-ios-device

base-harmony:
	@echo "鸿蒙本地基座尚未实现。见 scripts/harmony-esp/README.md"
	@exit 1

base-publish:
	@bash "$(ROOT)scripts/publish-custom-base-s3.sh"

base-fetch:
	@bash "$(ROOT)scripts/fetch-custom-base-s3.sh"

sdk-publish:
	@bash "$(ROOT)scripts/publish-offline-sdk-s3.sh"

sdk-fetch:
	@bash "$(ROOT)scripts/fetch-offline-sdk-s3.sh"

# 生成本地打包 App 资源（iOS+Android；HX CLI，需 HBuilderX 已启动 + 项目已导入）
app-resource:
	@"$(HX_CLI)" publish app --type appResource --project "$(ROOT:%/=%)"
