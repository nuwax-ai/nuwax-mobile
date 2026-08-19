# 交接:三星真机聊天页 Activity/WebView 泄漏 + 桥死锁(全 tab 点击失效/发烫/回欢迎屏)

> 分支:`feat/nuwa-zhuoda-2026.07-perf-vdom`(vdom / Android 离线 SDK **5.15**)
> 设备:Samsung SM-S9310(Galaxy S25 国行)/ Android 16
> 日期:2026-08-07
> **结论:泄漏在 DCloud uni-app x 框架静态字段(`UTSAndroidV2Impl.doActivityCallbackMap` / `IndexKt.$pageManager`),app 代码不可修。LeakCanary 引用链铁证。已穷尽 app 侧方案,需 DCloud 修 SDK。**
> **决定性对照(2026-08-07 晚):同一份代码 ☁️云打包 APK 完全不泄漏(Act 峰值4回落2~3 / WebView 峰值2回落0),仅本地离线 SDK 5.15 自定义基座泄漏 → 离线 SDK 5.15 运行时特有 bug;☁️云打包是现成生产 workaround。**

---

## TL;DR

反复进聊天/agent 详情页 → **每次 `navigateTo` 新建一个隐藏 markdown-proxy WebView + Activity → 返回时框架静态 Map 没清掉 WebView 回调 → WebView+Activity 永久泄漏 → 累积 → 内存打爆 → JS↔WebView evalJS 桥死锁 → 全 tab 点击失效、发烫、被 OOM 杀→冷启动进欢迎屏。**

- **泄漏(根因)**:`io.dcloud.uts.UTSAndroidV2Impl.doActivityCallbackMap`、`io.dcloud.uniapp.framework.IndexKt.$pageManager` 在 Activity#onDestroy 后**不清理**。**app 代码(reset / `WebView.destroy()` / v-if / onUnload 全面清理)实测全拦不住**——引用链在框架静态字段,app 碰不到。
- **✅ 现成 workaround:☁️云打包**。同代码云包实测不泄漏(Act 峰值4回落2~3 / WebView 峰值2回落0),泄漏仅存在于**本地离线 SDK 5.15 自定义基座**。生产发版走云打包即绕开。
- **桥死锁 D**:JS↔markdown-proxy WebView 的 evalJS/callback 桥被打满/死锁。**单个含公式聊天(W=1)即可冻死。**(conv-stream 在啃,独立于泄漏。)
- **加重项**:聊天页重度(单聊 +~2400 View、+400~585M PSS)——list-view 回收模式与 mermaid/表格渲染冲突(mermaid 靠 proxy WebView,回收即崩;表格高度量不准),**只能 scroll-view 全量渲染**,View 数压不下。

---

## 🎯 真凶:LeakCanary 引用链(DCloud 框架)

debuggable-release 自定义基座(`ANDROID_BUILD_TYPE=debug make android-tester`,带 LeakCanary)复现,LeakCanary `HEAP ANALYSIS RESULT` 打出 **2 条 APPLICATION LEAK**,全部指向框架静态字段:

**Leak 1(主,~250–290KB)— WebView 回调 Map 不清:**
```
GC Root: Thread → PathClassLoader → UTSAndroidV2Impl class
↓ static UTSAndroidV2Impl.doActivityCallbackMap          ← ★ 框架静态 LinkedHashMap
→ WebViewActivityCallback → .webview → NativeWebViewImpl
→ Leaking: YES (View.mContext references a destroyed activity)
╰→ io.dcloud.uniapp.appframe.activity.UniPortraitPageActivity (mDestroyed=true)
```

**Leak 2(~24KB)— 页面 frameList 不清:**
```
GC Root: Thread → IndexKt class
↓ static IndexKt.$pageManager                             ← ★ 框架静态
→ UniPageManagerImpl.frameList → ArrayList[0] → frame(a) → .N → View
→ Leaking: YES (View.mContext references a destroyed activity)
╰→ io.dcloud.uniapp.UniAppActivity (mDestroyed=true)
```

→ `doActivityCallbackMap`(WebView 回调 Map)+ `$pageManager`→`frameList`(页面 frame 列表)destroy 后不清理 → WebView+Activity 永久持有。

---

## 症状(用户反馈)

进入 App、切页/滚动**用一会儿后**:① 对话/智能体/我的 所有 tab 列表点击都不跳转(滚动仍正常);② 退后台再进 = 欢迎屏(进程被杀);③ 发烫需强清。基线 `origin/feat/nuwa-zhuoda-2026.07` 即可复现,非 perf-vdom 回归。

