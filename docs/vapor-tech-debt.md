# vapor（蒸汽模式）正式上线交接手册

> **目标产物**：一个**干净、纯粹、可正式上线**的 vapor Android 包（最终走 `scripts/android-esp/build_store_release.sh`，正式签名 + aab/apk + 生产环境 API）。
> **读者**：接手这些任务的工程师 / agent。
> **当前状态（2026-08-06 复核）**：Android vapor 离线打包**主体已完成**，能稳定出 debug/release 内测包（release APK 148M，今日 12:34 实测出包）。多数原列技术债已闭环，仅剩正式签名上线、uni-stat 产品确认、iOS vapor 三项。下面各节已标注实际进度。
>
> **进度总览**：
> | 节 | 项 | 状态 |
> |---|---|---|
> | §1 | vapor 运行时注入 | ✅ 已提交（`2f659fe4`） |
> | §2 | 包瘦身（剥 HelloUniAppX 演示） | ✅ 已完成（206M→148M，`502ec0a1`/`bcb7befd`） |
> | §3 | CSS 样式坍塌 | ⚠️ 已近下限（2745→**176**；残差=伪类 `:last-child`/`:active` + 第三方 uni_modules，BEM 修不动） |
> | §4.1 | 下载进公共 Downloads | ✅ 已恢复（`bc3c200f` nuwax-android-downloads 插件） |
> | §4.2 | notice-bar 跑马灯 | ✅ 已恢复（scroll-view + JS translateX 重写） |
> | §4.3 | BigDecimal 精度 | ⚠️ 仍降级（低优；在 lime-* 第三方，随 v4 升级解决） |
> | §5 | uni-stat 统计 | ⏳ 待产品确认 |
> | §6 | 正式签名上线 | ⏳ 待做（上线最后一公里） |
> | §7 | iOS vapor 基座 | ⏳ 未开始 |
> | §8 | 独立 vapor APK 卡启动屏 | 🔴 path-a 死胡同；等 DCloud 提供 vapor-runtime aar(含资源)；当前 vapor 仅 HX 自定义基座形态可跑 |
> | §9 | 运行时遗漏（实跑发现） | ⚠️ 进行中（9.1 iconfont 图标不显示——已修待验；其它待补） |

---

## 0. 环境基线（先核对，错了后面全错）

| 项 | 值 | 验证 |
|---|---|---|
| 分支 | 工作分支 `feat/nuwa-zhuoda-2026.07-vapor`；正式发布须 `release/nuwa-zhuoda`（`build_store_release.sh:95` 强校验，可用 `ALLOW_NON_RELEASE_BRANCH=1` 绕过仅验包） | `git branch --show-current` |
| HBuilderX | **Alpha `5.23.2026080313-alpha`**（不是稳定版 5.15）。CLI：`/Applications/HBuilderX-Alpha.app/Contents/MacOS/cli` | `cli --version` |
| Android 离线 SDK | `Android-uni-app-x-SDK@14987-5.23`（须与 HX 严格配套） | `ls ~/workspace/nuwax-mobile-offline-sdk/sdk/android/5.23/` |
| manifest | `uni-app-x: { vapor:true, styleIsolationVersion:"2", vapor-render-target:"bytecode" }` | `python3 -c "import json;print(json.load(open('manifest.json'))['uni-app-x'])"` |
| 密钥 | `$NUWAX_SIGNING_HOME/local-secrets.env`（由同目录 `.example` 生成；仅本地 Git）含 `DCLOUD_APPKEY` + `ANDROID_RELEASE_*` 等 | 见 `docs/pre-release-checklist.md` |
| JDK | gradle 用 Android Studio JBR：`export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"` | 无系统 java，必须设 |
| Android SDK | `~/workspace/Android/sdk` 含 `platforms;android-36` | `ls ~/workspace/Android/sdk/platforms` |

**打包命令**（内测 / 正式两条）：
```bash
export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
source scripts/local-base-env.sh        # 优先 source $NUWAX_SIGNING_HOME/local-secrets.env

# 内测包（debug 签名，test 环境，快速验证）
SKIP_APP_RESOURCE=1 bash scripts/android-esp/build_tester_release_apk.sh

# 正式包（release 签名 nuwax-release.jks，production 环境，出 apk+aab）—— 上线用这个
bash scripts/android-esp/build_store_release.sh
```

