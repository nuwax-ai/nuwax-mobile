# nuwax-uni-math 原生数学公式渲染 — 交接存档（终版）

> 分支 `feat/nuwa-zhuoda-2026.07-native-math`。2026-08-08。本文档供新会话/agent 接手。

## 一句话现状

nuwax-uni-math（原生数学：Android AndroidMath/QuickJS+MathJax+AndroidSVG，iOS iosMath/JSContext+MathJax）已整合进当前分支；Android 公式 native 渲染链路通（全空白已修），但**块级公式显示尺寸还有一个 native logical bug 待修**（超宽公式被压成固定 640 逻辑宽，失真+不横滚），iOS 数学渲染阻塞在自定义基座（需 HBuilderX UI 打含 iosMath pod 的基座）。

## 当前阻塞（按优先级）

### 1. 块级公式尺寸：native logical 固定 640（真因，待修）
`uni_modules/nuwax-uni-math/utssdk/app-android/index.uts` 的 rasterizeSvg（line ~315）：
```ts
const logicalW = (targetW / dpiScale + 0.5).toInt()  // targetW = clamp(natW×dpiScale, BITMAP_MAX_DIM=1600)
result["width"] = logicalW
```
targetW 被 BITMAP_MAX_DIM clamp 到 1600 → logicalW 永远 = 1600/2.5 = **640**（不管 natW 是 1353 还是 6158）。超宽公式真实宽度被压成 640 → katex-el 再 /pixelRatio(~233px) 显示 → 失真 + 不触发横向滚动（640 < 容器宽）。

**修法**：分离 bmp（位图，clamp 防 OOM）与 logical（返回的显示尺寸，不 clamp）：
- bmp = clamp(natW×dpiScale, 1600)（保持，防 OOM）
- logicalW = natW / dpiScale（真实公式逻辑宽，不 clamp）→ 返回给 katex-el
- katex-el（blockLogicalWidth = props.width/pixelRatio）拿到真实宽，超宽触发外层 `.msg-root-math-scroll` scroll-x 横滚，窄公式居中

注意：mathjax SVG viewBox 的 natW 是数学坐标系（\sqrt{2}=1353、\int=6158），不是物理 px。确认 natW/dpiScale 后的 logical 语义（display 1x px），katex-el /pixelRatio 换 dp。可能要调基准（让短公式 ~200-260dp，超宽横滚）。

### 2. 块级公式：左对齐（不居中）+ 仅超宽才横滚
用户明确策略：**图片初始左对齐**（`justify-content:flex-start`，**不居中**）；**只有公式宽度超过屏幕**才横向滚动（外层 scroll-x），窄公式左对齐显示不滚。
- rootStyle（katex-el line ~286）当前 `justify-content:center`（居中）→ 改 `flex-start`（左对齐）；`align-items` 同理左
- 外层 `uni-ai-x-msg.uvue` 的 `.msg-root-math-inner`（min-width:100% + justify-content:center）→ 改 flex-start 左对齐；`.msg-root-math-scroll`（scroll-x）仅当公式 logical 宽 > 容器宽时触发横滚
- 配合阻塞1（native logical = natW/dpiScale 不 clamp）：窄公式 logical < 容器 → 左对齐显示；超宽 logical > 容器 → 横滚

### 3. iOS 数学渲染：阻塞在自定义基座
- iOS 代码修了（index.uts v! 解包 + super.init 内联，崩溃 EXC_BAD_ACCESS 消除）
- 但 iOS 数学渲染报 `undefined class: UTSSDKModulesNuwaxUniMathIndexSwift 请重新打自定义基座` —— 仓库 `make base-ios-simulator` 只编 ESP 插件，**不含 nuwax-uni-math + iosMath pod**
- **解法**：HBuilderX UI → 运行 → 运行到 iOS 模拟器 → 制作自定义基座（编译 nuwax-uni-math + pod install iosMath 0.9.4）。CLI 打不了 iOS 自定义基座（--playground custom 仅云打包）

## 已修复（Android，已 logcat/截图验证）
- **全空白根因**：① `\f` 编译 bug（UTS 把 `\frac` 的 `\f` 当 form-feed 0x0C，用 String.fromCharCode(92) 拼接修）② HBuilderX 增量跳过 nuwax-uni-math 编译（缓存过期→mathRendererCore 缺失）→ `--cleanCache true` 全量重编 + mathDiskCache svg-branch 存 imageDataURL
- **图标方框**：lime-icon readFile /storage 失败（debug 基座 www 在 assets 不落盘）→ `icons-inline.uts`（Map.set 2114 条，避开 import json 类型递归 + 常量池超限）readFile fail fallback 内联（正式包 readFile，debug 内联）
- **iOS 崩溃**：v! 解包 + super.init 内联（旧 framework 缺 iosMath）
- **编译错**：BITMAP_MAX_DIM number→Int、androidsvg Duplicate class（DCloud 模板 Maven，configure_app.py strip）、chat-conversation messageList?.length Number→Boolean、katex-el placeholderStyle UTS 先声明后引用

## 待办（native 侧优化，后续）
- **native dpiScale 几档质量**：当前固定 2.5。改 `mathRenderConfig.bitmapQuality: 'high'|'medium'|'low'` → dpiScale = pixelRatio(high)/平衡(medium)/省内存(low)。rasterizeSvg 读它
- **块级 native logical 修**（见上 阻塞1）
- **iOS UI 自定义基座**（见上 阻塞3）

## 关键约束/坑（UTS，务必遵守）
- **先声明后引用**：uvue 函数/常量必须先定义后引用，computed/异步闭包内也一样（katex-el placeholderStyle 撞过）
- 禁止可选链赋值 `a?.b=v`
- watch getter 显式返回类型 `(): T =>`
- readRawField 要 UTSJSONObject+bracket
- 带三方依赖 uts 插件：cli launch（运行流）撞 error18，用 `make app-resource`（发布流）；base-android 含原生 aar（AndroidMath/quickjs/androidsvg）必须自定义基座

## 验证基建
- `make app-resource && make base-android` → `unpackage/debug/android_debug.apk`
- 红米 `8PNNT4TKHIJVU8RO`：开发者选项→**USB 安装**（开启，需小米账号+SIM）→ adb install 全自动不弹窗；`adb uninstall && adb install`（必须清除重装，否则 splash 卡 Launch timeout）
- `adb logcat | grep MATHSVG` 看 native 链路（renderMathAsync OK / nativeBackend cb / rasterizeSvg natW/natH/logical）
- iOS：HBuilderX UI 制作自定义基座（含 iosMath pod）后跑模拟器

## commit 链（本地未推，分支 native-math）
整合 x-math-latex（Android+iOS+鸿蒙）+ 移除 x-svg-renderer + 改名 + 全空白/尺寸/图标/iOS 崩/编译错修复。`git log --oneline` 看完整链。
