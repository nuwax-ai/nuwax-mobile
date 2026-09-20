# PC（nuwax web）会话渲染同步清单 — 2026-09-17

> 基线：移动端 09-16「UI 全对齐 PC」（`60d6fc45f`）对应的 PC 状态 ≈ `796f0a132`（09-16 22:44）。
> 增量范围：PC `feat-dong.0930` 分支 `796f0a132..d05c09d2e`（09-17 全天，约 40 提交，下表只列移动端相关的）。
> 结论先行：**小项 2 个可直接做（扫光+竖线、文档口径）**；进度胶囊经产品定调**移动端不同步**（形态未定）；其余为 PC 专属不同步。

---

## 09-19/20 批次（已实施，2026-09-20 同步完成）

PC `d05c09d2e..9d0d7207a`（09-19~20 会话渲染相关 5 项，全部落地）：

| 项 | PC 提交 | 移动端落点 | 状态 |
|---|---|---|---|
| 组头终态计数（运行中保持动词词条不计数；终态按 kind 计数拼接「读取了 2 个文件 · 运行了 1 条命令」，file-edit 全 isCreate 用创建变体） | `e2d2a3626` | `conversationTrace.uts` 新增 `toolGroupCountI18nKey`；`tool-trace-group` groupTitle 终态走计数词条；i18n 四语言 9 条 | ✅ 已验收 |
| 待办卡 TodoTraceNode（Plan 结构化清单专属：「待办」+ N/M + 浅灰圆角面板三态项：完成=绿圈勾+删除线/进行中=›+主色加粗/待办=空心圆/失败=红✗；运行中默认展开、结束自动收起一次、历史收起；无步骤回落普通行） | `e2d2a3626`+`78dde1ebd` | `plan-trace-row.uvue` 重写为待办卡+回落行；ai-msg 节点展开状态机扩展（todo 运行默认展开 + `previousRunningTodoNodes`/`autoCollapsedTodoNodes` 收起一次） | ✅ 已验收 |
| 折叠箭头统一 caret（四处：节点/组头/待办卡/轨迹头 → SvgIcon caret_down） | `78dde1ebd` | 移动端五处（轨迹头/组头/工具行/待办卡/思考行）统一 caret SVG mask（iconfont 无该字形，复用终端图标同法，background-color 染色 + -90°/0° 旋转） | ✅ 已验收 |
| 思考行运行中「正在思考」ticker（首行内容单行贴尾跟随）+ RunOver 去扫光 | `b1df18e12` | ai-msg 思考头：运行态「正在思考 · <首行>」scroll-view 贴尾（scroll-left 递增+动画）；RunOver 无对应物不同步 | ✅ 已验收 |
| 思考完成时长「思考 · 持续了 N 秒」（投影层锚点：首见思考打点、翻完成收口；历史无锚不显示） | `e2d2a3626` | ai-msg `thinkAnchorStartMs`/`thinkDurationSec`（watch thinkContent 打点、watch isThinkingFinished 收口；消息切换重置）；「已思考 · 持续了 N 秒」 | ✅ 已验收 |
| OpenUI 产物常显（轨迹收起态保持显示；inline/sidecar 两形态） | `d414f972f` | ai-msg 新增 `.openui-persistent` 收起态常显区（展开态仍原位渲染）；sidecar 预览面板为 PC 桌面交互，移动端保持 mp-html openui-card 现状 | ✅ 已验收（常显部分） |

该批次不同步项：胶囊 OpenUI 分区（随胶囊定调）、runtime 收尾链/SESSION_RESUME/文件树懒加载（PC runtime 架构专属）、消息区横向滚动收敛（PC 布局）、休眠控制（PC 宿主壳）。

---

## 一、建议同步（按优先级）

### P1 · 运行行扫光动效（小，纯样式，建议本迭代做）

- **PC 提交**：`9469b6dab`（运行中文案扫光 + 节点详情引导竖线）→ `3a10fed54`（扫光收敛到工具名，摘要不再流光）
- **PC 实现**：running 状态行的标题加 `.shimmer-text`——`background-clip: text` 渐变高光从左向右扫过（`v2-shimmer-sweep` 2.4s linear infinite），仅标题参与，摘要/meta 不动
- **移动端落点**：`subpackages/components/work-trace/tool-trace-row.uvue`（running 行的 node-title）、`tool-trace-group.uvue`（组头 running 态）、`plan-trace-row.uvue`；H5 分支直接加同款 keyframes（mp-html/H5 支持 `-webkit-background-clip: text`）；现有 `icon-Loader` 旋转 spinner 保留与否需对齐 PC（PC 保留了 spinner，扫光只加在文字上）
- **风险**：uvue 原生分支不支持 background-clip:text——该分支本来就不在本次对齐范围；微信小程序 wxss 对 background-clip:text 支持 Test 后定
- **工作量**：0.5d（含三端验证）

### P2 · 节点详情引导竖线（小，纯样式，随 P1 一起做）

