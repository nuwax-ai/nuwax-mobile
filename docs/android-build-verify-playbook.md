# Android 改动 · 编译验证与真机运行 Playbook

> 本仓含**带三方依赖的 UTS 插件**（`nuwax-uni-math` 依赖 `com.caverock:androidsvg`、quickjs），改完 `.uvue/.uts` 后「如何编译验证 + 真机跑」有若干坑。本文记录 2026-08-09 调试 list-view 默认化时踩出的可复用流程。
> 相关：基座维护见 [local-custom-base-maintenance.md](local-custom-base-maintenance.md)；性能验证矩阵见 [perf-verification-plan.md](perf-verification-plan.md)；list-view 迁移见 [perf-list-view-migration.md](perf-list-view-migration.md)；CLAUDE.md「带三方依赖的 UTS 插件集成」。

## 0. 一句话结论

改了业务代码（`pages/`、`subpackages/`、`components/` 下的 `.uvue/.uts`）后：

```bash
make base-android                                                          # 离线 SDK 编译（含三方依赖插件 inject），出 APK
adb -s 8PNNT4TKHIJVU8RO install -r -d unpackage/debug/android_debug.apk    # 直接装机，绕开 HBuilderX 重编
```

**不要用 HBuilderX「运行」按钮**——它会重编 UTS 插件并因三方依赖未解析报 error18。`make base-android` 出的 APK 已自带业务代码（编译进 dex），`adb install` 即跑。

## 1. 三条编译路径对比（决策表）

| 路径 | 命令 | 三方依赖 UTS 插件 | 能验证什么 | 用途 |
|---|---|---|---|---|
| 裸 uni 编译器 | `pnpm uni:build`（`scripts/run-uni-build.sh`） | ❌ **编不过**（error18 找不到名称） | 仅无三方依赖时 | 快速验业务编译（本项目禁用，插件必挂） |
| 出 App 资源 | `make app-resource`（`cli publish appResource`） | ⏸ 不卡（三方依赖留给离线 SDK Gradle） | uvue 完整编译 + `.uts` 解析/类型（但**不跑 UTS→Kotlin 全量类型检查**） | 快速验业务代码语法/类型 |
| 出自定义基座 | `make base-android`（`scripts/android-esp/package_custom_base.sh`，离线 SDK） | ✅ **唯一能完整编过**（inject 脚本把 `config.json` 的 `dependencies` 注入为 `compileOnly`，Gradle 解析 androidsvg） | uvue + **完整 UTS→Kotlin**，产出可独立运行的 APK | 正式验证 + 真机包 |

**结论**：本仓任何改动，最终都以 `make base-android` 为准（它是唯一能完整编译带三方依赖插件、并产出可运行包的路径）。`make app-resource` 适合「秒级快速反馈业务代码有没有低级语法/类型错」；`pnpm uni:build` 在本仓基本无用（必然挂在插件）。

## 2. error18「找不到名称 caverock/SVG/…」根因与解法

**根因**：`nuwax-uni-math/utssdk/app-android/index.uts` 里 `import SVG from 'com.caverock.androidsvg.SVG'`。依赖已声明在 `nuwax-uni-math/utssdk/app-android/config.json`（`"dependencies": ["com.caverock:androidsvg:1.4"]`），但这份 `dependencies` **只在特定路径会被解析为 `compileOnly` 注入到插件编译模块的 classpath**：
- ✅ 离线 SDK 打基座（`make base-android`）——`scripts/android-esp/inject_all_uts_modules.py` 做注入 + Gradle 解析。
- ✅ DCloud 云打包。
- ❌ 裸 uni 编译器（`run-uni-build.sh`）——不注入。
- ❌ HBuilderX「运行」（标准/自定义基座）——走自己的 Gradle，**需【设置-运行配置】配好 Gradle/JDK/Android SDK**，否则 classpath 上没有 androidsvg → error18。

**两条解法**：
1. **绕开（推荐）**：不跑 HBuilderX 运行，直接 `adb install` 离线 SDK 出的基座 APK（见 §0、§4）。零配置。
2. **配 HBuilderX 运行配置**（想让 HBuilderX「运行」也能用）：见 §6 本机已知路径，填到【工具 → 设置 → 运行配置】。

## 3. 关键认知：基座 APK 自带业务代码（在 dex，不是 app-service.js）

uni-app x 的业务 `.uvue/.uts` 编译成 **Kotlin，进 `classes.dex`**，不是 vue2 时代的 `app-service.js`。所以 `make base-android` 出的 `unpackage/debug/android_debug.apk`：
- `assets/apps/__UNI__8BF05E4/www/` 里只有静态资源 + `manifest.json`，**没有 app-service.js 是正常的**；
- 业务逻辑在 `classes*.dex` 里。

**验证你的改动确实进了 APK**（改完装机前的自检）：

```bash
APK=/Users/apple/workspace/nuwax-mobile/unpackage/debug/android_debug.apk
mkdir -p /tmp/apk-probe && cd /tmp/apk-probe && rm -f classes*.dex
unzip -o -q "$APK" 'classes*.dex'
grep -a "<你新增的方法名/属性名>" classes*.dex   # 命中 = 你的代码已编译进包
```

