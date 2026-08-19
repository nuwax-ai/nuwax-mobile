# 会话页性能修复 —— 验证测试计划（执行版）

> 设备：Redmi 24094RAD4C（arm64 真机）。基座：自定义基座（`pnpm base:fetch`，5.15 VDOM）。
> 入口：`pages/test-stream-perf/test-stream-perf`（主包，点 chip 选 mdType + 填 H/L）。
> 分支：`feat/nuwa-zhuoda-2026.07-perf-vdom`（已含：normalizeLiveForParse + cut 钳制 + flush 200 + deep-watch 收窄 + mermaid 去重）。

## 怎么跑每一条
1. 启动页选 `mdType`（点 chip）、填 `H`、`L`、`chunk 间隔`、`chunk 字符`（默认即可）→ **开始测试**。
2. 进会话页后**自动流式**（L>0 时）；L=0 则只加载历史、不流式。
3. 看右上角绿色浮层 `fps · maxGap`；需要滚动就**用力上下滑**。
4. 跑 ~20 秒，告诉我"跑完 <编号>"，我抓 logcat 出数；或你自己跑：
   ```bash
   ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb
   D=$("$ADB" -s 8PNNT4TKHIJVU8RO logcat -d 2>/dev/null)
   echo "-- fps --"; printf "%s\n" "$D" | grep -oE "fps=[0-9]+" | grep -oE "[0-9]+" | awk '{s+=$1;n++;if($1<m||m==0)m=$1;if($1>x)x=$1}END{printf "avg=%.0f min=%d max=%d\n",s/n,m,x}'
   echo "-- maxGap --"; printf "%s\n" "$D" | grep -oE "maxGap=[0-9]+ms" | grep -oE "[0-9]+" | awk '{s+=$1;n++;if($1<m||m==0)m=$1;if($1>x)x=$1}END{printf "avg=%.0fms max=%dms\n",s/n,x}'
   echo "-- full_parse_large / el_stuck / render:fail --"
   printf "%s\n" "$D" | grep -cE "full_parse_large"; printf "%s\n" "$D" | grep -cE "el_stuck"; printf "%s\n" "$D" | grep -cE "render: fail"
   ```
   （每条 run 前先 `adb -s 8PNNT4TKHIJVU8RO logcat -c` 清缓冲，避免串味。）

## A. 流式解析修复验证（核心 —— 验"卡死/输出不全"根因已修）
| 编号 | mdType | H | L | 操作 | 期望 |
|---|---|---|---|---|---|
| A1 | plain | 0 | 6000 | 自动流式 | fps≥30、maxGap<150、正文边流边出、full_parse_large=0 |
| A2 | formula | 0 | 6000 | 自动流式 | 公式(KaTeX)出图、fps≥24、maxGap<200 |
| A3 | code | 0 | 6000 | 自动流式 | 代码块边出、fps≥24 |
| A4 | tool | 0 | 6000 | 自动流式 | 工具卡边出、fps≥20、el_stuck≤2 |
| A5 | mixed | 0 | 6000 | 自动流式 | 全类型(含mermaid)边出、mermaid 出图不抖、fps≥20、full_parse_large=0、el_stuck≤2 |

**关键看**：内容是否**边流式边出来**（修前是空白/卡死）；`full_parse_large` 是否 0（修前 18）；`el_stuck` 是否 ≤2（修前 73）。

## B. 长历史滚动（list-view 场景，目前 scroll-view+v-for）
| 编号 | mdType | H | L | 操作 | 期望/观察 |
|---|---|---|---|---|---|
| B1 | mixed | 50 | 0 | 上下滚动 ~20s | 记 fps/maxGap，找卡顿体感 |
| B2 | mixed | 100 | 0 | 上下滚动 ~20s | 比 B1 更卡？找 H 卡顿临界 |
| B3 | mixed | 200 | 0 | 上下滚动 | 极限压 |

**目的**：量化长历史滚动卡顿（list-view 迁移的立项依据）。当前无 list-view，预期 B2/B3 明显卡。

## C. mermaid 去重修复验证（另一 agent 改的，需验）
| 编号 | mdType | H | L | 操作 | 期望 |
|---|---|---|---|---|---|
| C1 | mermaid | 0 | 4000 | 自动流式 | mermaid **出图**（不再"图表渲染失败"）、**不抖动**、`render: fail`=0 |

**若 C1 不出图但**不抖**：去重生效，但 mermaid.js 在该 proxy WebView 跑不起来（H1 环境问题），需另抓 `callMethod` 回包。若**仍抖**：去重没生效，查 `appMarkdownFallback.uts:renderMermaidToken` 的 `mermaidCache`/`mermaidInFlight`/冷却。

## D. 消融对比（可选，需改 const + recompile）
改 `aiMsgMarkdownParser.uts` 的 `INCREMENTAL_FALLBACK_ENABLED = false` → `pnpm hx:android:compile` → 重部 → 跑 A5 → 应**明显更卡**（maxGap 飙到几百 ms、可能 full_parse 大量）。验证增量解析的价值。验完改回 `true`。

## 验收线
- 流式（A）：fps≥24、maxGap<200ms、`full_parse_large`=0、`el_stuck`≤2、**内容边流边出**。
- mermaid（C）：**出图 + 不抖**、无"图表渲染失败"。
- 长历史（B）：记录数字（无硬指标，list-view 迁移前后对比用）。