**两条出包流水线**（理解结构再动手）：
1. `make app-resource`（HX CLI `publish app --type appResource`）→ 产出 `unpackage/resources/app-android/`（vapor 业务编译成 `__UNI__8BF05E4/www/app-service.js` + `bytes/*.bytes` 字节码，**业务不落 .kt**；仅 3 个 uts 插件落 .kt）。
2. gradle 组装离线基座：`sync_local_pack_resources.sh`（资源进工程）→ `inject_all_uts_modules.py`（uts 插件 → gradle 模块 + vapor 运行时注入）→ `configure_app.py`（包名/appid/签名/资源注入）→ `gradlew assembleRelease`。

---

## 1. 关键机制：vapor 运行时注入（✅ 已解决并提交）

uts 插件（esp/pay/cmark）在 vapor 下编译需要 `io.dcloud.uniappxv.runtime.*` + `fnJS`，**离线 SDK 的 `SDK/libs/*.aar` 没有**，只在 HBuilderX 的 `plugins/uniapp-runextension/libVapor/*.jar`。已通过 `inject_all_uts_modules.py` 注入解决。

**已提交**（commit `2f659fe4 fix(vapor): 提交蒸汽模式工具链改动`），从干净仓库可复现，无需手动 `git add`。下面三条是注入机制说明（留作原理备查）：
- `inject_all_uts_modules.py`：`plugin_uses_vapor()` 检测插件 → 拷 libVapor 四件套进 `uts-{name}/vapor-libs/` + `compileOnly fileTree(vapor-libs)` + 从 SDK/libs 排除旧版 `app-runtime/uts-runtime-release.aar`（376 类重叠防 Duplicate）+ jvmTarget 提到 17。
- `configure_app.py`：`strip_uniappx_demo_sources()` 删 uniappx 演示 kt 树 + `strip_project_deps` 剥示例兄弟模块依赖 + `relocate_main_activity()` 把入口改为 `UniAppXSDK.start(...)`（见 §2，包瘦身已落地）。
- `set_app_resource_api_env.py`：API 地址替换目标从旧 `uniappx/app-android/src/index.kt` 改为 vapor 的 `__UNI__*/www/app-service.js`。

---

## 2. 包瘦身（✅ 已完成：206M → 148M）

> **已完成**（commit `502ec0a1 feat(vapor): 恢复包瘦身——剥离 HelloUniAppX 演示模块与 uniappx 演示源码树`、`bcb7befd` 裁 canvas aar）。机制：`configure_app.py` 的 `strip_uniappx_demo_sources()` 删 `uniappx/src/main/java/{index.kt,pages,components,uni_modules,node-modules,uniCloud}` 演示树，`relocate_main_activity()` 把入口改为 `UniAppXSDK.start(...)`。运行时按 appid 从 `app-service.js` 启动，不依赖演示 `index.kt` 符号。当前 release APK **148M**。下面留作背景与回退参考。

**原问题**：vapor 下 `uniappx` 模块的 `index.kt`（35908 行官方胶水）静态引用 HelloUniAppX 演示 App 全部代码，早期为出包全量保留致 ~206MB——现已剥离，业务在字节码里，与演示零耦合。

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

## 3. 样式坍塌重构（✅ 已近下限：2745 → 176）

> **进度**：经多轮 BEM 反嵌套（commits `804044ce`/`3517886c`/`09dd4328`/`f4c997f5` 等）已从 ~2745 条降到 **176 条**（2026-08-06 实测）。后代/复合选择器基本清完，**残差 176 条已非 BEM 可治**：~112 条是伪类（`:last-child`×64、`:active`×34、`:focus-within`×6 等——vapor 根本丢弃，需模板 `:class` 状态绑定逐处改；`:active`/`:hover` 属可放弃的渐进增强），~112 条在第三方 uni_modules（lime-* ≈64 等 v4 升级、uni-ai-x ≈48 走上游）。继续 SCSS 反嵌套收益已很低；若要再降，仅针对业务代码 `:last-child` 做模板状态类，第三方随 [[vapor-lime-alignment-plan]] / lime v4 解决。

**问题（背景）**：vapor styleIsolation 2.0（**官方强制，无 1.0 可选**）不支持以下 CSS，相关规则**整条丢弃**（非警告是真丢）：
- 后代选择器 `.a .b`、复合选择器 `.a.b`（**已基本清完**）
- 伪类 `:last-child`/`:active`/`:focus-within`/`:hover`（**残差主体，vapor 不支持**）
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

