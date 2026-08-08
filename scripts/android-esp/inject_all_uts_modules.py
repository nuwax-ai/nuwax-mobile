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


def die(msg: str) -> None:
    print(f"✗ {msg}", file=sys.stderr)
    sys.exit(1)


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


def detect_dependencies(export_dir: Path) -> list[str]:
    """读 config.json 的 dependencies（Maven 坐标数组），供模块编译期 compileOnly。

    UTS 插件 index.kt 若 import 了三方包（如 com.caverock.androidsvg），
    该模块自身的 build.gradle 必须声明依赖，否则 compileDebugKotlin 报
    Unresolved reference。打包侧由 app/build.gradle 的 implementation 真正打进 APK。

    坐标归一化：DCloud config.json 约定 artifactId 的 "-aar" 后缀是打包类型提示
    （HBuilderX 生成 app/build.gradle 时同样去掉），真实 Maven artifactId 不含它。
    例如 com.caverock:androidsvg-aar:1.4 → com.caverock:androidsvg:1.4。
    """
    cfg = export_dir / "config.json"
    if cfg.is_file():
        try:
            data = json.loads(cfg.read_text())
            deps = data.get("dependencies", [])
            if isinstance(deps, list):
                out: list[str] = []
                for d in deps:
                    d = str(d).strip()
                    if not d:
                        continue
                    parts = d.split(":")
                    if len(parts) >= 2 and parts[1].endswith("-aar"):
                        parts[1] = parts[1][:-4]
                        d = ":".join(parts)
                    out.append(d)
                return out
        except Exception:
            pass
    return []


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


def write_module_gradle(mod: Path, namespace: str, min_sdk: int, jni_from_libs: bool, extra_deps: list[str] | None = None) -> None:
    jni_block = ""
    if jni_from_libs:
        jni_block = """
    sourceSets {
        main {
            jniLibs.srcDirs = ['libs']
        }
    }
"""
    # 插件 config.json 声明的三方 Maven 依赖 → 模块编译期 compileOnly
    extra_dep_lines = "".join(f'    compileOnly "{d}"\n' for d in (extra_deps or []))
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
        sourceCompatibility JavaVersion.VERSION_1_8
        targetCompatibility JavaVersion.VERSION_1_8
    }}
    kotlinOptions {{
        jvmTarget = '1.8'
    }}{jni_block}
}}

dependencies {{
    compileOnly fileTree(include: ['*.aar'], dir: '../../SDK/libs')
    compileOnly fileTree(include: ['*.aar', '*.jar'], dir: './libs')
    compileOnly "com.alibaba:fastjson:1.2.83"
    compileOnly "androidx.core:core-ktx:1.10.1"
    compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-core:1.3.8'
    compileOnly 'org.jetbrains.kotlinx:kotlinx-coroutines-android:1.3.8'
{extra_dep_lines}}}"""

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
    extra_deps = detect_dependencies(export_dir)

    if mod.exists():
        shutil.rmtree(mod)
    (mod / "libs").mkdir(parents=True)
    (mod / "src/main/java").mkdir(parents=True)

    libs_src = export_dir / "libs"
    jni = has_abi_libs(libs_src)
    if libs_src.is_dir():
        for item in libs_src.iterdir():
            dst = mod / "libs" / item.name
            if item.is_dir():
                shutil.copytree(item, dst)
            else:
                shutil.copy2(item, dst)

    write_module_gradle(mod, namespace, min_sdk, jni, extra_deps)
    copy_manifest(export_dir, mod)
    copy_kotlin_sources(export_dir, mod)

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
