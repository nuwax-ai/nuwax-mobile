# vapor（蒸汽模式）正式上线交接手册

> **目标产物**：一个**干净、纯粹、可正式上线**的 vapor Android 包（最终走 `scripts/android-esp/build_store_release.sh`，正式签名 + aab/apk + 生产环境 API）。
> **读者**：接手这些任务的工程师 / agent。
> **当前状态**：本地自定义基座已能打 vapor **内测包**（debug 签名、test 环境、含全部官方演示代码、样式坍塌）。本手册列出从「能出包」到「能上线」的全部剩余工作。

---

## 0. 环境基线（先核对，错了后面全错）

| 项 | 值 | 验证 |
|---|---|---|
| 分支 | 工作分支 `feat/nuwa-zhuoda-2026.07-vapor`；正式发布须 `release/nuwa-zhuoda`（`build_store_release.sh:95` 强校验，可用 `ALLOW_NON_RELEASE_BRANCH=1` 绕过仅验包） | `git branch --show-current` |
| HBuilderX | **Alpha `5.23.2026080313-alpha`**（不是稳定版 5.15）。CLI：`/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli` | `cli --version` |
| Android 离线 SDK | `Android-uni-app-x-SDK@14987-5.23`（须与 HX 严格配套） | `ls ~/workspace/nuwax-mobile-offline-sdk/sdk/android/5.23/` |
| manifest | `uni-app-x: { vapor:true, styleIsolationVersion:"2", vapor-render-target:"bytecode" }` | `python3 -c "import json;print(json.load(open('manifest.json'))['uni-app-x'])"` |
| 密钥 | `scripts/local-secrets.env`（**gitignored，绝不入库**）含 `DCLOUD_APPKEY` + `ANDROID_RELEASE_*` 五项 | 见 `docs/pre-release-checklist.md` |
| JDK | gradle 用 Android Studio JBR：`export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` | 无系统 java，必须设 |
| Android SDK | `~/workspace/Android/sdk` 含 `platforms;android-36` | `ls ~/workspace/Android/sdk/platforms` |

**打包命令**（内测 / 正式两条）：
```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
source scripts/local-base-env.sh        # 自动 source local-secrets.env

# 内测包（debug 签名，test 环境，快速验证）
SKIP_APP_RESOURCE=1 bash scripts/android-esp/build_tester_release_apk.sh

# 正式包（release 签名 nuwax-release.jks，production 环境，出 apk+aab）—— 上线用这个
bash scripts/android-esp/build_store_release.sh
```

**两条出包流水线**（理解结构再动手）：
1. `make app-resource`（HX CLI `publish app --type appResource`）→ 产出 `unpackage/resources/app-android/`（vapor 业务编译成 `__UNI__8BF05E4/www/app-service.js` + `bytes/*.bytes` 字节码，**业务不落 .kt**；仅 3 个 uts 插件落 .kt）。
2. gradle 组装离线基座：`sync_local_pack_resources.sh`（资源进工程）→ `inject_all_uts_modules.py`（uts 插件 → gradle 模块 + vapor 运行时注入）→ `configure_app.py`（包名/appid/签名/资源注入）→ `gradlew assembleRelease`。

---

## 1. 关键机制：vapor 运行时注入（已解决，改动未提交，先提交！）

uts 插件（esp/pay/cmark）在 vapor 下编译需要 `io.dcloud.uniappxv.runtime.*` + `fnJS`，**离线 SDK 的 `SDK/libs/*.aar` 没有**，只在 HBuilderX 的 `plugins/uniapp-runextension/libVapor/*.jar`。已通过 `inject_all_uts_modules.py` 注入解决。

**⚠️ 第一件事：以下工具链改动尚未提交，接手后先提交，否则下次从干净仓库无法复现：**
```bash
git add scripts/android-esp/configure_app.py \
        scripts/android-esp/inject_all_uts_modules.py \
        scripts/android-esp/set_app_resource_api_env.py \
        docs/vapor-tech-debt.md   # 本文件
```
- `inject_all_uts_modules.py`：`plugin_uses_vapor()` 检测插件 → 拷 libVapor 四件套进 `uts-{name}/vapor-libs/` + `compileOnly fileTree(vapor-libs)` + 从 SDK/libs 排除旧版 `app-runtime/uts-runtime-release.aar`（376 类重叠防 Duplicate）+ jvmTarget 提到 17。
- `configure_app.py`：`SAMPLE_MODULES` 清空 + `configure_settings` 不再剥示例 include（见 §2）。
- `set_app_resource_api_env.py`：API 地址替换目标从旧 `uniappx/app-android/src/index.kt` 改为 vapor 的 `__UNI__*/www/app-service.js`。

