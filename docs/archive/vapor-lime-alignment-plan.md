# vapor × LimeUI X 优化对齐改造计划

> **目标**：基于两份官方资料，把 nuwax-mobile 的 uni-app x **蒸汽模式（vapor）** 实现从"打补丁适配"对齐到"官方生态标准"，并消除旧版 lime 组件带来的技术债。
>
> **依据文档**：
> 1. uni-app x 官方文档：https://doc.dcloud.net.cn/uni-app-x/
>    - 关键子页：`css/common/style-isolation.html`（蒸汽样式隔离）
>    - `native/`（离线基座/原生集成）、`plugin/uts-plugin.html`（uts 插件）
> 2. LimeUI X 插件市场（id 28915）：https://ext.dcloud.net.cn/plugin?id=28915
>
> **适用分支**：`feat/nuwa-zhuoda-2026.07-vapor`（当前工作分支）
> **编写日期**：2026-08-06

---

## 0. 现状基线（为什么需要对齐）

### 0.1 官方定位
- **LimeUI X（v4.0.3）**：官方定义为"基于 uni-app x（**vapor**）为主的高性能 UI 组件库，兼容 uni-app（Vue2/Vue3），提供 CSS Var 动态主题"，支持 **Web / Android / iOS / HarmonyOS**，要求 **uni-app x 5.21+**。
- **uni-app x 官方**：蒸汽模式（vapor）是官方强推的高性能渲染路线，vapor 下采用 `styleIsolationVersion:"2"` + `vapor-render-target:"bytecode"`，样式编译约束与标准模式不同。

### 0.2 本地实测差距（关键结论）
| 项 | 本地现状 | 官方标准 | 差距 |
|---|---|---|---|
| lime 组件版本 | **全部 0.x 旧版**（badge 0.1.5 / button 0.2.7 / icon 0.3.7 / tabs 0.2.7 …） | **v4.0.3**（vapor 优先） | **大幅落后，非官方 vapor 版** |
| vapor 样式处理 | 打补丁：`扁平化复合选择器` + `defineOptions({ styleIsolation })` 放开隔离（提交 `35facfc6`） | LimeUI X 官方 vapor 版自带 CSS Var 动态主题 | 补丁式、不跟随生态 |
| uni-stat | 已随 §2 瘦身剥离（`settings.gradle` 注释掉 `include ':uni-stat'`） | — | 已处理 ✅ |
| 蒸汽开关 | `manifest.json`：`vapor:true, styleIsolationVersion:"2", vapor-render-target:"bytecode"` | 符合官方蒸汽配置 | 一致 ✅ |

**核心判断**：nuwax-mobile 已按官方 uni-app x 文档解决蒸汽模式的关键坑（样式隔离、离线基座、uts 插件），但 **lime 三方组件仍停留在 0.x 旧版 + 手工补丁**，而非跟随 LimeUI X 官方 v4.0.3。这是本次对齐改造的核心。

---

## 0.5 最高决策原则（用户拍板，务必遵守）

> **「能走生态的就不要自己搞」** —— 官方有成熟实现，一律用官方版，不自研、不打补丁。

本原则优先于文档内所有其他策略：
- 凡 LimeUI X 官方 v4.0.3 已覆盖的能力 → **直接采用官方组件**，不做本地魔改。
- 本地旧版 lime 上的任何手工补丁（`styleIsolation` 强制放开、扁平化选择器等）→ **一律移除**，改用官方机制。
- 本地魔改过的组件 → **默认回退到官方原版**，除非业务能力官方确实缺失、且无替代插件，才评估「私有化 fork 官方 v4」并**单独提请确认**后才能保留魔改。
- 计划、执行、验收全过程以此为准：任何「自己造轮子」的倾向都先质疑、先找官方/生态替代。

---

## 1. 对齐改造目标（Goals）

1. **消化 LimeUI X 官方 vapor 版本**：将本地 13 个 `lime-*` 组件从 0.x 旧版**全面替换为官方 v4.0.3** vapor 兼容版。
2. **移除手工样式补丁**：删除 §3/§3b 里为适配 steam 而打的补丁（扁平化选择器、强制 `styleIsolation` 放开），改用官方机制。
3. **保持蒸汽模式不回归**：对齐过程中不得破坏已通过的蒸汽构建（包瘦身、下载进公共目录、跑马灯等）。
4. **控制范围**：本轮只对齐 lime + 蒸汽样式，不动业务逻辑与 uni-stat（已剥离无需处理）。
5. **生态优先**：只保留官方缺失的必需能力私有化，且需先确认；其余 100% 跟随官方。

