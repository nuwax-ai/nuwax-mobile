#!/usr/bin/env python3
"""
批量生成 ESP 配网三个 framework target 的 project.pbxproj。
模板仿 UTSPluginExample/unimoduleUniGetbatteryinfo（objectVersion 56）。

环境变量：
  IOS_ESP_BUILD_ROOT / UNIAPPX_SDK_ROOT（默认见 scripts/local_base_paths.py → nuwax-mobile-offline-sdk）
"""
import os
import sys
import hashlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from local_base_paths import default_ios_esp_build_root, default_uniappx_ios_sdk

BASE = os.path.expanduser(default_ios_esp_build_root())
SDK_ROOT = os.path.expanduser(default_uniappx_ios_sdk())
SDK_LIBS = os.path.join(SDK_ROOT, "SDK", "Libs")

def uid(seed):
    # 24 位十六进制大写，确定性
    return hashlib.md5(seed.encode()).hexdigest().upper()[:24]

def swift_files(d):
    out = []
    for root, _, files in os.walk(d):
        for f in sorted(files):
            if f.endswith(".swift"):
                out.append(os.path.relpath(os.path.join(root, f), d))
    return sorted(out)

# 通用 build settings（project 级与 target 级）
PROJECT_COMMON = """\t\t\t\tALWAYS_SEARCH_USER_PATHS = NO;
\t\t\t\tCLANG_ANALYZER_NONNULL = YES;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCLANG_ENABLE_OBJC_ARC = YES;
\t\t\t\tCLANG_CXX_LANGUAGE_STANDARD = "gnu++20";
\t\t\t\tCLANG_ENABLE_OBJC_WEAK = YES;
\t\t\t\tCOPY_PHASE_STRIP = NO;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tENABLE_STRICT_OBJC_MSGSEND = YES;
\t\t\t\tENABLE_USER_SCRIPT_SANDBOXING = YES;
\t\t\t\tGCC_C_LANGUAGE_STANDARD = gnu17;
\t\t\t\tGCC_DYNAMIC_NO_PIC = NO;
\t\t\t\tGCC_NO_COMMON_BLOCKS = YES;
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = {proj_deploy};
\t\t\t\tMTL_FAST_MATH = YES;
\t\t\t\tSDKROOT = iphoneos;
\t\t\t\tVERSIONING_SYSTEM = "apple-generic";
\t\t\t\tVERSION_INFO_PREFIX = "";"""

def target_settings(extra, deploy):
    # BUILD_LIBRARY_FOR_DISTRIBUTION 默认 NO：
    # ESPProvision 模块名与类名同名，开 Distribution 会生成坏的 swiftinterface，导致下游无法 import。
    # 需要打 xcframework 时由 build 脚本显式覆盖为 YES（仅对无 ESP 冲突的模块）。
    return """\t\t\t\tBUILD_LIBRARY_FOR_DISTRIBUTION = NO;
\t\t\t\tCLANG_ENABLE_MODULES = YES;
\t\t\t\tCODE_SIGN_STYLE = Automatic;
\t\t\t\tCURRENT_PROJECT_VERSION = 1;
\t\t\t\tDEFINES_MODULE = YES;
\t\t\t\tDYLIB_COMPATIBILITY_VERSION = 1;
\t\t\t\tDYLIB_CURRENT_VERSION = 1;
\t\t\t\tDYLIB_INSTALL_NAME_BASE = "@rpath";
\t\t\t\tENABLE_MODULE_VERIFIER = NO;
\t\t\t\tGENERATE_INFOPLIST_FILE = YES;
\t\t\t\tINFOPLIST_KEY_NSHumanReadableCopyright = "";
\t\t\t\tINSTALL_PATH = "$(LOCAL_LIBRARY_DIR)/Frameworks";
\t\t\t\tIPHONEOS_DEPLOYMENT_TARGET = %s;
\t\t\t\tLD_RUNPATH_SEARCH_PATHS = (
\t\t\t\t\t"$(inherited)",
\t\t\t\t\t"@executable_path/Frameworks",
\t\t\t\t\t"@loader_path/Frameworks",
\t\t\t\t);
\t\t\t\tMACH_O_TYPE = mh_dylib;
\t\t\t\tMARKETING_VERSION = 1.0;
\t\t\t\tMODULEVER_PRODUCT_NAME = "";
\t\t\t\tOTHER_LDFLAGS = "-ObjC";
\t\t\t\tPRODUCT_BUNDLE_IDENTIFIER = com.nuwax.%s;
\t\t\t\tPRODUCT_MODULE_NAME = %s;
\t\t\t\tPRODUCT_NAME = %s;
\t\t\t\tSKIP_INSTALL = YES;
\t\t\t\tSUPPORTS_MACCATALYST = NO;
\t\t\t\tSWIFT_EMIT_LOC_STRINGS = YES;
\t\t\t\tSWIFT_VERSION = 5.0;
\t\t\t\tTARGETED_DEVICE_FAMILY = "1,2";%s""" % (deploy, extra['bid'], extra['modname'], extra['modname'], extra['tail'])