---

## 真机证据(dumpsys meminfo)

复现工具:`bash scripts/grab-freeze-state.sh RFGYB3E15TZ`(看 `08_meminfo.txt` Views/Activities/WebViews、`05/06` 线程态、`09` 活动栈)。

**冻结现场签名:**
- `Views: 7625 / Activities: 23 / WebViews: 15 / TOTAL PSS: 436MB(+swap 95MB)`
- 全线程 **0.0% CPU、S(Sleep)**(含 JS 线程 `__UNI__8BF05E4_`、RenderThread)→ **不是 CPU 空转,是死锁/阻塞**。
- 前台 = `io.dcloud.uniapp.UniAppActivity`;任务栈 `sz=1` 但活 Activity=23 → 大量"已 finish 但未销毁"。

**泄漏轨迹(本地离线 SDK 5.15 基座,每 8s,反复进/出聊天):**
```
Views 98→1422  Activities 3→23  WebViews 0→15  PSS→427M   只涨不落,最终冻死
```
单聊开销:Views +~2400、PSS +400~585M。单聊(W=1)即可 0% CPU 冻死 → 桥死锁 D,非内存阈值。

## ☁️ 云打包对照(决定性,2026-08-07 晚)

同一份代码走 **DCloud 云端打包**(`__UNI__8BF05E4_0807173950.apk`,31M),同一台三星同样反复"进聊天→返回"5+ 次:

```
Activities: 峰值 4 → 回落 2~3     ✅ 不累积
WebViews:   峰值 2 → 回落 0       ✅ 返回即回收
PSS:        聊天瞬时 ~660M → 返回回落 ~430M 稳定  ✅
Views:      聊天瞬时 +2400 → 返回即掉回 ~100     ✅
```

→ **云打包运行时的框架版本/构建不存在该泄漏;泄漏是本地离线 SDK 5.15 自定义基座运行时特有。**
→ **生产发版可用云打包绕开**(当前生产上线线 `release/nuwa-zhuoda` 若走云打包即不受影响);本地自定义基座联调(ESP 配网/支付/推送等原生插件)仍受影响,需 DCloud 修离线 SDK。

---

## 已试方案(全部 ❌,印证根在框架)

| 方案 | 改动 | 结果 |
|---|---|---|
| Part 1 onUnload 全面清理(29e117c9) | 所有 $off/teardown/abort 搬到 onUnload + 补 page_preview_detail $off | Activity/WebView 照样累积 |
| `proxyWeb.reset()` 断单例 GC root | onUnload 补 reset | 无效(reset 只清 JS 引用) |
| `WebView.destroy()` 原生销毁 | `getElementById().getAndroidView<WebView>().destroy()` | 无效(编译过、不崩,但 Activity 仍累积) |
| v-if 移除 webview 元素 | onUnload 时 v-if=false | 无效(LeakCanary 复测仍报同一 doActivityCallbackMap 链) |
| 反射清空 doActivityCallbackMap | `Class.forName("...UTSAndroidV2Impl")` → `getDoActivityCallbackMap().clear()`(UTS 反射编译通过) | 无效(Activity/WebView 照样累积)——**清一条没用,还有 frameList/pageCacheMap 多条链同时持有** |

**多链铁证**:反射把 `doActivityCallbackMap` 清空了,dumpsys 仍 Activities 5/WebViews 3 累积 → 框架是**多条静态链**(doActivityCallbackMap + frameList + pageCacheMap + routeQueue)同时抓着 destroyed Activity;而 frameList/pageCacheMap 是**页面管理器的栈/缓存**,清错直接破坏导航。**app 侧无论清理/destroy/v-if/反射都够不着整套,且精准清多条敏感链风险极高、SDK 升级即失效。**

### 已排除的错误线索(别再追)
- **proxyWeb 单例持 webviewContext**(代码审计曾怀疑):LeakCanary 证明**不是** holder——真凶是 `UTSAndroidV2Impl.doActivityCallbackMap`,与 app 的 proxyWeb 无关。
- **事件轮询 death-spiral**(commit `8c7b471e`):按"CPU 空转"假设修,**不是根因**(卡死时 0% CPU)。该提交是有价值的隐患修复(去重/防 Loading 残留),保留;`EVENT_POLLING_DEBUG` 可关。
- **build 缓存**:已用 `CLEAN_CACHE=1 make android-tester` 清缓存重编排除。

