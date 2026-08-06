# vapor（蒸汽模式）已知问题与处理方案归档

> 2026-08 将 nuwax-mobile 移植到 vapor（HBuilderX-Alpha 5.23 + uni-app-x SDK@14987-5.23）实战踩坑汇总。**遇到新渲染/编译异常，先按此对号入座。** 配套记忆：`vapor-offline-base-runtime` / `vapor-style-isolation-blocks-global` / `vapor-template-gotchas` / `lime-v4-acquisition-gated` / `vapor-style-bem-methodology`。

---

## A. 打包工具链

### A1. 下错 SDK 包（legacy uni-app vs uni-app x）
- **症状**：`Android-SDK@5.23.xxxxx_xxxxxx.zip` 解压后是 `lib.5plus` / `uniapp-v8`（WebView 运行时），编译 uni-app x 项目失败。
- **根因**：DCloud 有两条 SDK 线，下载页各一个：`Android-SDK@` = 旧版 uni-app/5+；`Android-uni-app-x-SDK@<build>-<ver>` = uni-app x（`app-runtime-release`/`framework-release`）。nuwax 是 uni-app x（827 个 .uvue/.uts），只能用后者。
- **修法**：用 `Android-uni-app-x-SDK@14987-5.23`（与 HBuilderX-Alpha 5.23.2026080313-alpha 配套）。判断口诀：看 `SDK/libs` 运行时 aar 名，不看版本号。
- **排查信号**：包里有 `lib.5plus.base-release.aar` / `uniapp-v8-release.aar` → 下错线。

### A2. vapor 运行时缺失（uts 插件报 uniappxv / fnJS / JVM17）
- **症状**：uts 插件（esp/pay/cmark）`compileReleaseKotlin` 连环报 `Unresolved reference 'uniappxv'` / `'fnJS'` / `Cannot inline bytecode built with JVM target 17`。
- **根因**：vapor 运行时（`io.dcloud.uniappxv.runtime.*` + `fnJS`）**只在 HBuilderX 的 `plugins/uniapp-runextension/libVapor/*.jar`**，离线 SDK 的 `SDK/libs/*.aar` 是旧版（无 uniappxv）。vapor jar 是 JVM17 字节码。
- **修法**（已落地 `scripts/android-esp/inject_all_uts_modules.py`，commit `2f659fe4`）：`plugin_uses_vapor()` 检测插件引用 uniappxv → 拷 libVapor 四件套进 `uts-{name}/vapor-libs/` + `compileOnly fileTree(vapor-libs)` + 排除 SDK/libs 旧版 `app-runtime/uts-runtime-release.aar`（376 类重叠防 Duplicate）+ 插件 `jvmTarget 17`。
- **排查信号**：编译错含 `uniappxv` / `fnJS` / `JVM target 17`。

### A3. CLI × UI 并发编译缓存竞争
- **症状**：CLI 跑 `make app-resource` 时报错行号对不上文件内容（如 CSS 错报在模板行）、`[plugin:uts] ENOENT`、幽灵 `Method not implemented`。
- **根因**：HBuilderX CLI 与 UI 同时编译争抢 `.uts2js` / `.app-ios` 缓存。
- **修法**：**用户在 UI 调试时别从 CLI 跑编译**；以 UI 编译结果为准。

---

## B. 样式（styleIsolation 2.0）

### B1. 全局样式不进组件（iconfont/工具类/主题丢失）— **最大一类**
- **症状**：iconfont 图标大面积空白、`.h-full/.flex/.flex-1/.relative` 等全局工具类失效、主题色没生效。
- **根因**：vapor styleIsolation 2.0 默认 `isolated`——**组件默认不受外部（全局/页面）同名 css 影响**。官方文档 app-vapor.html「开发注意·css」。
- **修法**（已统一应用，commit `d1486aeb`）：88 个业务组件加 `defineOptions({ styleIsolation: 'app' })`（放开接收全局样式；官方无项目级开关，只能逐组件）。个别组件若还缺「页面级」样式，单独升 `'app-and-page'`。
- **排查信号**：vapor 下"样式/图标/主题没生效" → 看组件是否吃了全局样式 → 是则 defineOptions 或内联。
- **区别**：这是 isolation scope（简单 class 选择器没丢但全局同名 class 不透传），不同于 B2（选择器整条被丢）。