---

## 2. 包瘦身（干净纯粹的核心，必做）

**问题**：vapor 下 `uniappx` 模块的 `index.kt`（35908 行官方胶水）**静态引用了 HelloUniAppX 演示 App 的全部代码**，剥离就编译断链。当前为出包**全量保留**了官方示例，导致包 ~206MB 且带无用功能。**这些对 vapor 业务毫无作用**（业务在字节码里）。

**要删的演示内容**（都在 `uniappxnativepackage/uniappx/src/main/java/`）：
- 演示页 `pages/{API,CSS,component,tabBar,template,uni-ui}/**`，共 **487 个 kt**
- native-view 示例 `pages/component/native-view/`、`pages/template/native-button-bridge/`
- 演示插件（`uni_modules/` 下）：`native-button`、`native-time-picker`、`test-native-view`、`test-image-path`、`uni-openLocation`、`uni-pay-x`、`uni-link-x`、`uni-upgrade-center-app`、`uni-badge-view`、`uni-collapse-x`、`uni-drag-cell`、`uni-fab-button`、`uni-index-bar`、`uni-nav-bar-x`、`uni-number-box-x`、`uni-rate-x`、`uni-recycle-view`、`uni-refresh-box`、`uni-tab-bar`、`uni-time-format`
- 顶层示例模块（settings.gradle）：`test-invoke-network-api`、`uni-getbatteryinfo`、`uts-openSchema`、`uts-progressNotification`、`app-comm`、`uts-get-native-view`、`uni-stat`、`uts-button`、`uni-usercapturescreen`、`uts-worker`、`test-native-view`

**做法**（推荐路径）：
1. 研究 vapor 下 uniappx 主模块的**最小必需集**——只保留 vapor 运行时启动所需的框架胶水，生成一个不引用任何演示页的**最小 index.kt**。
2. 删除上述演示 kt，恢复 `configure_app.py` 的 `SAMPLE_MODULES` 剥离逻辑（含 settings include + build.gradle 依赖双向剥离）。
3. 重新 `make app-resource` + `make base-android` 验证。

**⚠️ 关键陷阱**：样式会编译进字节码 `bytes/*.style.bytes`（131 个），页面路由在 `app-service.js`。**删除演示页后必须重新导资源**，否则字节码/资源与 index.kt 不一致。这条最容易踩。

**验收**：
```bash
# 包体积显著下降，且无演示页残留
ls -la unpackage/debug/android_release.apk
unzip -l unpackage/debug/android_release.apk | grep -iE "native-view|HelloUniAppX" # 应无输出
```

---

## 3. 样式坍塌重构（功能正确性，必做）

**问题**：vapor styleIsolation 2.0（**官方强制，无 1.0 可选**）不支持以下 CSS，相关规则**整条丢弃**（非警告是真丢），本次编译丢 **2731 条** → 页面样式坍塌：
- 后代选择器 `.a .b`、复合选择器 `.a.b`
- `em` 单位、`display:inline`、百分比 `font-size`、`inherit` 颜色、`max-height:none/100%`

**官方建议**：`.parent .child` → BEM `.parent__child`；SCSS 编译时方案可用。文档：https://doc.dcloud.net.cn/uni-app-x/css/common/style-isolation.html

**定位待改规则**：每次编译日志里 `[plugin:uni:app-uvue-css] Invalid selector "..."` 逐条列出被丢规则及文件:行号。重跑 `make app-resource`（或 `pnpm uni:build`）即可重新生成清单。

**范围**：集中在 `pages/`、`subpackages/` 的 chat / login / file-preview 等 uvue 业务页。

**验收**：重编译后 `Invalid selector` / `Unsupported` 警告数降为 0（或仅剩经确认可接受的），真机/UI 走查样式恢复。

### 3b. lime 三方组件的 vapor 样式（随上一起做）
`lime-*` 组件有 14 条同类警告（`l-badge`/`l-button`/`l-cascader`/`l-loading`/`l-tabs` 等，如 `background: var(--l-badge-dot-color)` 动态背景、l-tabs 动画容器）。处理方式同上，或对组件加 `defineOptions({ styleIsolation: 'app-and-page' })` 放开隔离。

---

## 4. 功能性降级恢复（vapor 原生 import 限制）