| # | 位置 | 原降级 | 用户影响 | 状态 |
|---|---|---|---|---|
| 4.1 | `subpackages/utils/fileTree.uts` | 删 `copyToPublicDownload()` + `java.io.File`/`android.os.Environment`，下载只返回 `res.tempFilePath` | 下载文件不进系统「下载/Downloads」 | ✅ **已恢复**——新增 uts 插件 `uni_modules/nuwax-android-downloads`，`fileTree.uts:632` 调 `copyToPublicDownload(tempFilePath, filename)`（commit `bc3c200f`） |
| 4.2 | `uni_modules/uni-notice-bar/.../uni-notice-bar.vue` | 删 weex/`$getAppWebview`/CSS 动画跑马灯 | 长通告文本不滚动 | ✅ **已恢复**——vapor 下改用 `scroll-view` + JS 驱动 `transform: translateX` 实现跑马灯（组件 25–45 行） |
| 4.3 | `uni_modules/lime-color/common/util.uts`、`uni_modules/lime-shared/floatMul/index.ts` | `java.math.BigDecimal` 改 `` `${n}` `` 模板串 | 大数/科学计数法精度不准（普通小数无碍） | ⚠️ **仍降级**（低优；在 lime-* 第三方，随 [[vapor-lime-alignment-plan]] v4 升级解决，不手改） |

**4.1 恢复参考**（下载进公共目录）：新建/复用一个 uts 插件封装 `MediaStore`/`Environment` 拷贝，fileTree.uts 改为调插件接口。

---

## 5. uni-stat 统计确认

随 §2 全量保留进包。它是 DCloud 官方统计插件，被 uniappx `index.kt` 引用：`app.use(uniStat)` + app 启动/前后台/错误四处 `uni_report` 上报。**需产品确认是否保留这套统计**；不要则在 §2 做最小 index.kt 时一并删除引用。

---

## 6. 正式签名上线（最后一步）

前置全部完成后：
1. 确认 `$NUWAX_SIGNING_HOME/local-secrets.env` 的 `ANDROID_RELEASE_*` 指向正式 jks（默认 `$NUWAX_SIGNING_HOME/android/nuwax-release.jks`，alias `nuwax-release`）。
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

---

## 8. 独立 vapor APK 卡启动屏根因 + path-a 结论（2026-08-06 实测）

真机/模拟器装离线独立 APK（`build_tester_release_apk.sh`）卡启动屏。HX 自定义基座能跑、独立 APK 不能。根因链（已逐一验证）：

```
运行时反射 uni.UNI8BF05E4.UniAppConfig 引导 app
  → 找不到（vapor 不生成 kt）✅ 已修：configure_app.py generate_uni_app_config()
    → 运行时再找 uni.UNI8BF05E4.IndexKt
      → 找不到 ✅ 已放存根：generate_index_kt_stub()
        → 运行时再调 IndexKt.main(UniNativeApp)
          → NoSuchMethod（main 调 createApp()=createSSRApp(GenAppClass)）
            → GenAppClass（app 组件）在 vapor 下是字节码，Kotlin 无法引用 → 🔴 桥接硬核
```

**核心矛盾**：vapor 离线基座的运行时是 VDOM 风格，要一整套 Kotlin app 脚手架（UniAppConfig/IndexKt/main/createApp/GenAppClass）；vapor 把业务放字节码、**不生成这些 kt**。HX 自定义基座能自动生成/桥接，离线独立 APK 不能。

### path-a 两条路都已验证不可行
1. **手写最小 index.kt**（main/createApp/GenAppClass）→ GenAppClass 在字节码里，Kotlin 没法引用，桥接机制 DCloud 未文档化。
2. **注入 vapor 运行时到主 app**（`inject_vapor_runtime_into_app()`，commit `2b0bc8d4`，函数保留但已注释停用）→
   - libVapor 的 `uniExtAPI/ext-component` jar 是**聚合 jar**，与 SDK/libs 的 `uni-push`/`uni-accelerometer` 等单独 aar 类重叠 → Duplicate class。
   - 只换 `app-runtime`/`uts-runtime` 两个核心 jar + 排除 VDM 同名 aar → 排除 aar 后**丢 Android 资源**（`style/UniAppX.Activity.DefaultTheme` 等），vapor jar 只有类没 res/ → manifest 链接失败。

### 根因（DCloud 离线 SDK 限制）
vapor 运行时（libVapor）**只有 jar（纯类）**；离线 SDK 的 **aar（类+资源）是 VDM 版**。**没有"vapor 运行时 aar（含 Android 资源）"。** 独立 vapor APK 要加载，需 DCloud 在离线 SDK 里提供 vapor-runtime aar（带 res/）。