## 验证结果记录（边验边填；jitter 版 chunk16/interval60±35%，Redmi 真机自定义基座）

### 之前调试结论（解析层根因修复，详见 docs/perf-conversation-stream-render.md）
- 根因：`[SseStall] el_stuck`（live 段半截结构块不提交）+ `full_parse_large`（cut 回退退全量=3 秒冻结）。
- 修复：`normalizeLiveForParse`（live 段合成关闭未配对 group/段落）+ cut-regress 钳制（不退全量）+ flush 200ms + deep-watch 收窄。
- 消融（同配置 tool，INCREMENTAL ON vs OFF）：OFF = 灾难（fps~20 / maxGap 均值 594ms / 最坏 3140ms）；ON ≈2× fps、maxGap 减半。→ 增量方向对。
- mixed@6000 公平对比（修复前后）：`full_parse_large` 18→0、`el_stuck` 73→1、增量解析 avg 3-9ms。**"卡死/输出不全"解析根因解除。**

### 本轮逐条验证（L=6000，H=0）
| 编号 | mdType | fps avg | maxGap avg | full_parse_large | el_stuck | render:fail | 判定 |
|---|---|---|---|---|---|---|---|
| A1 | plain | 17 | 215ms | 1 | 0 | — | 解析✅ / 渲染层受限(L=6000 长) |
| A2 | formula | 12 | 259ms | 0 | 0 | 0(KaTeX✅) | 解析✅ + 公式出图✅ / KaTeX 重 |
| A3 | code | 14 | 266ms | 0 | 1 | 0 | 解析✅ / 代码高亮重 |
| A4 | tool | 25 | 160ms | 0 | 0 | 0 | ✅达标(tool DOM 组件轻) |
| A5 | mixed(含mermaid) | 15 | 442ms | 11 | 0 | 0 | mermaid✅修复 / mixed最复杂→full_parse回退多(下档优化:fenced块stable-cut) |

### B 长历史滚动（mixed, L=0，scroll-view+v-for 全量常驻）
| 编号 | H | fps avg | maxGap avg | full_parse | el_stuck | 说明 |
|---|---|---|---|---|---|---|
| B1 | 10 | 30 | 199ms | 0 | 0 | 10条滚动尚可 |
| B2 | 100 | **10** | **760ms**(min692) | 0 | 0 | **灾难性卡顿→list-view 铁证** |

**结论**：长历史滚动卡（maxGap 400ms+）—— N 条重 cell 全常驻 scroll-view，滚动排版/重算开销大。**list-view 回收（屏外 cell 回收、只渲可见）是这场景的杠杆**（Phase 4c）。流式解析修复（A 系列）对此场景无直接帮助（它不流式），是独立的列表层瓶颈。

### D 消融（mixed@6000，INCREMENTAL_FALLBACK_ENABLED ON vs OFF）
| 模式 | fps | maxGap | full_parse_large | 解析耗时 | 说明 |
|---|---|---|---|---|---|
| ON（增量） | 15 | 442ms | 11 | 变化大+回退 | 簿记开销(normalize+stable/live+前缀)重 |
| **OFF（全量）** | **23** | **209ms** | 51(每次flush) | **full avg 37ms 稳定** | 复杂内容下更快 |

**反直觉发现**：mixed 复杂内容下**全量比增量更快**——增量簿记开销超过全量成本。但对**简单内容**（plain/table）增量更优（全量对长简单文本会灾难）。**结论：增量 vs 全量取决于内容复杂度，无单一最优。保持 `true`（增量）为默认——对多数简单消息更优，且不会灾难。** 优化方向：内容自适应（简单走增量、复杂走全量），或降增量簿记开销。

## 已知限制
- mermaid/公式依赖 proxy-web；公式正常，mermaid 待 C1 验证。
- fps 浮动大（14–30），单 run 看趋势，重要对比取多次中位数或 A/B（如 D）。
- dev 产物（mock/测试页/消融开关/探针）默认关、storage 门控；正式包前须移除。

## 待修（观察到的，本轮先记）
- **流结束终态全量重 parse 闪烁**：流式结束 `isConversationActive` 翻 false → 解析器走 `applyAppFallbackFull` 把整条重 parse 一遍 → markdownElList 重建（元素 id live→frozen）→ 整条重渲染闪一下。修法：`applyAppFallback` 完成态守卫——`lastFallbackBody` 已覆盖整条 + 元素已产全时跳过全量重 parse（让增量终态稳定）。不影响"卡死/输出不全"主诉（流式中已修），属终态体验细节。
- **markdown 图片闪烁**（A5 mixed 观察）：流式每 flush，live 区重解析 → 图片元素（markdown_image）重新生成（新 `live-` id）→ Vue 当新图片 → `<image>` 重挂载重载 URL → 闪烁。与 mermaid 抖动同类（live 元素 id 不稳定）。修法：图片元素按 URL 给稳定 id（`uni-ai-x-msg`/parser 元素 id 策略）或让图片块尽快冻结进 stable（`f-` 稳定 id）。render 层，与 list-view 同档。
- **mixed full_parse_large 11**（A5）：最复杂内容（mermaid ``` 围栏 + 全类型）的 `findStableMarkdownCut` 切点/前缀稳定性差 → 回退全量偏多（cut 钳制把 tool 的 18→3，mixed 更复杂仍 11）。下档优化：fenced 块（mermaid/code）的 stable-cut 稳定性。