### B2. CSS 选择器被丢（BEM / 伪类）
- **症状**：样式坍塌，部分规则不生效。
- **根因**：vapor styleIsolation 2.0 运行时**只支持简单 class + 分组选择器**；后代 `.a .b`、复合 `.a.b`、伪类 `:last-child`/`:active`/`:focus-within`/`:hover` 整条**静默丢弃**（非警告是真丢）。nuwax 从 ~2745 条降到 176（残差=伪类 + 第三方 uni_modules）。
- **修法**：SCSS 反嵌套为顶层单类（BEM `.parent__child`），通用子类 rename `parent__child` + 同步模板。伪类（`:last-child`/`:active`）需模板 `:class` 状态绑定，`:active`/`:hover` 属可放弃渐进增强。第三方 lime/uni-ai-x 走上游升级。
- **排查**：`make app-resource 2>&1 | grep "Invalid selector"` 看 drops 清单 + 文件:行号。
- **验收**：`grep -c "Invalid selector"` 归零（或仅剩经确认可接受）。

### B3. iconfont 图标不显示（font-family 透传问题）
- **症状**：`<svg-icon>` 图标（54 处）空白/豆腐块。
- **根因**：APP 端图标 = `<text class="iconfont">{{unicode}}</text>`，`font-family:"iconfont"` 只在全局 `App.uvue → iconfont-app.css`，styleIsolation 2.0 下透传不进 svg-icon 组件。drops 日志里 `.iconfont`/font-family 没被丢，印证是隔离透传。
- **修法**：`svg-icon.uvue` 的 `iconStyle` 内联 `font-family: iconfont`（内联不受隔离影响）。或组件 defineOptions 'app'（B1）。
- **关联**：B1 的典型案例。

### B4. 薄壳页（组件作页面根）不撑满高度
- **症状**：智能体 tab / 应用页（模板仅一个子组件）塌成内容高度。
- **根因**：组件根 `.container` 的 `height:100%` 只写在 `#ifdef H5` 分支，`#ifdef APP` 分支无 flex/height。vapor/APP 下组件 host 不带高度 → 塌。
- **修法**：组件根 APP 分支加 `flex: 1`（页面是 flex column，flex 子项不依赖 host 高度解析）。

### B5. 页面背景非白
- **症状**：会话页等背景透灰。
- **根因**：vapor 默认页背景非白；页根没显式 `background-color`（VDOM 时代靠默认白底）。
- **修法**：页根显式 `background-color: #ffffff`（其它主 tab 都有，个别页漏）。

---

## C. 模板编译

### C1. 多行 v-if / v-else-if 不求值 — **隐蔽**
- **症状**：`v-if="` 换行后才写条件的分支，整段不渲染（条件不求值）。radio/select 共用一个多行 `v-else-if` → 都不渲染（易误判为数据问题）。
- **根因**：vapor 编译器不正确求值**多行属性值**的 v-if。单行 `v-if="a || b && c"` 正常。
- **修法**：压成单行；或把条件挪进 `<script setup>` 函数（如 `isRadioLike(field): boolean`），模板 `v-if="fn(x)"`。
- **排查**：python 扫 `v-(else-)?(if|show)\s*=\s*"` 后本行 `"` 数 < 2。

### C2. `<text>` 内嵌 `<text v-if>` 丢外层文本
- **症状**：`<text class="label">{{label}}<text v-if="required">*</text></text>` → required 时 label 整条消失。
- **根因**：vapor 下 `<text>` 内嵌带 `v-if` 的 `<text>`，外层文本丢失。
- **修法**：内联表达式 `<text>{{ label }}{{ required ? '*' : '' }}</text>`；或拆兄弟节点（view 内平级两个 text，可各自设色，如红色必填星号）。

