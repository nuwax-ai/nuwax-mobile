# iOS 26 会话页 WKWebView 崩溃：排查与处理方案报告

> 时间：2026-08-17 ~ 2026-08-19 · 影响端：iOS 26 真机（App 端会话详情）
> 关联：`subpackages/pages/agent-detail/agent-detail.uvue`（web-view 内嵌 H5 同页）
> 崩溃日志：`unpackage/logs/ios/<UDID>/*.ips`

## 一、问题现象

iOS 26 真机上，从「最近使用」agent 列表进入会话详情（整页 web-view 内嵌 H5 会话页），**来回进出约 5 次即崩溃**。若把 web-view 地址换成 `baidu.com` / 空白页，同样操作不崩。

## 二、排查过程（诊断会话 cf0fe3a8 摘要）

**第一步：最小复现。** 新建 `pages/test-webview-crash` 复现页，脚本化「mount → @load → unmount」循环 15 轮，崩时以控制台最后一行日志定位场景，排除人为操作差异。

**第二步：页面行为矩阵（场景 A–D，baidu.com 中性页）。**

| 场景 | 内容 | 结果 |
|---|---|---|
| A 纯建销 | 只做 mount/unmount 循环 ×50 | **安全** |
| B pushState 风暴 | **常驻** webview + 200 次 pushState 折腾 | **安全** |
| C 混合 | 建销 + pushState | **崩**（2–5 轮） |
| D C+熄火 | 销毁前静默 600ms 再卸载 | **仍崩** @3 轮（熄火协议无效） |

初判：崩溃 = **销毁 × 活跃 history/BFL 双因素，缺一不可**。业务 H5 约 5 轮触发（快于中性页），崩溃签名恒定：`WebBackForwardList::didReceiveMessage` → `FrameState` decode/析构 → `StringImpl hashSlowCase` EXC_BAD_ACCESS / `pas_panic`——即销毁后 WebContent 进程**异步回传**已死视图的消息，销毁前怎么等都没用。

**第三步：E 系列交叉验证（修正初判）。**

- **E0 真实 H5 纯建销、零脚本干预**：**崩**（ips 归档，签名同上）→ 崩溃不需要页面发起任何 history 调用，与 baidu 的差异在销毁时回传的状态体积，非流量；
- **E1 销毁前 evalJS 缩状态**（window.stop + 清 DOM + 150ms）：**更糟**（1–2 轮即崩）——销毁前再触发 same-doc 状态变更是火上浇油；
- **环境对照（另一诊断线，本地 dev ↔ 测试环境 m-shim）**：本地 dev H5 15 轮安全、测试环境 history 静默 shim 崩 @3 轮——history 写入与否与崩不崩无关（双向证伪）。

**页面侧手段全部出清**：静默（D）无效、缩状态（E1）有害、history 归零无关——"页面做什么"改变不了结局。结合 B 场景铁证（**只要 webview 不销毁，200 次 pushState 风暴都安全**），问题收敛到「销毁」这一动作本身。

## 三、根因结论

**Apple iOS 26 WebKit 回归：WebContent 进程销毁回传竞态**（销毁后仍向宿主回传 BFL/FrameState 消息，主线程消费已死对象）。高频创建/销毁整页 WKWebView 把该回归放大到必现；页面侧无从拆雷，HBuilderX 5.24 / alpha 均无修复。属平台级缺陷，**已提交 DCloud 工单 [#32215](https://issues.dcloud.net.cn/pages/issues/detail?id=32215)**（经 HBuilderX 反馈渠道；工单材料全文见 [dcloud-ios26-webview-crash-report.md](dcloud-ios26-webview-crash-report.md)：四场景矩阵 + .ips 附件清单；另关联同族反馈 #32189）。**DCloud 已确认收到反馈，且官方同样推荐使用 vapor**——平台方向与本线选型一致，此类早期磨合问题可预期获得官方侧修复支持。

## 四、已落地的处理（当前方案）

**销毁时机搬离关键路径：退出会话页时先卸载 web-view 节点、延时后再执行真实导航**（`agent-detail.uvue` 的 `webViewAlive`：返回键 / 退出路径先置 `false` 让 `v-if` 卸载 webview，把 WKWebView 销毁从页面栈 pop 的同步关键路径上摘出来）。

**选这个方案的原因**：
1. 改动小、当版可发——只动退出路径时序，不重构页面结构；
2. 把「销毁竞态」从「pop 动画进行中并发销毁」降级为「空闲期延后销毁」，实测崩溃频率显著下降；
3. 不影响 Android / H5 路径（平台行为差异隔离在 iOS 退出逻辑内）。

**定位**：这是**缓解，不是根治**——销毁仍然发生，只是搬到了安全窗口。

## 五、根治方向（已锁定、待实施）

**常驻 webview，永不销毁**：webview 挂常驻层，进会话 = 显示 + 换 src，退出 = 隐藏（不销毁）。依据是 B 场景铁证（不销毁则怎么折腾都不崩）。

实施前需确认入口覆盖（首页最近使用 / agent 列表 / 搜索均进会话页），以及历史尝试「常驻仍崩」的具体形态（挂在常驻页隐藏 vs 页面栈不 pop vs 切换时重建——形态不同结论不同）。此项列入下一步排期。

## 六、回归验收标准（测试同学）

- iOS 26 真机：会话页**来回进出 ≥15 轮**不崩溃（原复现强度 5 轮）；
- 退出会话返回列表 / 返回首页，动画与导航无异常、无白屏残留；
- Android / H5 同路径抽查不受影响。

## 七、实验设施与清理项

| 设施 | 状态 | 处置 |
|---|---|---|
| `pages/test-webview-crash/` 复现页 | 保留（未注册 pages.json） | 验收通过后删除 |
| `dist/m-shim/` 部署（history 静默 shim） | 实验设施，假设已证伪 | 不转正，可下线 |
| 崩溃 `.ips` 日志归档 | `unpackage/logs/ios/<UDID>/` | 留作 Apple/DCloud 工单证据 |

## 八、关联文档

- [vapor-mainline-sync-notes.md](vapor-mainline-sync-notes.md) —— 主线合并注意事项与回归清单（iOS26 崩溃回归项包含在内）
