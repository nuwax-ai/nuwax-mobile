#!/usr/bin/env python3
"""
按官方 androiduts 文档，把 HX 导出的全部 app-android UTS 插件注入为 Android Library 模块。

扫描: unpackage/resources/app-android/uni_modules/*/utssdk/app-android
输出: $PROJ/uts-{plugin-name}/ 并写入 settings.gradle / app&uniappx 依赖。
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_base_paths import default_android_esp_work

WORK = Path(os.environ.get("ANDROID_ESP_WORK", default_android_esp_work()))
PROJ = Path(os.environ.get("ANDROID_ESP_PROJECT", str(WORK / "project")))
WT = Path(
    os.environ.get(
        "WT_ROOT",
        str(Path(__file__).resolve().parents[2]),
    )
)
APP_RES = Path(
    os.environ.get(
        "APP_RESOURCES_DIR",
        str(WT / "unpackage/resources/app-android"),
    )
)
COMPILE_SDK = int(os.environ.get("ANDROID_COMPILE_SDK", "34"))

# 蒸汽（vapor/bytecode）模式下，uts→kt 编译器会给插件 index.kt 生成
# `import io.dcloud.uniappxv.runtime.*` 及 UTSCallback.fnJS 桥接访问器。
# 这套 vapor 运行时只在 HBuilderX 的 uniapp-runextension/libVapor/*.jar，
# 不在离线 SDK 的 SDK/libs（那里的 app-runtime/uts-runtime aar 是旧版，
# 无 uniappxv、无 fnJS）。注入时把这些 vapor jar 拷进插件 vapor-libs/ 作 compileOnly，
# 并从 SDK/libs fileTree 排除旧版同名运行时，避免 io.dcloud.uts/* 类重复冲突。
VAPOR_RUNTIME_JARS = [
    "app-runtime-release.jar",
    "uniExtAPI-release.jar",
    "ext-component-release.jar",
    "uts-runtime-release.jar",
]
# SDK/libs 中与 vapor jar 同包(io.dcloud.uniapp/uts/uniappxv)的旧版 aar，须排除防类重复。
VAPOR_SDK_LIBS_EXCLUDE = [
    "app-runtime-release.aar",
    "uts-runtime-release.aar",
]
VAPOR_RUNTIME_SRC = Path(
    os.environ.get(
        "HX_VAPOR_RUNTIME_DIR",
        "/Applications/HBuilderX-Alpha.app/Contents/HBuilderX/plugins/"
        "uniapp-runextension/libVapor",
    )
)


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


def copy_vapor_runtime(mod: Path, uses_vapor: bool) -> None:
    """把 HX libVapor 的 vapor 运行时 jar 拷进插件模块 vapor-libs/（compileOnly）。

    仅 vapor 插件（uses_vapor）才拷贝，避免给非 vapor 插件引入多余依赖。
    """
    if not uses_vapor:
        return
    if not VAPOR_RUNTIME_SRC.is_dir():
        die(f"插件引用 uniappxv 但找不到 vapor 运行时目录: {VAPOR_RUNTIME_SRC}")
    dest = mod / "vapor-libs"
    dest.mkdir(parents=True, exist_ok=True)
    copied = []
    for jar in VAPOR_RUNTIME_JARS:
        src = VAPOR_RUNTIME_SRC / jar
        if src.is_file():
            shutil.copy2(src, dest / jar)
            copied.append(jar)
    if not copied:
        die(f"未从 {VAPOR_RUNTIME_SRC} 拷到任何 vapor 运行时 jar")
    print(f"  ✓ vapor 运行时 → {mod.name}/vapor-libs ({len(copied)} jar)")


def detect_namespace(export_dir: Path) -> str:
    for p in [export_dir / "src" / "index.kt", export_dir / "index.kt"]:
        if p.is_file():
            m = re.search(r"^package\s+([\w.]+)", p.read_text(), re.M)
            if m:
                return m.group(1)
    # fallback from folder name
    name = export_dir.parents[1].name  # uni_modules/{name}/utssdk/app-android
    parts = re.split(r"[-_]", name)
    camel = parts[0] + "".join(x[:1].upper() + x[1:] for x in parts[1:] if x)
    return f"uts.sdk.modules.{camel}"


def detect_min_sdk(export_dir: Path) -> int:
    cfg = export_dir / "config.json"
    if cfg.is_file():
        try:
            data = json.loads(cfg.read_text())
            v = data.get("minSdkVersion", 21)
            return int(v)
        except Exception:
            pass
    return 21


def has_abi_libs(libs: Path) -> bool:
    if not libs.is_dir():
        return False
    for child in libs.iterdir():
        if child.is_dir() and child.name in (
            "armeabi-v7a",
            "arm64-v8a",
            "x86",
            "x86_64",
            "armeabi",
        ):
            return True
    return False


def plugin_uses_vapor(export_dir: Path) -> bool:
    """判断插件源码是否引用 vapor 运行时（io.dcloud.uniappxv）。"""
    for kt in export_dir.rglob("*.kt"):
        try:
            if "io.dcloud.uniappxv" in kt.read_text():
                return True
        except Exception:
            continue
    return False


def write_module_gradle(
    mod: Path,
    namespace: str,
    min_sdk: int,
    jni_from_libs: bool,
    uses_vapor: bool,
) -> None:
    jni_block = ""
    if jni_from_libs:
        jni_block = """
    sourceSets {
        main {
            jniLibs.srcDirs = ['libs']
        }
    }