---

## 2. 分阶段改造计划

> 依赖顺序：**评估 → 升级 → 校验 → 兜底**。任何一步蒸汽编译失败立即回退。

### Phase A：依赖盘点与影响面评估（预估 0.5~1 天）
- [ ] A1 清点业务代码对 13 个 `lime-*` 组件的**实际引用清单**（import 语句 + 使用位置）。
  ```bash
  grep -rn "lime-" pages/ components/ subpackages/ --include="*.uvue" | grep -oE "l-[a-z-]+|lime-[a-z-]+" | sort | uniq -c | sort -rn
  ```
- [ ] A2 读取 LimeUI X v4.0.3 官方包，列出**破坏性变更**（组件名/API/属性/事件重命名、vapor 专属新属性）。
- [ ] A3 识别**本地魔改点**（对比官方原版 diff）：区分「官方已支持 → 直接回退官方」与「官方缺失 → 私有化候选（需单独确认）」。
- [ ] A4 输出"组件级差异表"：每个 lime 组件 旧版 API → v4 API → 业务影响 → 采用方案（官方替换 / 私有化待确认）。
- [ ] A5 确认最低兼容版本：官方要求 uni-app x 5.21+，本地已是 HBuilderX 5.23（满足 ✅）。

### Phase B：环境与基线准备（0.5 天）
- [ ] B1 打一个蒸汽内测包存档，作为**回归基准**（记录包体积、`Invalid selector` 条数、真机走查快照）。
- [ ] B2 用官方文档核对 steam 下 lime 组件正确引入方式（遵循 `style-isolation.html` 的 vapor 规范，避免再引入隔离冲突）。
- [ ] B3 建立独立分支 `feat/nuwa-zhuoda-2026.07-vapor-lime-alignment`，避免污染当前 vapor 分支。

### Phase C：全面替换官方 LimeUI X v4.0.3（核心，2~4 天）
> 策略：**默认全面采用官方原版，移除一切本地魔改/补丁**。官方缺失能力记入 A3 私有化候选清单，单独确认后方可保留。
- [ ] C1 下载/引入 LimeUI X v4.0.3 官方包，按官方文档正确装配（遵循 vapor 规范，见 B2）。
- [ ] C2 按影响面从小到大替换：**先纯展示组件**（`lime-icon`、`lime-badge`、`lime-loading`、`lime-transition`、`lime-overlay`），风险低先落地。
- [ ] C3 再替换**交互组件**（`lime-button`、`lime-tabs`、`lime-checkbox`、`lime-popup`、`lime-cascader`），逐一验证交互在 vapor 下正常。
- [ ] C4 优先升级底座：`lime-shared` / `lime-style`（其余组件依赖它们），确保版本一致无混用。
- [ ] C5 **移除本地手工补丁**：`defineOptions({ styleIsolation })` 强制放开、扁平化选择器改动 → 全部回到官方推荐写法（对齐 §0.5 原则）。
- [ ] C6 每个组件替换后**单独跑一次蒸汽编译**（`make app-resource`），确认无新增 `Invalid selector` / Unsupported 告警。
- [ ] C7 处理 A3 私有化候选：仅当业务能力官方确实缺失且无生态替代时，才私有化 fork 官方 v4 并**提请用户确认**；其余一律官方原版。

### Phase D：蒸汽回归验证（1~2 天）
- [ ] D1 重新导资源（`make app-resource`）：**删除/替换组件后必须重导，否则字节码与 index.kt 不一致**（对齐 §2 已踩过的坑）。
- [ ] D2 打内测包（`SKIP_APP_RESOURCE=1 bash scripts/android-esp/build_tester_release_apk.sh`）。
- [ ] D3 对照 Phase B1 基准回归：包体积、样式告警数（目标 `Invalid selector` 降为 0 或仅余可接受项）、真机 UI 走查。
- [ ] D4 重点走查：chat 输入区（`chat-input-phone` 组大量依赖 lime）、登录页、文件预览、tabs 切换、弹窗/遮罩。
- [ ] D5 验证 §4 已恢复功能不回归：下载进公共 Downloads、通告栏跑马灯。