**根因**：vapor 下 uvue/纯 uts 文件**不能用 `java.*`/`android.*` 原生 import**（5.23 蒸汽 SDK Rollup 无法解析）。本轮为出包移除了以下系统能力调用。**恢复统一做法：把原生调用挪进 uts 插件**（`uni_modules/*/utssdk/app-android/` 下插件可正常用原生 import；官方明确 vapor 下 uvue 页面不能直接调原生 API）。

| # | 位置 | 删了什么 | 用户影响 | 恢复优先级 |
|---|---|---|---|---|
| 4.1 | `subpackages/utils/fileTree.uts` | `copyToPublicDownload()` 整个函数 + `java.io.File`/`android.os.Environment`；下载直接返回 `res.tempFilePath`（约 line 634） | **下载文件不进系统「下载/Downloads」**，只在沙盒临时目录，用户找不到、可能被清理 | **高** |
| 4.2 | `uni_modules/uni-notice-bar/.../uni-notice-bar.vue` | weex/`$getAppWebview`/CSS 动画跑马灯 | 长通告文本不再滚动，单行截断 | 中 |
| 4.3 | `uni_modules/lime-color/common/util.uts`、`uni_modules/lime-shared/floatMul/index.ts` | `java.math.BigDecimal`，改用 `` `${n}` `` 模板串 | 大数/科学计数法精度不准（普通小数无碍） | 低 |

**4.1 恢复参考**（下载进公共目录）：新建/复用一个 uts 插件封装 `MediaStore`/`Environment` 拷贝，fileTree.uts 改为调插件接口。

---

## 5. uni-stat 统计确认

随 §2 全量保留进包。它是 DCloud 官方统计插件，被 uniappx `index.kt` 引用：`app.use(uniStat)` + app 启动/前后台/错误四处 `uni_report` 上报。**需产品确认是否保留这套统计**；不要则在 §2 做最小 index.kt 时一并删除引用。

---

## 6. 正式签名上线（最后一步）

前置全部完成后：
1. 确认 `scripts/local-secrets.env` 的 `ANDROID_RELEASE_*` 指向正式 `nuwax-release.jks`（本机 `~/workspace/nuwax-signing/android/nuwax-release.jks`，alias `nuwax-release`）。
2. 切到 `release/nuwa-zhuoda` 分支（或 `ALLOW_NON_RELEASE_BRANCH=1` 仅验包）。
3. `bash scripts/android-esp/build_store_release.sh` → 出 `unpackage/release/` 下 **正式签名** apk + aab（production API）。
4. 按 `docs/pre-release-checklist.md` 做发布前清理（确认无密钥/调试残留）。

---

## 7. 暂缓项

- **iOS vapor 基座**：本轮只做 Android。iOS 需离线 SDK + Xcode 26.3（`UniappRuntime` 是 Swift 6.2.4 二进制，26.6 太新硬拒）+ 真机签名/自定义基座。见记忆 [[ios-offline-base-xcode-version]]。

---

## 附 A：被移出的 uni_modules 包
- 备份：`~/workspace/nuwax-mobile-vapor-unused-unimodules-20260805/`，含 `uni-transition`、`uni-file-picker`、`x-tools`。
- 移出原因：vapor 编译期选项式 `<script>` 报错；已确认 `pages/subpackages/components` **零业务引用**。
- 恢复：需先转 `<script setup>` 再移回。

## 附 B：执行顺序建议（依赖关系）
```
①提交工具链改动(§1) → ②包瘦身(§2) → ③样式重构(§3) → ④功能恢复(§4) → ⑤uni-stat确认(§5) → ⑥正式签名(§6)
```
- ②③可并行（②动基座结构，③动业务样式），但**②做完必须重导资源**再做③的样式验证，避免基于旧字节码判断。
- ④的 fileTree 下载恢复建议尽早（影响真实用户体验）。
- ⑥必须在 ②③④⑤全部完成、内测包验证通过后执行。

## 附 C：常用验证命令
```bash
# 单编某个 uts 插件（快速验证 vapor 注入/编译）
cd ~/workspace/nuwax-mobile-offline-sdk/work/android/Android-uni-app-x-SDK@14987-5.23/uniappxnativepackage
./gradlew :uts-nuwax-esp-provisioning:compileReleaseKotlin --console=plain

# 统计当前编译丢弃的 CSS 规则数
SKIP_APP_RESOURCE=0 bash scripts/android-esp/build_tester_release_apk.sh 2>&1 | grep -c "Invalid selector"

# 查 APK 包名/版本
~/workspace/Android/sdk/build-tools/*/aapt dump badging unpackage/debug/android_release.apk | grep -E "package:|versionName"
```