### debug/release 行为差(关键坑)
- **HBuilderX 标准调试基座**(`cli launch`)→ **不复现**(Activity 正常 GC,LeakCanary 无泄漏结果)。
- **离线 SDK 自定义基座**(release / debuggable)→ **复现**。
- **☁️ DCloud 云端打包**(同代码)→ **不复现**(2026-08-07 实测,见上方云打包对照)。
- → 三种构建三种行为,**只有本地离线 SDK 5.15 自定义基座漏**。测泄漏/性能**必须自定义基座真机**,标准调试基座会误判(见 [[uniappx-perf-gotchas]])。

---

## 复现步骤

```bash
# 0. secrets:scripts/local-secrets.env(DCLOUD_APPKEY + ANDROID_RELEASE_*;
#    本机 /Users/apple/workspace/nuwax-signing/local-secrets.env 可拷)

# 1a. release tester(复现泄漏用):
make android-tester
# 1b. debuggable-release 自定义基座(跑 LeakCanary 找引用链用):
ANDROID_BUILD_TYPE=debug ANDROID_SIGNING_MODE=debug make android-tester  # → android_debug.apk(带 LeakCanary)
# 1c. 清缓存构建(排除缓存):
CLEAN_CACHE=1 make android-tester

# 2. 装三星
ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb
$ADB -s RFGYB3E15TZ install -r -d unpackage/debug/nuwa-zhuoda-release-*.apk   # 或 android_debug.apk

# 3. 复现:启动 → 反复"点进聊天 → 返回" 5+ 次(含公式/图表的聊天更快)
#    现象:点列表无反应、发烫、退后台进欢迎屏

# 4. 抓现场(冻结时别强杀)
bash scripts/grab-freeze-state.sh RFGYB3E15TZ

# 5. 实时盯泄漏计数器(可选):
: > /tmp/leak.log
while true; do
  P=$($ADB -s RFGYB3E15TZ shell pidof com.nuwax.app|tr -d '\r')
  [ -z "$P" ] && { echo "$(date +%H:%M:%S) 未运行"; sleep 8; continue; }
  M=$($ADB -s RFGYB3E15TZ shell dumpsys meminfo com.nuwax.app)
  echo "$(date +%H:%M:%S) V=$(echo "$M"|grep -oE 'Views:[[:space:]]+[0-9]+'|head -1|tr -dc 0-9) A=$(echo "$M"|grep -oE 'Activities:[[:space:]]+[0-9]+'|head -1|tr -dc 0-9) W=$(echo "$M"|grep -oE 'WebViews:[[:space:]]+[0-9]+'|head -1|tr -dc 0-9)" >> /tmp/leak.log
  sleep 8
done &
```

> release 包 console.log 被剥离(logcat 看不到 app 日志);要 app 级日志须 debuggable 包。

---

## DCloud 上报要点

- **环境**:uni-app x **5.15 VDOM**(**本地离线 SDK 自定义基座**),Samsung SM-S9310 / Android 16。标准调试基座不复现;**☁️云端打包(同代码)也不复现**——仅本地离线 SDK 5.15 自定义基座泄漏。
- **Bug**:`io.dcloud.uts.UTSAndroidV2Impl.doActivityCallbackMap`(static LinkedHashMap)与 `io.dcloud.uniapp.framework.IndexKt.$pageManager`→`UniPageManagerImpl.frameList` 在 Activity destroy 后未清理 → 持有 WebView 回调 / 页面 frame → Activity 泄漏。
- **复现**:进聊天页(agent-detail,含 markdown-proxy `<web-view>`)→ 返回 → 重复 5+ 次。`scripts/grab-freeze-state.sh` 或 debuggable-release 基座跑 LeakCanary。
- **影响**:WebView+Activity 累积 → OOM/冻死 → 全 tab 点击失效、发烫、回欢迎屏。
- **证据**:上方两条 LeakCanary 引用链(`HEAP ANALYSIS RESULT`)+ 云打包对照轨迹(云端 Act/WebView 有峰有落、本地离线 SDK 只涨不落)。
- **对照结论**:同一 commit 云打包 Act 峰值4回落2~3 / WebView 峰值2回落0;离线 SDK 5.15 自定义基座 Act 3→23 / WebView 0→15 只涨不落 → **离线 SDK 5.15 运行时与云端打包的框架构建不一致**,请 DCloud 对齐离线 SDK 与云端的框架版本/补丁。