### Phase E：收尾与上线（0.5 天）
- [ ] E1 更新 `docs/vapor-tech-debt.md` 与 `docs/uni-modules-cleanup.md`，反映 lime 已对齐 v4.0.3。
- [ ] E2 git 提交（走 vapor-lime-alignment 分支），记录依赖版本。
- [ ] E3 合并回 `feat/nuwa-zhuoda-2026.07-vapor`，再次整体蒸汽验证。
- [ ] E4 （可选）切 `release/nuwa-zhuoda` 走正式签名 §6（待内测验证通过后再动）。

---

## 3. 风险与兜底（Risks & Fallback）

| 风险 | 等级 | 缓解/兜底 |
|---|---|---|
| 业务对 lime 有深度魔改，官方 v4 无法直接替换 | 中 | 按 §0.5 原则：默认回退官方；仅官方缺失能力才私有化，且先提请确认 |
| LimeUI X v4.0.3 与业务自定义 API 冲突 | 中 | Phase A 差异表先行；替换前对每个组件留存 diff |
| 升级后蒸汽编译告警/样式坍塌回归 | 高 | Phase D 强制重导资源 + 基准对比；失败即 `git revert` 到 B1 基准 |
| 部分组件依赖链升级后不兼容（shared/style 底座） | 中 | C4 固定底座版本先行，组件逐升 |
| HarmonyOS 目标暂不涉及（官方支持但本轮不做） | 低 | 仅对齐 Android vapor，文档注明范围 |
| 官方机制（styleIsolation 非强制放开）在某业务 UI 上呈现差异 | 低 | 以官方推荐写法为准，UI 差异按官方能力适配 |

---

## 4. 验收标准（Definition of Done）

- [ ] 本地 `uni_modules/lime-*` 与官方 v4.0.3 一致（或经 §0.5 确认的可接受私有版本）。
- [ ] 蒸汽编译 `make app-resource` 后：`Invalid selector` / Unsupported 告警数 ≤ 基准值（目标 0 或仅余经确认项）。
- [ ] 内测包能正常构建并安装真机，核心页面（chat / login / 文件预览 / tabs / 弹窗）UI 与交互正常。
- [ ] §4 已恢复功能（下载进公共目录、通告栏跑马灯）无回归。
- [ ] 无打补丁式的 `styleIsolation` 强制放开残留（回到官方推荐写法）。
- [ ] 文档（vapor-tech-debt / uni-modules-cleanup）已同步。

---

## 5. 参考资料

- uni-app x 官方文档（总入口）：https://doc.dcloud.net.cn/uni-app-x/
- 蒸汽样式隔离官方说明：https://doc.dcloud.net.cn/uni-app-x/css/common/style-isolation.html
- 原生/离线基座官方：https://doc.dcloud.net.cn/uni-app-x/native/
- uts 插件官方：https://doc.dcloud.net.cn/uni-app-x/plugin/uts-plugin.html
- LimeUI X 插件市场：https://ext.dcloud.net.cn/plugin?id=28915（v4.0.3，vapor 优先，要求 uni-app x 5.21+）

---

## 附：本地 lime 组件版本清单（2026-08-06 实测）

```
lime-badge 0.1.5    lime-button 0.2.7    lime-cascader 0.1.3
lime-checkbox 0.1.6 lime-color 0.0.7     lime-icon 0.3.7
lime-loading 0.2.2  lime-overlay 0.1.4   lime-popup 0.2.7
lime-shared 0.4.8   lime-style 0.2.5     lime-tabs 0.2.7
lime-transition 0.2.0
```
→ 全部 0.x，官方已迭代至 v4.0.3（vapor 优先）。**对齐重点：lime-shared / lime-style 底座 + 交互组件优先。**

---

## 附：对齐执行原则（速记）

> **能走生态的就不要自己搞。**
> - 官方有 → 用官方，移除本地补丁/魔改。
> - 官方缺失 → 先找生态替代插件；都无 → 再私有化 fork 官方 v4，且必须单独提请确认。