def gen(proj):
    name = proj['name']            # 目录名 & PRODUCT_NAME
    srcdir = os.path.join(BASE, "src", proj['srcdir'])
    umbrella = proj['umbrella']    # umbrella header 文件名
    has_cpp = proj.get('cpp', [])  # 额外 .mm 源
    frameworks = proj.get('frameworks', [])  # (display, path, is_xc)
    tail = proj.get('tail', '')
    deploy = proj.get('deploy', '12.0')
    proj_deploy = '17.4'
    bid = name.lower().replace(' ', '')
    modname = proj.get('module', name)

    swifts = swift_files(srcdir)
    # ID 池
    I = {}
    def g(key):
        if key not in I:
            I[key] = uid(name + "::" + key)
        return I[key]

    pbx = []
    pbx.append("// !$*UTF8*$!\n{\n\tarchiveVersion = 1;\n\tclasses = {\n\t};\n\tobjectVersion = 56;\n\tobjects = {\n")

    # ---- PBXBuildFile ----
    pbx.append("\n/* Begin PBXBuildFile section */")
    bf = []
    bf.append("\t\t%s /* %s in Headers */ = {isa = PBXBuildFile; fileRef = %s /* %s */; settings = {ATTRIBUTES = (Public, ); }; };" % (g('bf-umbrella'), umbrella, g('fr-umbrella'), umbrella))
    for s in swifts:
        bf.append("\t\t%s /* %s in Sources */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };" % (g('bf-'+s), os.path.basename(s), g('fr-'+s), os.path.basename(s)))
    for c in has_cpp:
        bf.append("\t\t%s /* %s in Sources */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };" % (g('bf-'+c), c, g('fr-'+c), c))
        # cpp header as project header
    for disp, path, is_xc in frameworks:
        bf.append("\t\t%s /* %s in Frameworks */ = {isa = PBXBuildFile; fileRef = %s /* %s */; };" % (g('bf-fw-'+disp), disp, g('fr-fw-'+disp), disp))
    pbx += bf
    pbx.append("/* End PBXBuildFile section */\n")

    # ---- PBXFileReference ----
    pbx.append("\n/* Begin PBXFileReference section */")
    fr = []
    fr.append("\t\t%s /* %s.framework */ = {isa = PBXFileReference; explicitFileType = wrapper.framework; includeInIndex = 0; path = %s.framework; sourceTree = BUILT_PRODUCTS_DIR; };" % (g('fr-product'), name, name))
    fr.append("\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = sourcecode.c.h; path = %s; sourceTree = \"<group>\"; };" % (g('fr-umbrella'), umbrella, umbrella))
    for s in swifts:
        fr.append("\t\t%s /* %s */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.swift; path = \"%s\"; sourceTree = \"<group>\"; };" % (g('fr-'+s), os.path.basename(s), s))
    for c in has_cpp:
        ext = 'sourcecode.cpp.objcpp' if c.endswith('.mm') else 'sourcecode.c.h'
        fr.append("\t\t%s /* %s */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = %s; path = %s; sourceTree = \"<group>\"; };" % (g('fr-'+c), c, ext, c))
    for disp, path, is_xc in frameworks:
        ft = 'wrapper.xcframework' if is_xc else 'wrapper.framework'
        fr.append("\t\t%s /* %s */ = {isa = PBXFileReference; lastKnownFileType = %s; name = %s; path = \"%s\"; sourceTree = \"<group>\"; };" % (g('fr-fw-'+disp), disp, ft, disp, path))
    # uts-config.json as resource file (unimodule only)
    if proj.get('config'):
        fr.append("\t\t%s /* uts-config.json */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = text.json; path = \"uts-config.json\"; sourceTree = \"<group>\"; };" % g('fr-config'))
        fr.append("\t\t%s /* UTSOC.h */ = {isa = PBXFileReference; fileEncoding = 4; lastKnownFileType = sourcecode.c.h; path = UTSOC.h; sourceTree = \"<group>\"; };" % g('fr-utsoc-h'))
    pbx += fr
    pbx.append("/* End PBXFileReference section */\n")

    # ---- PBXFrameworksBuildPhase ----
    pbx.append("\n/* Begin PBXFrameworksBuildPhase section */")
    pbx.append("\t\t%s /* Frameworks */ = {\n\t\t\tisa = PBXFrameworksBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (" % g('phase-fw'))
    for disp, path, is_xc in frameworks:
        pbx.append("\t\t\t\t%s /* %s in Frameworks */," % (g('bf-fw-'+disp), disp))
    pbx.append("\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};")
    pbx.append("/* End PBXFrameworksBuildPhase section */\n")

    # ---- PBXGroup ----
    pbx.append("\n/* Begin PBXGroup section */")
    pbx.append("\t\t%s = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (" % g('grp-main'))
    pbx.append("\t\t\t\t%s /* %s */," % (g('grp-src'), proj['srcdir']))
    pbx.append("\t\t\t\t%s /* Products */," % g('grp-products'))
    if frameworks:
        pbx.append("\t\t\t\t%s /* Frameworks */," % g('grp-fw'))
    pbx.append("\t\t\t);\n\t\t\tsourceTree = \"<group>\";\n\t\t};")
    # src group
    pbx.append("\t\t%s /* %s */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (" % (g('grp-src'), proj['srcdir']))
    pbx.append("\t\t\t\t%s /* %s */," % (g('fr-umbrella'), umbrella))
    for s in swifts:
        pbx.append("\t\t\t\t%s /* %s */," % (g('fr-'+s), os.path.basename(s)))
    for c in has_cpp:
        pbx.append("\t\t\t\t%s /* %s */," % (g('fr-'+c), c))
    if proj.get('config'):
        pbx.append("\t\t\t\t%s /* uts-config.json */," % g('fr-config'))
        pbx.append("\t\t\t\t%s /* UTSOC.h */," % g('fr-utsoc-h'))
    pbx.append("\t\t\t);\n\t\t\tpath = %s;\n\t\t\tsourceTree = \"<group>\";\n\t\t};" % proj['srcdir'])
    # products group
    pbx.append(
        f"\t\t{g('grp-products')} /* Products */ = {{\n"
        f"\t\t\tisa = PBXGroup;\n"
        f"\t\t\tchildren = (\n\t\t\t\t{g('fr-product')} /* {name}.framework */,\n\t\t\t);\n"
        f"\t\t\tname = Products;\n"
        f"\t\t\tsourceTree = \"<group>\";\n"
        f"\t\t}};")
    if frameworks:
        pbx.append("\t\t%s /* Frameworks */ = {\n\t\t\tisa = PBXGroup;\n\t\t\tchildren = (" % g('grp-fw'))
        for disp, path, is_xc in frameworks:
            pbx.append("\t\t\t\t%s /* %s */," % (g('fr-fw-'+disp), disp))
        pbx.append("\t\t\t);\n\t\t\tname = Frameworks;\n\t\t\tsourceTree = \"<group>\";\n\t\t};")
    pbx.append("/* End PBXGroup section */\n")

    # ---- PBXHeadersBuildPhase ----
    pbx.append("\n/* Begin PBXHeadersBuildPhase section */")
    hdrs = ["\t\t\t\t%s /* %s in Headers */," % (g('bf-umbrella'), umbrella)]
    if proj.get('config'):
        # UTSOC.h 需要作为 project header 参与编译（UTSOC.mm import）
        hdrs.append("\t\t\t\t%s /* UTSOC.h in Headers */," % g('bf-utsoc-h'))
    pbx.append("\t\t%s /* Headers */ = {\n\t\t\tisa = PBXHeadersBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n%s\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};" % (g('phase-hdr'), "\n".join(hdrs)))
    pbx.append("/* End PBXHeadersBuildPhase section */\n")

    # ---- PBXNativeTarget ----
    pbx.append("\n/* Begin PBXNativeTarget section */")
    phases = [g('phase-hdr'), g('phase-src'), g('phase-fw')]
    if proj.get('config'):
        phases.append(g('phase-res'))
    phase_labels = ['Headers', 'Sources', 'Frameworks', 'Resources'][:len(phases)]
    phase_lines = ",\n".join("\t\t\t\t%s /* %s */" % (ph, lbl) for ph, lbl in zip(phases, phase_labels))
    pbx.append(
        f"\t\t{g('target')} /* {name} */ = {{\n"
        f"\t\t\tisa = PBXNativeTarget;\n"
        f"\t\t\tbuildConfigurationList = {g('cfgl-target')} /* Build configuration list for PBXNativeTarget \"{name}\" */;\n"
        f"\t\t\tbuildPhases = (\n{phase_lines},\n\t\t\t);\n"
        f"\t\t\tbuildRules = (\n\t\t\t);\n"
        f"\t\t\tdependencies = (\n\t\t\t);\n"
        f"\t\t\tname = {name};\n"
        f"\t\t\tproductName = {name};\n"
        f"\t\t\tproductReference = {g('fr-product')} /* {name}.framework */;\n"
        f"\t\t\tproductType = \"com.apple.product-type.framework\";\n"
        f"\t\t}};")
    pbx.append("/* End PBXNativeTarget section */\n")

    # ---- PBXProject ----
    pbx.append("\n/* Begin PBXProject section */")
    pbx.append(
        f"\t\t{g('project')} /* Project object */ = {{\n"
        f"\t\t\tisa = PBXProject;\n"
        f"\t\t\tattributes = {{\n"
        f"\t\t\t\tBuildIndependentTargetsInParallel = 1;\n"
        f"\t\t\t\tLastUpgradeCheck = 1530;\n"
        f"\t\t\t\tTargetAttributes = {{\n"
        f"\t\t\t\t\t{g('target')} = {{\n"
        f"\t\t\t\t\t\tCreatedOnToolsVersion = 15.3;\n"
        f"\t\t\t\t\t\tLastSwiftMigration = 1530;\n"
        f"\t\t\t\t\t}};\n"
        f"\t\t\t\t}};\n"
        f"\t\t\t}};\n"
        f"\t\t\tbuildConfigurationList = {g('cfgl-project')} /* Build configuration list for PBXProject \"{name}\" */;\n"
        f"\t\t\tcompatibilityVersion = \"Xcode 14.0\";\n"
        f"\t\t\tdevelopmentRegion = en;\n"
        f"\t\t\thasScannedForEncodings = 0;\n"
        f"\t\t\tknownRegions = (\n\t\t\t\ten,\n\t\t\t\tBase,\n\t\t\t);\n"
        f"\t\t\tmainGroup = {g('grp-main')};\n"
        f"\t\t\tproductRefGroup = {g('grp-products')} /* Products */;\n"
        f"\t\t\tprojectDirPath = \"\";\n"
        f"\t\t\tprojectRoot = \"\";\n"
        f"\t\t\ttargets = (\n\t\t\t\t{g('target')} /* {name} */,\n\t\t\t);\n"
        f"\t\t}};")
    pbx.append("/* End PBXProject section */\n")

    # ---- PBXResourcesBuildPhase (unimodule) ----
    if proj.get('config'):
        pbx.append("\n/* Begin PBXResourcesBuildPhase section */")
        pbx.append("\t\t%s /* Resources */ = {\n\t\t\tisa = PBXResourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n\t\t\t\t%s /* uts-config.json in Resources */,\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};" % (g('phase-res'), g('bf-config')))
        pbx.append("/* End PBXResourcesBuildPhase section */\n")
        # add PBXBuildFile for uts-config + utsoc-h
        pbx.insert(0, "")  # noop

    # ---- PBXSourcesBuildPhase ----
    pbx.append("\n/* Begin PBXSourcesBuildPhase section */")
    srcs = []
    for s in swifts:
        srcs.append("\t\t\t\t%s /* %s in Sources */," % (g('bf-'+s), os.path.basename(s)))
    for c in has_cpp:
        srcs.append("\t\t\t\t%s /* %s in Sources */," % (g('bf-'+c), c))
    pbx.append("\t\t%s /* Sources */ = {\n\t\t\tisa = PBXSourcesBuildPhase;\n\t\t\tbuildActionMask = 2147483647;\n\t\t\tfiles = (\n%s\n\t\t\t);\n\t\t\trunOnlyForDeploymentPostprocessing = 0;\n\t\t};" % (g('phase-src'), "\n".join(srcs)))
    pbx.append("/* End PBXSourcesBuildPhase section */\n")

    # ---- XCBuildConfiguration ----
    pbx.append("\n/* Begin XCBuildConfiguration section */")
    for cfg in ['Debug', 'Release']:
        dbg = cfg == 'Debug'
        p_common = PROJECT_COMMON.replace('{proj_deploy}', proj_deploy)
        if dbg:
            p_common += "\n\t\t\t\tDEBUG_INFORMATION_FORMAT = dwarf;\n\t\t\t\tENABLE_TESTABILITY = YES;\n\t\t\t\tGCC_OPTIMIZATION_LEVEL = 0;\n\t\t\t\tGCC_PREPROCESSOR_DEFINITIONS = (\n\t\t\t\t\t\"DEBUG=1\",\n\t\t\t\t\t\"$(inherited)\",\n\t\t\t\t);\n\t\t\t\tMTL_ENABLE_DEBUG_INFO = INCLUDE_SOURCE;\n\t\t\t\tONLY_ACTIVE_ARCH = YES;"
        else:
            p_common += "\n\t\t\t\tDEBUG_INFORMATION_FORMAT = \"dwarf-with-dsym\";\n\t\t\t\tENABLE_NS_ASSERTIONS = NO;\n\t\t\t\tMTL_ENABLE_DEBUG_INFO = NO;\n\t\t\t\tVALIDATE_PRODUCT = YES;"
        pbx.append("\t\t%s /* %s */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n%s\n\t\t\t};\n\t\t\tname = %s;\n\t\t};" % (g('cfg-proj-'+cfg), cfg, p_common, cfg))

    extra = {'bid': bid, 'modname': modname, 'tail': tail}
    for cfg in ['Debug', 'Release']:
        dbg = cfg == 'Debug'
        tset = target_settings(extra, deploy)
        if dbg:
            tset += "\n\t\t\t\tSWIFT_OPTIMIZATION_LEVEL = \"-Onone\";"
        pbx.append("\t\t%s /* %s */ = {\n\t\t\tisa = XCBuildConfiguration;\n\t\t\tbuildSettings = {\n%s\n\t\t\t};\n\t\t\tname = %s;\n\t\t};" % (g('cfg-tgt-'+cfg), cfg, tset, cfg))
    pbx.append("/* End XCBuildConfiguration section */\n")

    # ---- XCConfigurationList ----
    pbx.append("\n/* Begin XCConfigurationList section */")
    pbx.append(
        f"\t\t{g('cfgl-project')} /* Build configuration list for PBXProject \"{name}\" */ = {{\n"
        f"\t\t\tisa = XCConfigurationList;\n"
        f"\t\t\tbuildConfigurations = (\n\t\t\t\t{g('cfg-proj-Debug')} /* Debug */,\n\t\t\t\t{g('cfg-proj-Release')} /* Release */,\n\t\t\t);\n"
        f"\t\t\tdefaultConfigurationIsVisible = 0;\n"
        f"\t\t\tdefaultConfigurationName = Release;\n"
        f"\t\t}};")
    pbx.append(
        f"\t\t{g('cfgl-target')} /* Build configuration list for PBXNativeTarget \"{name}\" */ = {{\n"
        f"\t\t\tisa = XCConfigurationList;\n"
        f"\t\t\tbuildConfigurations = (\n\t\t\t\t{g('cfg-tgt-Debug')} /* Debug */,\n\t\t\t\t{g('cfg-tgt-Release')} /* Release */,\n\t\t\t);\n"
        f"\t\t\tdefaultConfigurationIsVisible = 0;\n"
        f"\t\t\tdefaultConfigurationName = Release;\n"
        f"\t\t}};")
    pbx.append("/* End XCConfigurationList section */\n")

    pbx.append("\t};\n\trootObject = " + g('project') + " /* Project object */;\n}\n")

    # 处理 unimodule 额外 buildfile 条目（uts-config.json resource + UTSOC.h header）
    content = "\n".join(pbx)
    if proj.get('config'):
        extra_bf = "\t\t%s /* uts-config.json in Resources */ = {isa = PBXBuildFile; fileRef = %s /* uts-config.json */; };\n\t\t%s /* UTSOC.h in Headers */ = {isa = PBXBuildFile; fileRef = %s /* UTSOC.h */; };" % (g('bf-config'), g('fr-config'), g('bf-utsoc-h'), g('fr-utsoc-h'))
        content = content.replace("/* End PBXBuildFile section */", extra_bf + "\n/* End PBXBuildFile section */")

    projdir = os.path.join(BASE, name, name + ".xcodeproj")
    os.makedirs(projdir, exist_ok=True)
    with open(os.path.join(projdir, "project.pbxproj"), "w") as f:
        f.write(content)
    # Xcode 组 path=$srcdir 相对工程目录，需把源码拷到 $BASE/$name/$srcdir/
    dest_src = os.path.join(BASE, name, proj["srcdir"])
    if os.path.abspath(srcdir) != os.path.abspath(dest_src):
        import shutil
        if os.path.isdir(dest_src):
            shutil.rmtree(dest_src)
        shutil.copytree(srcdir, dest_src)
        print("  ↳ 源码已同步到 %s" % dest_src)
    print("✓ 生成 %s.xcodeproj (%d swift, %d cpp, %d frameworks)" % (name, len(swifts), len(has_cpp), len(frameworks)))

