#!/usr/bin/env bash
set -euo pipefail

source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$source_dir/../../.." && pwd)"
build_dir="$repo_root/out/harmony-native-audio-rtc"
go_bin="${NUWAX_OHOS_GO:-$build_dir/toolchain/go-ohos-124/bin/go}"
sdk_home="${DEVECO_SDK_HOME:-${DEVECO_HOME:-/Applications/DevEco-Studio.app/Contents}/sdk}"
ndk="$sdk_home/default/openharmony/native"
clang="$ndk/llvm/bin/clang"
opus_version=1.6.1
opus_hash=6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1

# The shipping QA prototype used the OpenHarmony SIG Go 1.24 port at
# 302a5306b6fad2f47196360b82561d1db1f954cf. Stock Linux Go cannot target this ABI.
if [[ ! -x "$go_bin" ]] || ! "$go_bin" tool dist list | grep -Fx 'openharmony/arm64' >/dev/null; then
  echo 'Set NUWAX_OHOS_GO to the OpenHarmony Go binary with openharmony/arm64 support.' >&2
  exit 1
fi
if [[ ! -x "$clang" ]]; then
  echo 'DevEco OpenHarmony NDK is unavailable. Check DEVECO_SDK_HOME.' >&2
  exit 1
fi

mkdir -p "$build_dir/codec"
archive="$build_dir/codec/opus-$opus_version.tar.gz"
opus="$build_dir/codec/opus-$opus_version"
opus_build="$build_dir/codec/output"
if [[ ! -f "$archive" ]]; then
  curl --fail --location --silent --show-error --output "$archive.tmp" "https://downloads.xiph.org/releases/opus/opus-$opus_version.tar.gz"
  mv "$archive.tmp" "$archive"
fi
printf '%s  %s\n' "$opus_hash" "$archive" | shasum -a 256 -c -
tar -xf "$archive" -C "$build_dir/codec"
cmake -S "$opus" -B "$opus_build" -DCMAKE_SYSTEM_NAME=Linux -DCMAKE_SYSTEM_PROCESSOR=aarch64 \
  -DCMAKE_C_COMPILER="$clang" -DCMAKE_C_COMPILER_TARGET=aarch64-linux-ohos -DCMAKE_SYSROOT="$ndk/sysroot" \
  -DCMAKE_AR="$ndk/llvm/bin/llvm-ar" -DCMAKE_RANLIB="$ndk/llvm/bin/llvm-ranlib" \
  -DCMAKE_POSITION_INDEPENDENT_CODE=ON -DCMAKE_BUILD_TYPE=Release -DOPUS_DISABLE_INTRINSICS=ON \
  -DOPUS_BUILD_SHARED_LIBRARY=OFF -DOPUS_BUILD_TESTING=OFF -DOPUS_BUILD_PROGRAMS=OFF
cmake --build "$opus_build" --target opus --parallel

cd "$source_dir/transport"
output="$build_dir/libnuwax_harmony_rtc.so"
CGO_ENABLED=1 GOOS=openharmony GOARCH=arm64 GOTOOLCHAIN=local CC="$clang" \
  CGO_CFLAGS="--target=aarch64-linux-ohos --sysroot=$ndk/sysroot -I$opus/include" \
  CGO_LDFLAGS="--target=aarch64-linux-ohos --sysroot=$ndk/sysroot $opus_build/libopus.a -lace_napi.z -lm" \
  "$go_bin" build -mod=readonly -trimpath -buildmode=c-shared -o "$output" .
printf 'QA native voice library: %s\n' "$output"