---

## 附:返回逻辑审计(左滑手势 vs 返回键 vs 导航栏‹)

**uni-app x 框架语义:Android 左滑手势与物理返回键同源**——都是 activity back 事件 → 页面 `onBackPress(from='backbutton')`;`uni.navigateBack` 走 `from='navigateBack'`。框架代码无"手势/按键"分支,行为差异只能来自页面自己注册的逻辑。

**app 现状(三个 chat-conversation-component 宿主页全查过):**

| 页面 | 导航栏‹返回 | onBackPress |
|---|---|---|
| agent-detail | 有(show-back=true) | **无** |
| chat-temp | 有 | **无** |
| app-details | **无**(`:show-back="!isAppDetails"` 为 false,系统返回是唯一出路) | **无** |

两条返回路径的逻辑差异:
- **导航栏‹**(custom-nav-bar `onBackClick`):立即 `chatService.abort()` + `uni.navigateBack({delta:1})`(栈空 reLaunch 首页)。
- **系统返回(手势/按键)**:无任何接管,框架 pageManager 默认 pop;流式中止靠 onUnload 兜底(`29e117c9` 后已含 abort,功能等价、时机更晚)。

**本地泄漏基座上"系统返回落到 UniAppActivity、activity +1"的归因**:app 层没有任何代码能指定那个落点——是框架 pageManager 的 frameList 被泄漏污染后 pop 目标错乱,**与泄漏同根,非 app 逻辑 bug**。云包框架正常后两条路径都应正常回列表(实测吻合)。`enablePageCache` 两页均为 false,排除页面缓存因素。

**可选加固(与框架 bug 无关)**:给三个宿主页注册 `onBackPress`,`from=='backbutton'` 时先 `chatService.abort()` 再 `return false`(不拦截、只补动作,对齐导航栏路径),参照 `provision-progress.uvue:318`。注意:onBackPress 只在 back 事件到达 JS 页面层时有效——本地基座那种原生层错路由场景它不会触发,修不了落点。

---

## 待办

1. **报 DCloud**(根治离线 SDK):用上方引用链 + 上报要点提 issue,让其在离线 SDK 修 `doActivityCallbackMap` / `$pageManager` 的 destroy 清理(或与云端构建对齐)。
2. ~~云端打包对照~~ **✅ 已完成(2026-08-07 晚):云打包不泄漏,离线 SDK 5.15 特有。**
3. **生产发版策略**:`release/nuwa-zhuoda` 生产上线**走云打包即可绕开**;仅本地自定义基座联调(ESP/支付/推送)受泄漏影响。
4. **桥死锁 D**(conv-stream):evalJS 桥背压,独立于泄漏,conv-stream 主导。(注:云包轨迹中 W 峰值2即回落,单聊冻死是否随云打包一并消失需另测——桥死锁 D 与泄漏是两条独立线。)
5. **过渡缓解(治标,空间有限)**:减少 WebView 创建(内容门控——但 list-view 与 mermaid/表格冲突,只能 scroll-view 全量,降负载空间小)。

---

## 相关提交 / 文件

- `8c7b471e` fix(event-polling):轮询去重+诊断(**误判本次根因,保留为隐患修复**)
- `6ea44189` fix(android-build):按版本隔离 work 树 + configure_settings 幂等 + `ANDROID_BUILD_TYPE`/`CLEAN_CACHE` 环境变量化(支持 debuggable-release 基座)
- conv-stream:`6381bbe4`(流式渲染卡死修复+脚手架)、`b7891360`(mermaid 去重)、`29e117c9`(onUnload 清理,对本次泄漏无效)、`2db9d6d2`→`bd1dfa12`(list-view 迁移**已回滚**到 scroll-view:与 mermaid/表格渲染冲突)
- 工作树未提交:`scripts/grab-freeze-state.sh`(抓现场)、`scripts/android-esp/build_tester_release_apk.sh`(CLEAN_CACHE/debug 变体开关)、本文件
- 工具:`scripts/grab-freeze-state.sh <serial>`;debuggable-release 基座(`ANDROID_BUILD_TYPE=debug make android-tester`)
- 相关 memory:`home-perf-vdom-status.md`(根因已更正为框架泄漏)、`uniappx-perf-gotchas.md`(调试基座≠正式包 等)