ABS = SDK_LIBS
# 官方对齐：优先 SDK/Libs/DCloudUTSExtAPI（由 TemporarySample 规范化拷贝）
EXTAPI_FW = os.path.join(ABS, "DCloudUTSExtAPI.xcframework")
if not os.path.isdir(EXTAPI_FW):
    EXTAPI_FW = os.path.join(SDK_ROOT, "TemporarySampleFramework", "DCloudUTSExtAPI.xcframework")

frameworks_dcloud = [
    ("DCloudUniappRuntime.xcframework", os.path.join(ABS, "DCloudUniappRuntime.xcframework"), True),
    ("DCloudUTSFoundation.xcframework", os.path.join(ABS, "DCloudUTSFoundation.xcframework"), True),
    ("DCloudUTSExtAPI.xcframework", EXTAPI_FW, True),
]
OUT = os.path.join(BASE, "out")
# 官方本地链：优先使用无 BUILD_LIBRARY_FOR_DISTRIBUTION 编出的 .framework（避免 ESPProvision 模块/类同名 swiftinterface 崩）
# 设置 IOS_ESP_FRAMEWORKS_DIR 指向含 ESPProvision.framework / SwiftProtobuf.framework 的目录
ESP_FW_DIR = os.environ.get(
    "IOS_ESP_FRAMEWORKS_DIR",
    os.path.join(BASE, "official", "build", "frameworks-iphoneos"),
)
esp_fw = os.path.join(ESP_FW_DIR, "ESPProvision.framework")
spb_fw = os.path.join(ESP_FW_DIR, "SwiftProtobuf.framework")
if os.path.isdir(esp_fw) and os.path.isdir(spb_fw):
    frameworks_esp_for_unimodule = [
        ("ESPProvision.framework", esp_fw, False),
        ("SwiftProtobuf.framework", spb_fw, False),
    ]
    esp_search = ESP_FW_DIR
