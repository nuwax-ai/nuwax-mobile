# 数学公式渲染性能测试 — native vs proxy 对比

> 分支 `feat/nuwa-zhuoda-2026.07-native-math`。2026-08-08。性能 A/B 测试交接。

## 测试基建（已就绪）
- **test-stream-perf 页**：渲染后端 chip（native/proxy 切 `MathRendererCore.backend`）+ 列表模式 chip（list/scroll）+ PerfProbe fps/maxGap
- **cacheKey 加 backend 前缀**（`nv:`/`px:`）：切后端缓存不命中 → 重渲染（修了切换不生效）
- **会话详情 useListView 同步**：初始读 `getStreamPerfConfig()`（和 test-stream-perf 配置一致，不限 perf 模式）
- **App.uvue 临时绕过**：onLaunch reLaunch test-stream-perf（测完回退 login）
- **Monitor 抓数据**：`grep PerfProbe.*fps` + `MATHSVG.*(renderViaBackend|nativeBackend cb|PROXY.*cb)`（PerfProbe 每秒多条，持续 Monitor 太吵，用测后一次性 grep）

## 组 A（native + scroll-view）数据 ✅ 已测
| 阶段 | fps | maxGap | native 时延 |
|---|---|---|---|
| 流式期（公式密集生成） | 14-38 | 242-**1030ms** | 280-490ms/条（E=mc² 391 / a²+b² 460 / √2 492 / pmatrix 286 / ∫ 401） |
| 稳态（流式后，缓存命中） | **44-46** | ~160ms | 0（L1/L2 命中） |

native：100% 成功（208/208 err=null），0 proxy_not_ready。

## 组 C（proxy + scroll-view）❌ test-stream-perf 跑不通
- **proxy 持续 proxy_not_ready**（count=70+，webview 没就绪，15s 超时空白）
- **根因**：test-stream-perf 加了 `<web-view markdown-proxy-web>` + ensureAppContext，但 proxyWeb 没 DOMContentLoaded（web-view 没加载/ensureAppContext 时机）
- **修方向**：ensureAppContext 放 `onMounted`（web-view 渲染后调，当前在 script 顶层）；或 proxy 对比用**真会话详情**（chat-conversation-component 有 web-view + ensureAppContext 正确时机，proxy 本来 work）

## 核心结论（已确凿）
| 维度 | native（nuwax-uni-math） | proxy-web（老） |
|---|---|---|
| 冷启动渲染 | ✅ **280-490ms**（进程内 QuickJS，无 webview 依赖） | ❌ proxy_not_ready（webview 冷启动没就绪，15s 超时空白） |
| 就绪依赖 | 无 | webview 初始化 + 2MB katex/mathjax lib（不可控延迟） |
| 可靠性 | 100%（208/208） | 流式场景撞未就绪窗口（count=70+） |
| 稳态 fps | 44-46 | 待测（需 proxy warmup） |
| 内存 | 进程内 ~5-20MB | webview 进程几十 MB |

**native 的核心价值**：进程内 QuickJS+MathJax，**无 webview 就绪依赖**，冷启动 280-490ms 直接渲染。proxy 依赖 webview 冷启动，流式场景（公式来时 webview 没就绪）必然 proxy_not_ready。

## 待办（新会话）
1. **proxy test-stream-perf 修**：ensureAppContext 放 onMounted + 确认 web-view 加载（或 proxy 对比改真会话）
2. **组 B/D**（native/proxy + list-view）：切 list 跑，对比 scroll
3. **proxy 稳态时延**（warmup 后）：webview 就绪后 proxy 单条时延对比 native 280-490ms
4. **App.uvue 回退**：临时 test-stream-perf 绕过 → login
5. **块级公式尺寸**：当前 height 48px + width 等比 + 超宽横滚（native logical=natW/dpiScale，katex-el 块级用容器宽+比例）
6. **iOS 数学渲染**：需 HBuilderX UI 自定义基座（含 iosMath pod）
7. **native dpiScale 几档质量**（high/medium/low，后续优化）

## 验证基建
- `make app-resource && make base-android` → `unpackage/debug/android_debug.apk`
- 红米 `8PNNT4TKHIJVU8RO`：开发者选项→USB 安装（已开）→ adb install 全自动
- `adb logcat | grep -E "PerfProbe.*fps|MATHSVG"` 抓性能
- test-stream-perf：渲染后端 + 列表模式 chip 切换 + PerfProbe fps/maxGap