> 例：本次 list-view 改动验证 `scrollToBottomAnchor` / `leafNeedsServiceScroll` / `pulseScrollToBottom` / `useListView` 均在 dex 命中。

## 4. 设备验证工作流（你操作、Agent 盯日志）

**常量**：
- adb：`/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb`（系统未单独装 adb 时用它）
- 包名：`com.nuwax.app`
- 真机：Redmi `8PNNT4TKHIJVU8RO`

```bash
ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb
DEV=8PNNT4TKHIJVU8RO

# 1. 装包（-r 覆盖，-d 允许降级）
$ADB -s $DEV install -r -d unpackage/debug/android_debug.apk        # 输出 Success

# 2. 启动
$ADB -s $DEV shell monkey -p com.nuwax.app -c android.intent.category.LAUNCHER 1
sleep 3
PID=$($ADB -s $DEV shell pidof com.nuwax.app | tr -d '\r')          # 拿 pid；空 = 启动即崩

# 3. 启动崩溃自检
$ADB -s $DEV logcat -d -b crash | grep -iE "com.nuwax|FATAL"        # 空 = 没崩

# 4. 抓全进程日志（测试期间）
: > /tmp/nuwax-test.log
$ADB -s $DEV logcat -v threadtime --pid=$PID > /tmp/nuwax-test.log &   # 后台抓；测完 kill
```

**测试时盯的信号**（事后 `grep /tmp/nuwax-test.log`）：
- 崩溃/回收异常：`FATAL EXCEPTION` / `ANR in` / `AndroidRuntime` / `Recycler` / `tombstone` / `signal 11`（list-view「回收即崩」是历史回滚根因，必须没有）
- 性能：`[PerfProbe] fps=… maxGap=…`、`[SseStall] WARN`（来自 [utils/perfProbe.uts](../utils/perfProbe.uts)）
- 编译残留：`error18` / `找不到名称`（运行期不该再出现）
- 量化汇总：`bash scripts/grab-perf-stats.sh`（解析 logcat 的 fps/maxGap/full_parse/el_stuck/render fail 成表）

> 对比基线（scroll-view，Redmi）：H=100 mixed `fps≈10 / maxGap≈760ms`。list-view 目标 `fps≥25 / maxGap<300`。详见 [perf-verification-plan.md](perf-verification-plan.md)。

## 5. 本次 list-view 默认化的验证矩阵（示例）

`make base-android` → `adb install` 后，按 [perf-list-view-migration.md](perf-list-view-migration.md) / 计划跑：
- **case-c（阻塞用例）**：流式中上滑 3 屏 → 点回到底。验 C1（流式期跳过整表刷新风暴）/ C2（scroll-top 锚点兜底）/ C4（code/mermaid 跟底）。**不过不可交付**。
- case-a 长历史滚动、case-b 连续多轮（验后段性能退化是否消除）、case-d 历史定位、case-e 回收存活（table/code/image）。
- 控制变量：`pages/test-stream-perf`（chips: mdType/H/L/list-view/proxy）+ 页内 perf 浮层实时切。

## 6. 本机已知工具链路径（HBuilderX 运行配置 / 离线 SDK 通用）

均已确认存在：
- **Gradle 8.14.3**：`~/.gradle/wrapper/dists/gradle-8.14.3-bin/*/gradle-8.14.3/bin/gradle`
- **JDK 17**：`/opt/homebrew/opt/openjdk@17`（HBuilderX 自带 corretto 不被 `ensure_env.sh` 认）
- **Android SDK**：`~/workspace/Android/sdk`（**不是**空的 `~/Library/Android/sdk`；需 platforms android-30+ / build-tools 30+）

填到 HBuilderX【工具 → 设置 → 运行配置】后，「运行」也能编三方依赖插件。

## 7. 常见坑

- **CLI 与 HBuilderX UI 同时编译**会争抢 `.app-ios/.uts2js` 缓存 → 非致命 `[plugin:uts] ENOENT` 警告/偶发假错。用户在 UI 调试时别从 CLI 跑编译；反之亦然。
- `run-uni-build.sh` 的 `JDK_PATH` 默认指向**空的** `~/Library/Android/sdk`（命名误导），不要直接信它的默认值。
- **生产会话无 list↔scroll 切换 chip**：perf 浮层（含切换）只在 `test-stream-perf` 激活的 perf-mock 里显示。所以 list-view 上线后若要回退 = 改 `useListView` 默认 + 重编重发，不是点一下能切。
- `app-resource` 过了**不等于**完整编译过：它不跑 UTS→Kotlin 全量类型检查；`.uts` 的完整类型验证要看 `make base-android` 的 `BUILD SUCCESSFUL`。
- adb 装包 `Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE]`：签名不一致（debug/release 混装），先 `adb uninstall com.nuwax.app` 再装。
- 鸿蒙端公式/mermaid 链路不支持（`#ifdef APP` 不含 `APP-HARMONY`），本 playbook 仅适用 Android。