### 结论
- **能跑的 vapor app = HX 自定义基座**（`make base-android` 出基座 + HX「运行到自定义基座」，业务改动在 www 热推）。所有 vapor 业务改动（§2-§4 + BEM/aar/UTSAndroid/图标/滚动）在此形态下生效并验证。
- **独立离线 vapor APK**：等 DCloud 提供 vapor-runtime aar（含资源），或 path-a（手写 Kotlin↔字节码桥接）有突破。在此之前不可用。
- 排查路径见记忆 [[vapor-uniappconfig-required]]（含完整根因链 + path-a 死胡同）。

---

## 9. 运行时遗漏（vapor 自定义基座实跑发现，2026-08-06 起）

> 形态：HX 自定义基座（§8 结论里当前唯一能跑的 vapor 形态）已能进业务页，但实跑暴露一批渲染/资源遗漏。逐条记此。

### 9.0 通用根因：styleIsolation 2.0 默认 `isolated` 隔绝全局/页面样式（官方文档印证）

[官方 vapor 文档](https://doc.dcloud.net.cn/uni-app-x/app-vapor.html)「开发注意·css」明确：styleIsolation 2.0 下「**组件默认不受外部 css 同名影响，不管是页面还是全局 css，外部的同名 class 默认都不能影响组件样式**」，默认值 `isolated`，可设 `app` / `app-and-page`。故凡组件依赖全局/页面样式（字体、主题色、通用类 `.iconfont` 等）的，vapor 下都会丢样式——**§9 各项「遗漏」大概率同源**。

- **官方修法**：组件 `<script setup>` 加 `defineOptions({ styleIsolation: 'app-and-page' })`（或 `'app'`）即可重新接收外部同名 class。
- **替代（更可控）**：把所需样式内联或挪进组件 scoped（不依赖外部透传）。
- 排查 §9 各项优先按此判断：症状是"样式/图标/主题没生效" → 先看组件是不是吃了全局样式 → 是则 `defineOptions` 或内联。

> 同源官方约束（均见该页）：运行时只支持简单 class + 分组选择器（后代/复合被丢，即 §3 BEM 的根因）；Android uvue 页面不能直接调原生 API，须挪进 uts 插件（即 §4 的根因）；仅组合式、不支持选项式/mixin（即附 A 移出 uni_modules 的根因）；scroll-view/swiper 布尔属性默认 true→false（notice-bar 已显式 `:scroll-x="true"`）；flatten 元素不支持 background-image。

### 9.1 iconfont 图标大面积不显示（高优，影响 54 处 svg-icon）——已修待验

**症状**：vapor 基座进页面后，页面内 `<svg-icon>` 图标（nav/按钮/tab 等，共 54 处）全部不显示 / 变豆腐块。

**机制**：APP 端图标 = `components/svg-icon/svg-icon.uvue` 渲染为 `<text class="iconfont">{{ unicodeChar }}</text>`，靠 iconfont 字体的 unicode 文本出 glyph：
- 字体 `static/iconfont/iconfont.ttf`（已存在、已进资源包）；`@font-face` + `.iconfont{font-family:"iconfont"!important}` 在 `static/iconfont/iconfont-app.css`，由 `App.uvue:187` 全局 `@import`。
- unicode 映射：`constants/iconfont.constants.uts` 的 `ICON_UNICODE`（如 `icon-order→""`）。
- svg-icon 自身 scoped 样式只有 `.svg-icon{display:flex}`，`iconStyle` 内联只给 font-size/color——**两处都没有 font-family**，完全依赖全局 `.iconfont`。

**根因**：vapor styleIsolation 2.0 下全局 App 样式（`.iconfont{font-family}`）透传不进 svg-icon 组件 → `<text>` 拿不到字体 → unicode 用默认字体 = 空白。drops 日志里 `.iconfont`/font-family 未被丢，印证是**样式隔离透传**问题，非选择器丢失。

**已修（待实机/模拟器验证）**：`svg-icon.uvue` 的 `iconStyle` 内联追加 `font-family: iconfont`（内联不受样式隔离影响）。业务代码改动，**不用重打基座**，HX 自定义基座热推 www 即可验。

**若仍未恢复**（fallback）：vapor 可能没注册 CSS `@font-face` → `App.uvue` onLaunch 用 `uni.loadFontFace({ global:true, family:"iconfont", source:"url('/static/iconfont/iconfont.ttf')" })` 显式注册字体。

**关联**：[[vapor-style-bem-methodology]]（全局类透传同源问题）、`custom-nav-bar.uvue:185` 已有同类 vapor icon 选择器处理记录。

### 9.2 薄壳页（组件作页面根）不撑满高度——已修

**症状**：智能体 tab（`pages/agent-list/agent-list.uvue`）+ 应用页（`pages/page-app/page-app.uvue`）没撑满视口，塌成内容高度。

**定位**：两页都是薄壳——模板仅 `<published-agent-list>`，页面根即该组件。组件根 `.container` 的 `height:100%/max-height:100%` 写在 `#ifdef H5` 分支，**`#ifdef MP-WEIXIN || APP` 分支只有 padding-bottom、无任何 flex/height**。vapor/APP 下组件 host 不带高度、APP 分支又没 height → 组件根无尺寸 → 塌成内容高。（VDOM APP 时代靠默认行为蒙混，vapor 暴露。）

**根因类别**：非样式隔离（区别于 §9.0），是**条件编译只给 H5 height、APP 分支漏 flex** 的 latent bug。

**已修**：`published-agent-list.uvue` 的 `.container` 在 `MP-WEIXIN || APP` 分支加 `flex: 1`（页面是 flex column，flex 子项不依赖 host 高度解析，最稳）。两处薄壳页一并修。业务代码改动，热推 www 即可验。

**排查口诀**：页面没撑满 → 看页面根是不是自定义组件 → 看组件根 scoped 的 height/flex 是不是只写在 H5 分支、APP 分支漏了 → 补 `flex: 1`（APP 页面默认是 flex column）。

### 9.3 其它遗漏（待随实跑补充）
> 跑起来陆续发现的渲染/功能问题记在此（症状→定位→修法），量多再拆子节。

---

## 附 D：vapor 官方开发约束摘要（权威参考）

> 来源：https://doc.dcloud.net.cn/uni-app-x/app-vapor.html （2026-08-06 抓取）
> 条件编译：`// #ifdef VUE3-VAPOR` 是蒸汽模式专属条件。

### D.1 CSS（styleIsolation 2.0 强制）
- **只支持简单 class 选择器 + 分组选择器**；后代 `.a .b`、复合 `.a.b`、伪类 `:last-child`/`:active`/`:focus-within`/`:hover` 运行时**整条丢弃**（非警告）。
- 替代：BEM `.parent__child`；SCSS 是编译时方案，不影响运行时。
- **styleIsolation 默认 `isolated`**：组件不受外部同名 class 影响。如需受影响，`<script setup>` 内 `defineOptions({ styleIsolation: 'app' | 'app-and-page' })`。
- 不支持的值：`em`、`display:inline`、`%` font-size、`color:inherit`、`max-height:none/%`。

### D.2 uvue 原生 API（uts plugin）
- **uvue 页面/纯 uts 文件不能用 `java.*`/`android.*` 原生 import**（含 `UTSAndroid`）。
- 挪进 uts 插件（`uni_modules/*/utssdk/app-android/`，插件内可正常用原生 import）。
- 第三方 .ts/.uts 也受此限（如 lime-shared、uni-ai-x 的 `UTSAndroid.getDispatcher`），用 `#ifdef VUE3-VAPOR` 分支绕。

### D.3 组件变更
- **布尔属性默认值 `true`→`false`**：scroll-view `scroll-y`、swiper 等——必须显式 `:scroll-y="true"`。
- **list-view**：v-for 必须有 `:key`；list-item + list-view 同文件；第一个 v-for+`:key` 才回收，其余降级为 view；不支持横向滚动；list-item 宽 100%/position absolute/不能直接文字/不能 margin。
- **flatten（view/text/image）**：`<view flatten>` 不创建独立元素；不支持事件/takeSnapshot/部分 css。
- 不再支持 uts 兼容模式组件，仅 uts 标准模式（native-view）。

### D.4 编译目标
- **字节码（bytecode，默认）**：5.11+，编译快、支持差量/wgt 热更新，性能比机器码低 ~3%。
- 机器码：性能略高，编译极慢（C 编译），iOS 云打包不开放。
- manifest：`vapor:true, styleIsolationVersion:"2", vapor-render-target:"bytecode"`。

### D.5 OS 版本
- Android 6.0+，默认 target 36（vapor 专属）；iOS 15+；鸿蒙 API 20+（6.0+）。

### D.6 从 VDOM 升级 vapor 步骤（官方）
1. 复杂选择器 → 简单 class/分组。
2. 开 styleIsolation 2.0，改造（三方组件核对支持）。
3. 原生 API（含 UTSAndroid）→ uts 插件。
4. 选项式 → 组合式（setup）。
5. manifest 切 vapor，按"开发注意"检查。
