# mathjax SVG 公式渲染方案 · 验收操作文档

> 分支 `feat/nuwa-zhuoda-2026.07-rich-text-math`（worktree: `.claude/worktrees/rich-text-math`）
> 目标：验证「mathjax → SVG data URI → `<image>`」公式渲染方案在 App 端能否工作。
> **命门**：uni-app x 的 native `<image>` 大概率不解码 SVG（Android Glide / iOS SDWebImage 默认都不支持）。本次验收就是用最小成本测出这个 go/no-go。

---

## 前置条件

- HBuilderX 已启动（路径 `/Applications/HBuilderX.app`），项目 `nuwax-mobile` 已导入
- Android 模拟器已启动，或真机已开启 USB 调试
- 当前在 worktree 分支：`git rev-parse --abbrev-ref HEAD` 应为 `feat/nuwa-zhuoda-2026.07-rich-text-math`
- **不需要重打基座**：本方案只改了 `uts/uvue/html/js`（业务代码），用标准基座热更即可（见 custom-base-rebuild-rule）

---

## 步骤 1：编译运行到 Android

```bash
# 方式 A：pnpm 封装（推荐，默认第一台设备，标准基座）
pnpm hx:android

# 方式 B：指定设备
pnpm hx:android -- --deviceId emulator-5554
```

确认 app 编译通过并安装运行（首次编译约 1–2 分钟）。

---

## 步骤 2：进入公式对照页（test-katex）

test-katex 页已注册到主包（`pages.json`），可直接作为启动页：

```bash
# HBuilderX CLI 指定启动页直达（最快）
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android \
  --project nuwax-mobile \
  --pagePath pages/test-katex/test-katex
```

> 若被登录拦截跳走：test 页通常免登，参考现有 `test-intervention` 页的进入方式；或登录后手动改路径。

页面打开后应看到：
- 上半部分 Case 1–6：KaTeX 现有链路（H5 v-html / App PNG 截图）
- 下半部分 **M1–M3 对照用例** + 一个「切换为 MathJax SVG / KaTeX PNG」按钮

---

## 步骤 3：验证命门（核心，30 秒搞定）

1. **默认（katex 模式）**：M1–M3 应显示公式（PNG 截图，现有链路，**必显示**）
2. **点按钮**「切换为 MathJax SVG」→ 顶部提示变成「MathJax · SVG」
3. **观察 M1–M3**：

| 现象 | 结论 |
|---|---|
| M1–M3 **正常显示公式**（矢量、清晰） | ✅ **命门通过**：native `<image>` 能解码 SVG，方案可行 |
| M1–M3 **空白 / 破图 / 不变** | ❌ **命门未过**：native `<image>` 不解 SVG，需转 PNG 或服务端 |

再点按钮切回 katex，M1–M3 应回到 PNG 显示（确认切换正常）。

---

## 步骤 4：日志排查（命门未过时定位卡在哪）

另开终端跟日志：

```bash
pnpm hx:android:log
```

关注以下关键字（来自 proxy-web.html 的 error 字段）：

| 日志关键字 | 含义 | 处理 |
|---|---|---|
| `mathjax_not_ready` | mathjax 库 5s 内没加载完 | web-view 加载慢，可调大 `waitForMathjax` 超时；检查 `libs/mathjax-tex-svg.js` 是否被打包进 app |
| `no_svg` / `empty_svg` | mathjax 渲染了但拿不到 SVG | 检查 `MathJax.tex2svgPromise` 调用 / 序列化 |
| `mathjax_render_failed` | mathjax 抛错 | 看附带的 error.message |
| **无任何 error，但图空白** | SVG 生成成功，只是 `<image>` 不解码 | **这就是命门未过**，转方案 |

---

## 步骤 5（命门通过后才做）：全链路验证

把全局开关切到 mathjax，进真实对话看公式：

1. 编辑 `uni_modules/uni-ai-x/sdk/math-render.uts`，把 `MathRenderConfig.mode` 默认值改为 `'mathjax'`
   ```ts
   mode: string = MATH_MODE_MATHJAX
   ```
2. 重新编译运行：`pnpm hx:android`
3. 进任意 AI 对话，发含公式消息：
   ```
   行内能量公式 $E=mc^2$ 测试
   块级公式：
   $$\frac{-b \pm \sqrt{b^2-4ac}}{2a} + \sum_{i=1}^{n} x_i^2$$
   ```
4. 看对话气泡里的公式是否以 SVG 渲染（矢量清晰、无截图锯齿）
5. 验证完记得切回 `'katex'`（默认值），避免影响现网

---

## iOS 验证（与 Android 结果独立）

```bash
# 模拟器（免签，先验）
pnpm hx:ios:simulators   # 列模拟器 UDID
pnpm hx:ios:sim -- --deviceId <UDID>

# 真机（需签名）
pnpm hx:ios:device -- --deviceId <设备序列号>
```

同样进 test-katex 点按钮。**iOS 和 Android 命门结果可能不同**（底层图片库不同：SDWebImage vs Glide），两端各自验、各自下结论。

---

## 验收结论与后续

| 命门结果 | 下一步 |
|---|---|
| Android + iOS 都通过 | 推 `MATH_MODE_MATHJAX` 默认（或保留开关），方案落地 |
| 某端通过、某端不通过 | 用条件编译按平台选模式（katex/mathjax 混用） |
| 都不通过 | 转 mathjax→PNG 截图（回到类似现有方案、引擎换 mathjax），或**服务端出图**（App 免 web-view，鸿蒙也能受益） |

## 范围说明

- 本次覆盖 **Android + iOS**。**鸿蒙不在范围**：整个 web-view 公式链路（`proxy-web.uts` evalJS 用 `#ifdef APP`）现状就不支持鸿蒙，是独立工程、需鸿蒙基座迭代。
- 验证仅改业务代码，标准基座热更即可，无需 `make base-*` 重打基座。