else:
    frameworks_esp_for_unimodule = [
        ("ESPProvision.xcframework", os.path.join(OUT, "ESPProvision.xcframework"), True),
        ("SwiftProtobuf.xcframework", os.path.join(OUT, "SwiftProtobuf.xcframework"), True),
    ]
    esp_search = OUT

if not os.path.isdir(os.path.join(BASE, "src")):
    print(f"✗ 缺少源码目录 {BASE}/src（需含 SwiftProtobuf / ESPProvision / unimoduleNuwaxEspProvisioning）", file=sys.stderr)
    sys.exit(1)

print(f"IOS_ESP_BUILD_ROOT={BASE}")
print(f"UNIAPPX_SDK_ROOT={SDK_ROOT}")

gen({'name': 'SwiftProtobuf', 'srcdir': 'SwiftProtobuf', 'umbrella': 'SwiftProtobuf.h', 'module': 'SwiftProtobuf'})
# ESPProvision 依赖同目录编出的 SwiftProtobuf.framework（勿用带坏 swiftinterface 的 xcframework）
spb_for_esp = spb_fw if os.path.isdir(spb_fw) else os.path.join(OUT, "SwiftProtobuf.xcframework")
spb_is_xc = not os.path.isdir(spb_fw)
gen({'name': 'ESPProvision', 'srcdir': 'ESPProvision', 'umbrella': 'ESPProvision.h', 'module': 'ESPProvision',
     'deploy': '13.0',
     'frameworks': [("SwiftProtobuf.framework" if not spb_is_xc else "SwiftProtobuf.xcframework", spb_for_esp, spb_is_xc)],
     'tail': '\n\t\t\t\tBUILD_LIBRARY_FOR_DISTRIBUTION = NO;\n\t\t\t\tFRAMEWORK_SEARCH_PATHS = (\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t\t"' + esp_search + '",\n\t\t\t\t);'})
gen({'name': 'unimoduleNuwaxEspProvisioning', 'srcdir': 'unimoduleNuwaxEspProvisioning', 'umbrella': 'unimoduleNuwaxEspProvisioning.h',
     'module': 'unimoduleNuwaxEspProvisioning', 'cpp': ['UTSOC.mm'], 'config': True,
     'deploy': '13.0',
     'frameworks': frameworks_dcloud + frameworks_esp_for_unimodule,
     'tail': '\n\t\t\t\tBUILD_LIBRARY_FOR_DISTRIBUTION = NO;\n\t\t\t\tENABLE_MODULE_VERIFIER = NO;\n\t\t\t\tFRAMEWORK_SEARCH_PATHS = (\n\t\t\t\t\t"$(inherited)",\n\t\t\t\t\t"' + esp_search + '",\n\t\t\t\t\t"' + ABS + '",\n\t\t\t\t);'})
print("完成")
print(f"ESP frameworks dir: {esp_search} (exists={os.path.isdir(esp_search)})")
