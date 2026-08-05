#!/usr/bin/env python3
"""与 scripts/local-base-env.sh 对齐的 Python 默认路径（nuwax-mobile-offline-sdk）。"""
from __future__ import annotations

import os
from pathlib import Path


def offline_home() -> Path:
    return Path(
        os.environ.get(
            "NUWAX_OFFLINE_SDK_HOME",
            os.path.expanduser("~/workspace/nuwax-mobile-offline-sdk"),
        )
    )


def hx_version() -> str:
    return os.environ.get("NUWAX_HX_VERSION", "5.23")


def android_sdk_build() -> str:
    return os.environ.get("NUWAX_ANDROID_SDK_BUILD", "14987")


def default_uniappx_ios_sdk() -> str:
    if v := os.environ.get("UNIAPPX_SDK_ROOT"):
        return v
    ver = hx_version()
    return str(offline_home() / "sdk" / "ios" / ver / f"UniAppX-iOS@{ver}")


def default_ios_esp_build_root() -> str:
    return os.environ.get(
        "IOS_ESP_BUILD_ROOT", str(offline_home() / "work" / "ios")
    )


def default_android_esp_work() -> str:
    return os.environ.get(
        "ANDROID_ESP_WORK", str(offline_home() / "work" / "android")
    )


def default_demo_pbx() -> str:
    if v := os.environ.get("UNIAPPX_DEMO_PBXPROJ"):
        return v
    return str(
        Path(default_uniappx_ios_sdk())
        / "UniAppXDemo"
        / "UniAppXDemo.xcodeproj"
        / "project.pbxproj"
    )
