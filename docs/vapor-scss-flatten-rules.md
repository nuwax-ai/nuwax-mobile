# vapor 蒸汽模式 SCSS 反嵌套修复规则（定稿）

> 适用：`feat/nuwa-zhuoda-2026.07-vapor` 及以后所有 vapor 目标的样式修复。
> 权威依据：[uni-app-x vapor 官方文档](https://doc.dcloud.net.cn/uni-app-x/app-vapor.html)（CSS 部分）。
> 方法：**手动逐文件改，不上脚本**（脚本批量改正确性风险过高，曾出 `@keyframes` from/to 被提到外面、嵌套规则 hoist 丢子选择器 2 个 bug，已废弃）。

---

## 一、根因（官方文档已锁死）

vapor `styleIsolationVersion: "2"` 出于性能，**运行时只认两类选择器**：

- ✅ 简单 class 选择器：`.foo`
- ✅ 分组选择器：`.a, .b`

其余**运行时整条静默丢弃**（不是警告，是直接失效）：

- ❌ 后代 `.a .b`、子代 `.a > .b`、相邻兄弟
- ❌ 复合 `.a.b`
- ❌ 伪类 `:hover` / `:active` / `:last-child` / `:focus` …
- ❌ id `#x`、标签 `view`、属性 `[type=text]`

SCSS 是**编译期**方案，本身可用，但它把嵌套编出的就是后代选择器 → **照样被丢**。所以「嵌套」本身就是要拆掉的对象。官方给的唯一替代方案是 **BEM 命名**（原话「`.parent .child` 替换为 `.parent__child`」）。

**styleIsolation 2.0**：组件默认 `isolated`，外部（页面/全局）同名 class 不影响组件；要接收全局工具类/iconfont 才在 `<script setup>` 的 `defineOptions({ styleIsolation: 'app' | 'app-and-page' })` 放开。受影响组件大多已放开，本次不动。

---

## 二、逐条转换规则

### R1 — 后代嵌套，子类名在组件内唯一 → hoist 为顶层单类（**默认策略**）

> 决策：**同名唯一就 hoist**。组件 scoped 下，类名唯一时顶层单类与原后代选择器等价、零模板改动、风险最低。只有 R3 撞色才动模板。

```scss
/* ❌ 改前（编出 .conv-item .conv-item-inner .title-row .conversation-title，运行时丢） */
.conv-item {
  background: #fff;
  padding: 0 32rpx;
  .conv-item-inner {
    padding: 24rpx 0;
    .title-row {
      display: flex;
      .conversation-title { font-size: 30rpx; }
    }
  }
}

/* ✅ 改后（全顶层单类，运行时保留；模板不动） */
.conv-item { background: #fff; padding: 0 32rpx; }
.conv-item-inner { padding: 24rpx 0; }
.title-row { display: flex; }
.conversation-title { font-size: 30rpx; }
```

要点：父级**自身的声明**保留为顶层 `.conv-item{…}`；**每个子级**连同其声明整体提到顶层，类名不变。模板 `class="conv-item"/"conv-item-inner"/...` 完全不动。

### R2 — 融合 amp（`&-x` / `&__x` / `&--x`）→ 拆嵌套，类名融合后本就是单类

融合 amp 编译出的是 `.parent-x`，**本就是单类，vapor 保留**，只需把嵌套拍平到顶层。

> **重要认知**：SCSS 融合 amp 嵌套（`.a{ &-x{} }`）编译出的是单类 `.a-x`（**不是后代**），vapor 本就保留——所以 **R2 拍平只是源码整洁，功能上非必需**。真正被 vapor 丢弃的**只有纯后代** `.a { .b {} }`（即 R1）。判定一个文件是否「被 vapor 弄坏」只看有没有纯后代嵌套；只有融合 amp 嵌套的文件其实没坏（但顺手拍平无害、更清晰）。

```scss
/* ❌ 改前 */
.card-container {
  &-active { border-color: #5147ff; }          /* 编出 .card-container-active（单类，其实 OK，但被嵌在父块里） */
  .info-box { .agent-name { color: #333; } }
}

/* ✅ 改后 */
.card-container-active { border-color: #5147ff; }   /* 融合单类，提顶层 */
.info-box { /* 父自身若无声明可省略 */ }
.agent-name { color: #333; }                        /* R1 hoist */
```

多层融合自顶向下解析：

```scss
.radar { &__ring { &--2 { width: 200rpx; } } }
/* → */ .radar__ring--2 { width: 200rpx; }
```

### R3 — 同名撞色（子类名在 ≥2 个父级下**声明不同**）→ BEM 改名 + 改模板

> 这是**唯一必须动模板**的情形。R1 在这里会失败：合并成一个 `.line-number` 会丢掉按变体区分的颜色。

```scss
/* ❌ 改前：.line-number 在 added/removed 下颜色不同，hoist 会撞色 */
.diff-line {
  &.normal { background: #fff; }
  &.added {
    background: #e6ffed;
    .line-number { background: #cdffd8; color: #22863a; }   /* 绿 */
    .line-content { color: #22863a; }
  }
  &.removed {
    background: #ffeef0;
    .line-number { background: #ffdce0; color: #cb2433; }   /* 红 */
    .line-content { color: #cb2433; }
  }
}
```

```scss
/* ✅ 改后：按变体 BEM 改名，复合 &.added 也拆成独立类 */
.diff-line-normal  { background: #fff; }
.diff-line-added   { background: #e6ffed; }
.line-number-added { background: #cdffd8; color: #22863a; }
.line-content-added   { color: #22863a; }
.diff-line-removed  { background: #ffeef0; }
.line-number-removed { background: #ffdce0; color: #cb2433; }
.line-content-removed { color: #cb2433; }
```

模板同步改：原本 `:class="['diff-line', line.type]"` + `class="line-number"` → 把变体也拼进每个元素类名（如 `line-number line-number--${type}`）。**注意模板改动要逐元素核对，别漏。**

> 反例：若同名 `.child` 在多个父级下**声明完全相同**，则不算撞色 → R1 去重 hoist 一次即可（合并声明）。

### R4 — `@keyframes` 原样保留（勿把 from/to 提出去）

`@keyframes` 里的 `from`/`to`/`0%`/`100%` 是**关键帧选择器**，不是 class 关系选择器，**vapor 不丢**。必须整块保留：

```scss
/* ✅ 保持这样，切勿改成顶层散的 from{}/to{} */
@keyframes chat-upload-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
```

条件编译包裹（`/* #ifndef APP */ … /* #endif */`）也原样保留。

### R5 — `@media` 保留包裹，内部再 hoist

媒体查询**必须保留 `@media (…){ … }` 包裹**，子规则可在其内部按 R1/R2 拍平，但**不能提到 `@media` 外面**：

```scss
/* ✅ */
@media (orientation: landscape) {
  .conv-item { padding: 0 48rpx; }   /* 内部 hoist，仍留在 @media 里 */
  .title-row { margin-bottom: 24rpx; }
}
```

### R6 — 伪类 / 复合 / 伪元素：原样保留不删，逐文件标注

`&:active` / `&:hover` / `&:last-child` / `&.is-active`（复合）/ `&::after`（伪元素）**vapor 运行时会丢，但 H5/vdom 需要**，所以：

- **不要删**，原样留在 SCSS 里；
- 逐文件登记到下方「R6 待办」，区分两种处理：
  - **静态伪类**（如 `:last-child` 去掉末项间距）：必要时转条件类（模板加 `--last`，配 `.xxx--last{}` 单类），效果在 vapor 也能生效；
  - **触摸态**（`:active`/`:hover`）：移动端本就无意义，保留即可，接受 vapor 下丢失。
- 复合 `&.is-active` 多数可手 hoist 成单类 `.is-active`（若 `.is-active` 声明与上下文无关）；若声明依赖父级则归 R3。

---

## 三、每文件改完自检（4 条）

1. **选择器形态**：除 R4(`@keyframes`)/R5(`@media` 内)/R6(保留的伪类/复合) 外，每条选择器须是「单 class」或「分组」，**不得**再出现后代（空格分两段）、复合（`.a.b`）。
2. **声明无丢失**：原每条 `property: value` 都在新版找得到归属；父级自身声明仍在顶层该类名下。
3. **模板零改动**：除 R3 撞色外，`class=`/`:class=` 一字不改。
4. **dart-sass 编译**：用 HX 内置 sass 编译该 style 块，0 语法错（`@import` 解析失败属环境性，非语法错）。

```bash
SASS=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/compile-dart-sass/node_modules/.bin/sass
NODE=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/node/node
# 抽 <style> 块到 /tmp/x.scss 后：
$NODE $SASS /tmp/x.scss --no-source-map
```

---

## 四、执行进度（手动逐文件）

状态：✅ 已改 / ⏳ 进行中 / ⬜ 待改 / ➖ 不需改（本就扁平或无嵌套）

### 报障驱动（优先）
| 文件 | 关联报障 | 嵌套类型 | 状态 |
|---|---|---|---|
| `pages/index/home-content/home-content.uvue` | #1 会话列表样式丢失 / #4 最近使用图片 | 纯后代（R1） | ✅ 亲改 |
| `components/agent-component/agent-component.uvue` | #2 智能体列表分栏错乱 | 后代 + 融合amp(R1/R2) + 伪类`:hover`/`:last-child`(R6 保留) | ✅ 亲改 |
| `components/recent-used-agent-item/recent-used-agent-item.uvue` | #2 / #4 | 后代 + 融合amp(R1/R2) | ✅ agent |
| `subpackages/pages/login/components/login-form/login-form.uvue` | #3 登录「下一步」按钮未居中 | **本就扁平，非嵌套问题**；疑 vapor 原生 `<button>` title 不受 CSS flex 控制，待截图诊断 | ➖ |

### 批次 1（10 文件已反嵌套，⏳ 独立 review subagent 复核中）
home-content（亲改）、agent-component（亲改）、recent-used-agent-item、pane-tabs、auth-login-popup、pages/index/index（3 个 style 块）、openui-card、task-result-card、provision-connect、provision-entry。
我已结构校验：10 文件残留后代/复合/漏 hoist 的 amp 均 0；每个 diff hunk 落在 `<style>` 块内（模板/`class=` 零改动）；agent-component 的 R6 伪类在位。review 结论回来后补记。

### 其余含后代嵌套的文件（全量 sweep）
`subpackages/pages/conversation-search/conversation-search.uvue`、`components/pane-tabs/*`、`components/auth-login-popup/*`、`subpackages/components/ai-msg/ai-msg.uvue`、`components/radio-list-drawer/*`、`components/diff-list-view/components/diff-content-view/diff-content-view.uvue`（**R3 撞色**）、`components/agent-icon/*`、`subpackages/pages/provision-*/`、`components/tool-call-group/*`、`components/openui-card/*`、`components/task-result-card/*`、`subpackages/pages/login/components/reset-password/reset-password.uvue`（含 `@keyframes` R4）、`subpackages/pages/chat-conversation-component/chat-conversation-component.uvue`、`subpackages/components/chat-input-phone/*`（含 `@keyframes` R4）、`components/voice-recorder-button/*`、`pages/index/index.uvue`。

### R6（伪类/复合）待办登记
> 改到对应文件时在此登记，便于集中处理模板侧条件类。

- _(待登记)_

---

## 五、分支与提交约束

- 改动落在 `feat/nuwa-zhuoda-2026.07-vapor` 工作树，**未提交**（遵循「仅按要求 commit」）。
- 桌搭专属提交**不得**合入 `release/nuwa-basic` / `main`。
- 迭代验证用**热更 / `adb install -r`** 保登录态（ACCESS_TOKEN 在 DCStorage SQLite，重装会丢），见 `avoid-reinstall-hot-update`。