"""
    # vapor 插件：从 SDK/libs fileTree 排除旧版运行时 aar（与 vapor jar 同包，防类重复）。
    sdk_exclude = ""
    if uses_vapor:
        excludes = ", ".join(f"'**/{n}'" for n in VAPOR_SDK_LIBS_EXCLUDE)
        sdk_exclude = f", exclude: [{excludes}]"
    # vapor 运行时 jar 是 JVM 17 字节码，插件须用 jvmTarget 17 才能 inline，否则
    # 报 “Cannot inline bytecode built with JVM target 17 into bytecode ... 1.8”。
    jvm_target = "17" if uses_vapor else "1.8"
    java_compat = "JavaVersion.VERSION_17" if uses_vapor else "JavaVersion.VERSION_1_8"
    text = f"""plugins {{
    alias(libs.plugins.android.library)
    alias(libs.plugins.jetbrains.kotlin.android)
    id 'io.dcloud.uts.kotlin'
}}

android {{
    namespace '{namespace}'
    compileSdk {COMPILE_SDK}

    defaultConfig {{
        minSdk {min_sdk}
        consumerProguardFiles "consumer-rules.pro"
        ndk {{
            abiFilters "arm64-v8a"
        }}
    }}

    buildTypes {{
        release {{
            minifyEnabled false
            proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        }}
    }}
    compileOptions {{
        sourceCompatibility {java_compat}
        targetCompatibility {java_compat}
    }}
    kotlinOptions {{
        jvmTarget = '{jvm_target}'
    }}{jni_block}
}}