- **PC 提交**：`9469b6dab`（同上）
- **PC 实现**：`.node-detail` 外边距 21px→7px、补 `padding-left:14px` + `border-left:1px hairline`——展开详情的引导竖线与行首图标列中心对齐（与工具组 body 左竖线同款同位）
- **移动端落点**：`tool-trace-row.uvue` 的 `.node-detail`（现为 `margin: 4rpx 12rpx 16rpx 42rpx`，无边框）→ 改为 `margin-left:14rpx + padding-left:28rpx + border-left:1px hairline`（uvue 无伪元素，用 border-left 实现，与组体竖线同法）
- **工作量**：0.5h

### P3 · 渲染 V2「懒挂载」语义 + V1/V2 术语口径（文档级）

- **PC 提交**：`9564818f2`（docs：渲染V2懒挂载结论入档 + 双轨术语统一为 V1/V2）
- **内容**：`renderer-v2-grouped-trace-summary.md` 新增 7.4 懒挂载（三层折叠严格条件渲染、收起即卸载、投影数据常驻、展开态托管）；术语 V1=旧线 / V2=新线
- **移动端落点**：`subpackages/components/work-trace/README.md` 补懒挂载一节（移动端实现本就是 v-if 条件渲染 + ai-msg 状态机托管展开态，语义一致，只需文档对齐口径）；`docs/conversation/`（新建）可放本清单与后续同步记录
- **工作量**：1h

### ~~P4 · 进度胶囊 ConversationProgressCapsule~~（已定调：移动端不同步）

> **2026-09-17 产品定调：移动端不同步进度胶囊功能**（移动端形态未定，后续产品明确形态后如需再另行立项）。

- **PC 提交**：`42b2b862e`（按参考 UI 重构——分区面板+更改统计+分支）起约 20 个提交打磨：任务结果区/终端折叠/触发器动态文案（`9c615101e`）、`<task-result>` 标签产物行（`f4b75365a`、`188d1728c`）、阴影/宽度/动效系列（`98303cda7`/`13e6c3f94`/`374f39da4`/`7ebe02a07`/`1f2ed5e29`…）、点击打开预览（`f1c031d04`+`02536896b`）、收起钮修复（`53b75f6cb`）
- **PC 形态**：会话页常驻胶囊（收起态贴内容宽、上限 320px）→ 点击展开分区面板：任务结果（`<task-result>` 标签驱动，可点击进预览）/ 计划与进程步骤 / 终端列表（>5 条折叠）/ Git 更改统计+分支（`useGitDiffFiles` 独立接口）；JS 逐帧淡入动效（rAF，环境冻结 CSS 动画时 setTimeout 兜底）。**PC 侧默认关闭**（`showConversationProgressCapsule=false`），灰度开关控制
- **原评估存档**（如未来产品定调移动端形态后可复用）：数据层成本可控——V2 投影（conversationTrace.uts）与详情归一化（toolNodeDetail.uts）已就绪，胶囊选择器可平移；`<task-result>` 标签需 aiMsgMarkdownParser/mp-html 链路新增解析；完整胶囊 3-5d，仅任务结果分区 1d

---

## 二、明确不同步（PC 专属）

| 项 | PC 提交 | 不同步理由 |
|---|---|---|
| **进度胶囊 ConversationProgressCapsule（含任务结果区/终端折叠/Git 统计等全部形态）** | `42b2b862e` 起约 20 个提交（详见上方 P4 存档） | **2026-09-17 产品定调：移动端不同步**；移动端形态未定，后续如有定调另行立项 |
| 缓存遥测调试面板 / Debug FAB | `3a4f69414` `146a868eb` `5e80d8f03` | PC 调试设施；移动端 09-16 已定调不同步 DebugFab 类 |
| 会话页缓存释放（conversationPageCacheManager） | `6b78f48c3` `acc400d49` | PC 多实例页面缓存架构专属；移动端页面栈机制不同 |
| 终态会话未读通知（侧栏视觉指示） | `d05c09d2e` | PC 侧栏特性；移动端会话列表未读另有交互，如需对齐另行立项 |
| 详情页会话状态同步侧栏 / 侧栏项目面板复合键 | `c6e034436` `2e17f6669` | PC 侧栏/详情联动专属 |
| Shell 顶栏避让 28→32 / panel-collapse 定位 / 二级菜单过渡 | `0176cd7d6` `0474b1e54` `bdde59d68` `fa8facf93` 等 | PC 桌面壳（Win/Linux/Mac）专属 |
| 首页分类分段胶囊、NuwaApps ThirdApp 过滤、广场文案口径 | `ceee1be24` `42b2b862e` `c94fd7113` `3ff23cc9f` | 移动端首页/广场为独立实现，不共用 |

---

## 三、验收备忘（做完 P1/P2 后）

- running 工具行/组头/Plan 行：标题扫光、摘要无动效；终态行恢复常色
- 展开任一工具行详情：左侧竖线与组体竖线视觉连续、与图标列中心对齐
- 回归：`pnpm test:conversation`（100 例）+ H5/Android 双编译 + 验收页 8 场景目检
- 微信小程序端扫光效果如不支持 background-clip:text，按端降级为纯色（条件编译处理）

## 四、执行建议顺序

P2（0.5h）→ P1（0.5d）→ P3（1h 文档）。P1+P2 合并为一个提交：`style(work-trace): 运行行扫光与详情引导竖线对齐 PC`。P4 已定调不同步（见上）。