### C3. stray `}`（BEM 反嵌套遗留，致命编译错）
- **症状**：`Error: unmatched "}"`，编译失败。
- **根因**：SCSS 反嵌套（B2）时漏删嵌套层闭合括号。
- **修法**：删多余 `}`。
- **排查**：python 逐行算 style 段括号深度（深度变负处即多余 `}`）。注意排除 JS 里 `'<style'` 字符串、`content:"{"` 的误报。

---

## D. 组件 / 第三方

### D1. lime 组件全崩（getDrawableContext + l-icon）— **整类移除**
- **症状**：`Error: Method not implemented. at UniViewElementImpl2.getDrawableContext`，渲染 watcher 崩 → 整卡（含同卡非 lime 部分）都不渲染。或 `[lime-icon getFileSystemManager] No such file` 崩。
- **根因**：lime 0.x 用 **Drawable API** 渲染（`getDrawableContext()`：lime-style/hairline 画边框、lime-loading spinner、l-checkbox 对勾、l-button 经 hairline）；vapor **未实现 getDrawableContext**（官方 TODO）。且 `import lCascader` 等在**模块加载即触发 lime-icon 读 `icons.json`**（www 里缺）→ 崩。
- **修法**：**vapor 下把 lime 组件换成原生**（`<view>+<text>+svg-icon`+`:class` 状态；spinner 用 vapor 安全的 spin-loading）。已 de-lime：`mcp-ask-question-card`（l-button/l-checkbox）、`acp-permission-card`（l-button）、`new-conversation-set`（l-cascader 移除，待原生 picker）。**业务代码不直接调 getDrawableContext**（全在 uni_modules/lime-* 内），故 de-lime 业务文件即消除该错。
- **排查信号**：`Method not implemented at ...getDrawableContext` 或 `lime-icon getFileSystemManager` → 找当前屏的 `<l-` 标签。
- **注**：lime-v4（官方 vapor 兼容版）源码非公开，对齐延后（记忆 `lime-v4-acquisition-gated`）。

### D2. 原生 `<radio>` 偏大
- **症状**：radio 控件比预期大。
- **修法**：`<radio class="..." color="#1677ff">` + CSS `transform: scale(0.7)`（行高紧可用 wrapper view 固定高度）。

### D3. App.uvue 生命周期混写（编译错）
- **症状**：`[vue/compiler-sfc] Unexpected token` 在 `onShow:` 等。
- **根因**：onLaunch(() => {...}) 里混入 options 式 `onShow: function()` / `onHide:` / `onLastPageBackPress:`（options→composition 转换没做干净）+ 重复块。
- **修法**：重写为干净 composition hook（`onLaunch`/`onShow`/`onHide`/`onLastPageBackPress` 各自独立 `(() => {})`，去重）。用标准 `onShow`/`onHide`（非 `onAppShow`）。

---

## E. 排查通用口诀

1. **样式/图标没生效** → styleIsolation（B1）/ 选择器被丢（B2）。
2. **整段不渲染（无报错）** → 多行 v-if（C1）/ 嵌套 text（C2）。
3. **Method not implemented / lime-icon 崩** → lime（D1），找 `<l-`。
4. **编译 unmatched }** → BEM stray `}`（C3）。
5. **uts 插件 uniappxv/fnJS** → libVapor 注入（A2）。
6. **幽灵报错行号对不上** → CLI×UI 缓存竞争（A3），以 UI 为准。

---

## F. vapor 基线环境

- HBuilderX-Alpha `5.23.2026080313-alpha`（非稳定版）
- Android 离线 SDK `Android-uni-app-x-SDK@14987-5.23`（与 HX 严格配套）
- manifest：`uni-app-x: { vapor:true, styleIsolationVersion:"2", vapor-render-target:"bytecode" }`
- 打包：`make app-resource`（HX）→ `make base-android`（gradle 离线基座）；vapor 业务编成 `app-service.js` 字节码，业务不落 .kt
- 自定义基座 S3 分发：`make base-publish --flavor vapor --no-latest`（详见 `docs/custom-base-distribution-s3.md` / 记忆 `vapor-custom-base-s3-flavor`）