dependencies {{
    compileOnly fileTree(include: ['*.aar'], dir: '../../SDK/libs'{sdk_exclude})
    compileOnly fileTree(include: ['*.aar', '*.jar'], dir: './libs')
    // 蒸汽模式 vapor 运行时（uniappxv / fnJS），由 inject_all_uts_modules 拷贝注入
    compileOnly fileTree(include: ['*.jar'], dir: './vapor-libs')
    compileOnly "com.alibaba:fastjson:1.2.83"
    compileOnly "androidx.core:core-ktx:1.10.1"
    compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-core:1.3.8'
    compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.3.8'
}}
"""
    (mod / "build.gradle").write_text(text)
    (mod / "consumer-rules.pro").write_text("")
    (mod / "proguard-rules.pro").write_text("")


def copy_kotlin_sources(export_dir: Path, mod: Path) -> None:
    java_root = mod / "src/main/java"
    java_root.mkdir(parents=True, exist_ok=True)
    src = export_dir / "src"
    if not src.is_dir():
        src = export_dir

    # 顶层 *.kt
    for kt in src.glob("*.kt"):
        shutil.copy2(kt, java_root / kt.name)

    # 嵌套包路径：src/src/com/... 或 src/com/...
    nested = src / "src"
    if nested.is_dir():
        for kt in nested.rglob("*.kt"):
            rel = kt.relative_to(nested)
            dst = java_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(kt, dst)
    elif (src / "com").is_dir():
        for kt in (src / "com").rglob("*.kt"):
            rel = kt.relative_to(src)
            dst = java_root / rel
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(kt, dst)


def copy_manifest(export_dir: Path, mod: Path) -> None:
    mf = export_dir / "AndroidManifest.xml"
    out = mod / "src/main/AndroidManifest.xml"
    out.parent.mkdir(parents=True, exist_ok=True)
    if mf.is_file():
        text = re.sub(r'\s+package="[^"]*"', "", mf.read_text())
        out.write_text(text)
    else:
        out.write_text(
            '<?xml version="1.0" encoding="utf-8"?>\n'
            '<manifest xmlns:android="http://schemas.android.com/apk/res/android" />\n'
        )


def inject_one(export_dir: Path) -> str:
    plugin_name = export_dir.parents[1].name  # uni_modules/{name}
    gradle_name = f"uts-{plugin_name}"
    mod = PROJ / gradle_name
    namespace = detect_namespace(export_dir)
    min_sdk = detect_min_sdk(export_dir)

    if mod.exists():
        shutil.rmtree(mod)
    (mod / "libs").mkdir(parents=True)
    (mod / "src/main/java").mkdir(parents=True)

    uses_vapor = plugin_uses_vapor(export_dir)

    libs_src = export_dir / "libs"
    jni = has_abi_libs(libs_src)
    if libs_src.is_dir():
        for item in libs_src.iterdir():
            dst = mod / "libs" / item.name
            if item.is_dir():
                shutil.copytree(item, dst)
            else:
                shutil.copy2(item, dst)

    write_module_gradle(mod, namespace, min_sdk, jni, uses_vapor)
    copy_manifest(export_dir, mod)
    copy_kotlin_sources(export_dir, mod)
    # 蒸汽模式：vapor 插件注入 vapor 运行时 jar（compileOnly，含 uniappxv / fnJS）
    copy_vapor_runtime(mod, uses_vapor)

    # 官方：插件 libs 的 aar/jar 也进主模块
    app_libs = PROJ / "app" / "libs"
    app_libs.mkdir(parents=True, exist_ok=True)
    if libs_src.is_dir():
        for item in libs_src.iterdir():
            if item.is_file() and item.suffix in (".aar", ".jar"):
                shutil.copy2(item, app_libs / item.name)

    print(f"✓ {gradle_name}  namespace={namespace} minSdk={min_sdk} jniLibs={jni}")
    return gradle_name


def ensure_settings(modules: list[str]) -> None:
    p = PROJ / "settings.gradle"
    text = p.read_text()
    for name in modules:
        if f"':{name}'" not in text and f'":{name}"' not in text:
            text += f"\ninclude ':{name}'\n"
    p.write_text(text)


def ensure_deps(modules: list[str]) -> None:
    for rel in ("app/build.gradle", "uniappx/build.gradle"):
        p = PROJ / rel
        if not p.is_file():
            continue
        text = p.read_text()
        changed = False
        for name in modules:
            needle = f"implementation project(':{name}')"
            if needle not in text:
                text = text.replace(
                    "dependencies {",
                    f"dependencies {{\n    {needle}",
                    1,
                )
                changed = True
        # app libs fileTree
        if rel.startswith("app/") and "dir: './libs'" not in text and 'dir: "./libs"' not in text:
            text = text.replace(
                "dependencies {",
                "dependencies {\n    implementation fileTree(include: ['*.aar', '*.jar'], dir: './libs')",
                1,
            )
            changed = True
        if changed:
            p.write_text(text)
            print(f"✓ 依赖写入 {rel}")


def main() -> None:
    if not (PROJ / "settings.gradle").is_file():
        die(f"找不到工程 {PROJ}")
    root = APP_RES / "uni_modules"
    if not root.is_dir():
        die(f"找不到 {root}，请先生成本地打包 App 资源")

    modules: list[str] = []
    for plugin in sorted(root.iterdir()):
        export = plugin / "utssdk" / "app-android"
        if not export.is_dir():
            continue
        # 至少有 index.kt 才注入
        if not (export / "src" / "index.kt").is_file() and not (export / "index.kt").is_file():
            print(f"⚠ 跳过无 index.kt: {plugin.name}")
            continue
        modules.append(inject_one(export))

    if not modules:
        die("未发现可注入的 UTS app-android 插件")

    ensure_settings(modules)
    ensure_deps(modules)
    # 供 configure_app 读取
    marker = WORK / "injected-uts-modules.txt"
    marker.write_text("\n".join(modules) + "\n")
    print(f"完成 inject，共 {len(modules)} 个模块 → {marker}")


if __name__ == "__main__":
    main()
