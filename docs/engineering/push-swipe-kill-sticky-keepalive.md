# 划掉任务后推送断连的技术方案：STICKY 锚点服务（Android，仅非厂商通道设备）

面向：nuwax-mobile 端上开发。
前置阅读：[im-offline-push.md](im-offline-push.md)（现有 uni-push 2.0 链路）、
[im-push-fallback-plan.md](im-push-fallback-plan.md)（2026-11-04 的 FGS + WebSocket 兜底计划，本文是其**简化替代方案**）。

状态：**方案稿**（2026-11-24）。调研基于真机 + 反编译实证，代码未落地。

---

## 0. 一句话目标

让「**没有厂商推送通道**」的 Android 设备（首要目标：国行三星），在用户从最近任务划掉 App 之后，
仍能通过 **个推自建通道** 收到离线推送 —— 做法是新增一个 `START_STICKY` 锚点服务，
被系统杀掉后由 AMS 自动拉活，进程回来后让个推自己重连长连接。

不引入第二套推送通道，不改厂商通道设备的行为，不挂常驻通知。

---

## 1. 背景

### 1.1 现状

- 端上推送走 uni-push 2.0（底层个推 SDK 3.3.7.0）。
- 国内发版只配置了 **华为 / 荣耀 / 小米 / OPPO / vivo** 五家厂商通道（`manifest.json` 的 `app-android.distribute.modules.uni-push`）。
- **FCM 未配置**（`utils/push/pushBackgroundStatus.uts` 的 `fcmConfigured = false`）。
- 因此 `vendor == "none"` 的设备（典型：国行三星）只能走个推**自建通道**——`com.nuwax.app:pushservice` 进程里维持一条 TCP 长连接。

### 1.2 问题

用户从最近任务向上划掉 App 后，`:pushservice` 进程连同主进程一起被系统杀掉，长连接断开。
由于该进程不能再自动恢复，**此后所有离线推送都收不到，直到用户手动重新打开 App**。

### 1.3 已有的相关能力

| 能力 | 位置 | 说明 |
|---|---|---|
| 厂商判定 | `utils/push/pushBackgroundStatus.uts` `readVendor()` | 返回 `huawei/honor/xiaomi/oppo/vivo/fcm/none/unknown` |
| 手动设置引导弹窗 | `utils/push/pushBackgroundGuide.uts` | 首次登录后 6.5s，`vendor == "none"` 且需要设置时弹 |
| 「我的」页状态入口 | `subpackages/pages/settings/settings.uvue` | 展示并跳转电池优化设置 |

---

## 2. 调研结果（真机 + 反编译实证）

测试设备：Samsung One UI，`com.nuwax.app`，Android 14 类 ROM（软件版本号见 `Build.VERSION`）。
所有结论均来自**设备实测日志**与**设备自带 `services.jar` / APK 反编译**，非 AOSP 通用常识推断。

### 2.1 现象：划掉后整包进程被杀

```
15:12:01.220 I/ActivityManager: Killing <pid>:com.nuwax.app:pushservice/u0a16 (adj 500): remove task
15:12:01.220 I/ActivityManager: Killing <pid>:com.nuwax.app/u0a16          (adj 100): remove task
```

`reason` 恒为 `remove task`，无 OOM / LMKD / crash / ANR。划掉后 `ps -A | grep nuwax` 与
`dumpsys activity services com.nuwax.app` 均为空。

### 2.2 根因一：三星按「包名」而不是「task 内进程」收集待杀进程

反编译设备 `services.jar`（`classes3.dex`），三星定制了
`com.android.server.wm.ActivityTaskSupervisor.killTaskProcessesIfPossible(Task)`：

```
0003: task.getBasePackageName()                 → "com.nuwax.app"
0009: mService.mProcessNames.getMap()           → 遍历全系统进程表
002e: if (app.mUserId != task.mUserId) continue
0035: if (app == mService.mHomeProcess) continue
0038: app.containsPackage(basePackageName)      → ★ 只要进程"包含这个包"就通过
003f: app.shouldKillProcessForRemovedTask(task)
0046: app.hasForegroundServices() && isAutoRunBlockedApp() → 两者都真才放弃
0064: list.add(app)
```

随后 `ActivityManagerService$LocalService.killProcessesForRemovedTask(list)` 对列表内每个
`ProcessRecord` 调 `killLocked("remove task", ...)`。

原始 AOSP 只收集 task 内 activity 所属进程；三星把范围扩大到**所有同包名进程**，
所以 `:pushservice`（不属于该 task）也被一起算进来。

日志中还有三星自己的埋点可佐证这条链路是「用户手势移除」策略：

```
D/ActivityManager: [SD] user menu kill listen remove action name:com.nuwax.app uid:10016
```

### 2.3 根因二：这条链路不认任何省电状态

`shouldKillProcessForRemovedTask` 的实现（`WindowProcessController`）只遍历 activities：

```
for each activity:
    if (!r.mAppStopped) return false
    if (taskId != removedTask.mTaskId && task.inRecents) return false
return true
```

**完全不看前台服务、电池优化、Doze 白名单、待机桶。**

实测验证：把 App 加入电池优化「不受限制」后（`dumpsys deviceidle whitelist` = `user,com.nuwax.app,10016`，
`am get-standby-bucket` = `5` = `EXEMPTED`），划掉仍然被杀，日志与之前逐字相同。

### 2.4 根因三：个推的 Service 是 `START_NOT_STICKY`，不会被系统重启

APK 反编译（`classes3.dex`）：

- `uts.sdk.modules.DCloudUniPush.UniPushService` 是**空壳子类**，`extends com.igexin.sdk.PushService`，
  只有 `<init>()V`，**没有任何方法 override**。
- `com.igexin.sdk.PushService.onStartCommand` 完整字节码（12 code units）：

  ```
  0000: invoke-super {v1,v2,v3,v4}, Landroid/app/Service;.onStartCommand:(Intent;II)I
  0003: ServiceManager.getInstance()
  0007: invoke-virtual ServiceManager.a:(Service;Intent;II)I    ← 返回值被丢弃
  000a: const/4 v2, #int 2                                      ← START_NOT_STICKY
  000b: return v2
  ```

- `com.igexin.sdk.GTIntentService.onStartCommand` 同样 `const/4 v1, #int 2` 后 `return`。
- 全 dex 检索：`onTaskRemoved` 命中 **0** 次，`startForeground` 命中 **0** 次。

Manifest（官方 `uni-push-release.aar` 内与打包后 APK 一致）：

```xml
<service
    android:name="uts.sdk.modules.DCloudUniPush.UniPushService"
    android:exported="true"
    android:label="PushService"
    android:process=":pushservice" />
```

无 `android:stopWithTask`、无 `android:persistent`、无 `android:foregroundServiceType`。

划掉后的实际日志：

```
W/ActivityManager: Scheduling restart of crashed service ...UniPushIntentService in 1000ms for connection
```

只有 `for connection`（bind 重连），**没有 `for start-requested`，也没有后续的 `Start proc`**
——因为 bind 它的客户端（`:pushservice`）也在同一毫秒死了，重连调度到点后无事可做。

### 2.5 对照实验：钉钉为什么能活

同一台设备、同样的划掉动作，钉钉（`com.alibaba.android.rimet`）：

```
15:12:01.220 Killing 14499 :gpu_process          (adj 0): remove task
15:12:01.220 Killing 13989 :normal_render_proc0  (adj 0): remove task
15:12:01.220 Killing 10847 主进程                 (adj 0): remove task
15:12:01.222 Killing 11378 :channel              (adj 100): remove task
        ↑ 被杀得和女娲一样干净

15:12:01.342 Scheduling restart LWPService in 1000ms for start-requested
15:12:02.361 Start proc 18020 com.alibaba.android.rimet for service {LWPService}
        ↑ 1.38 秒后整个进程被拉回来了（PID 全换新）
```

关键差异（`dumpsys activity services` 的 `stopIfKilled` 字段）：

| | 女娲 | 钉钉 |
|---|---|---|
| 长连接服务 | `UniPushService` | `LWPService` |
| `onStartCommand` 返回 | **2**（NOT_STICKY） | **1**（STICKY，`stopIfKilled=false`） |
| 重启调度 | `for connection` | `for start-requested` |
| 结果 | 进程消失 | 1.38s 后拉活 |

**结论：两台设备被杀的方式完全相同，差别只在 `onStartCommand` 的返回值。**

钉钉同时有 13 个服务、0 个前台服务，也没有用常驻通知 —— 说明「前台服务」不是这个问题的必需项。

---

## 3. 产品闸门（重要）

### 3.1 只在「没有厂商通道」的设备启用

判定口径与现有 `readVendor()`（`utils/push/pushBackgroundStatus.uts`）完全一致，
即 `vendor == "none"`。

实现上不能直接调 `getPushBackgroundStatus()`：`pushBackgroundStatus.uts` 反向 import 了
`imPushClient.uts`（`getImNotifyPermissionState`），在 `imPushClient` 里引用会形成循环依赖。
因此接入点改为调用纯策略层的 `classifyOemPushVendor()`（`utils/push/pushBackgroundPolicy.uts`，
无任何项目内依赖）。

**两者等价**：`pushBackgroundStatus` 里 `fcmConfigured` 恒为 `false`，因此 `fcmForVendor`
恒为 `"unavailable"`，`resolvePushSystemVendor` 在 OEM 未命中时必然返回 `"none"`。
即「OEM 未命中 ⟺ vendor == none」。

> ★若将来接入 FCM 并把 `fcmConfigured` 改为 `true`，接入点必须同步改成走 `readVendor` 口径，
> 否则装了 GMS 但 OEM 未命中的设备会被误判。

| vendor | 行为 |
|---|---|
| `huawei` / `honor` / `xiaomi` / `oppo` / `vivo` / `fcm` | **不启动**锚点服务，离线推送继续走厂商通道，行为完全不变 |
| `none` | 启动锚点服务 |
| `unknown` | **不启动**（fail-safe，与现有 `vendorPushAvailable = vendor != "none"` 口径一致） |

### 3.2 闸门必须用 `vendor`，不能用「是否弹过窗」

现有弹窗的触发条件是：

```ts
if (status.vendor != "none" || !status.manualSettingsRequired) return;
```

`manualSettingsRequired` 是**状态**：用户按引导把电池优化设好后它变成 `false`，弹窗不再出现。
但设备仍然是 `vendor == "none"`，划掉照样被杀。

> **因此闸门条件 = `vendor == "none"`（设备属性，恒定），而不是「该用户见过弹窗」。**

反过来也存在：用户点了「稍后」（30 天冷却）从没设置过，`manualSettingsRequired` 仍为 `true`
但没弹窗 —— 这类用户同样是目标人群。

### 3.3 与现有电池引导的关系

**保留现有弹窗，两者是互补关系，不是替代：**

- 电池优化白名单解决的是 **Doze / 后台限制 / 待机桶** 导致的「不划掉也被冻结」；
- 锚点服务解决的是 **划掉后被 kill** 这一个特定场景。

---

## 4. 技术方案

### 4.1 总体链路

```
用户划掉最近任务
  └─ 三星 killTaskProcessesIfPossible → 包内所有进程 kill("remove task")
       ├─ 主进程                              消失（正常，下次启动重建）
       └─ :pushservice（含个推长连接）        消失
            ↓ ~1000ms（AMS 服务重启退避，首次 1s）
  └─ AMS 发现有一个 START_STICKY 且 startRequested 的服务 → Start proc :pushservice
       └─ PushKeepAliveService.onCreate / onStartCommand
            └─ startService("uts.sdk.modules.DCloudUniPush.UniPushService")
                 └─ 个推 SDK 重新初始化 → 重连长连接 → 服务端离线消息下发
```

### 4.2 新增 UTS 插件 `uni_modules/nuwax-push-keepalive`

平台范围：**仅 `app-android`**（iOS/鸿蒙不涉及）。

目录结构（照抄 `nuwax-stream-pcm-player` 的既有模式）：

```
uni_modules/nuwax-push-keepalive/
├── package.json
└── utssdk/
    └── app-android/
        ├── config.json
        ├── AndroidManifest.xml
        ├── index.uts                     ← 桥接层：ensurePushKeepAlive()
        └── src/com/nuwax/pushkeepalive/
            └── PushKeepAliveService.kt   ← 服务本体
```

> **为什么服务本体用 Kotlin 而不是 UTS**：项目已有明确结论（`nuwax-stream-pcm-player` 注释）——
> 「UTS 里 `extends Service` 生成的父类声明不带构造调用，Release 编不过」。沿用 Kotlin。

#### `PushKeepAliveService.kt` 关键点

```kotlin
class PushKeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureGeTuiOnline()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureGeTuiOnline()
        return START_STICKY          // ★ 唯一的目的：让 AMS 在进程被杀后重新拉起
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        ensureGeTuiOnline()          // 对走 stopService 而非直接 kill 的 ROM 兜底
    }

    private fun ensureGeTuiOnline() {
        try {
            val i = Intent().setClassName(packageName, GETUI_SERVICE)
            startService(i)          // ★ 不能用 startForegroundService
        } catch (_: Throwable) {
        }
    }

    companion object {
        private const val GETUI_SERVICE = "uts.sdk.modules.DCloudUniPush.UniPushService"
    }
}
```

四个必须遵守的约束：

1. **返回 `START_STICKY`** —— 这是整个方案生效的唯一原因。
2. **不能对 `UniPushService` 用 `startForegroundService`** —— 它不会在 5 秒内调 `startForeground`，
   会触发 `RemoteServiceException` 直接崩溃。
3. **用类名字符串而不是类型引用** —— 避免编译期依赖 uni-push 的 aar。
4. **不调用 `startForeground`** —— 产品上不挂常驻通知（钉钉的做法也没有前台服务）。

#### `AndroidManifest.xml` 片段

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="uts.sdk.modules.nuwaxPushKeepalive">
  <application>
    <service
        android:name="com.nuwax.pushkeepalive.PushKeepAliveService"
        android:exported="false"
        android:process=":pushservice" />
  </application>
</manifest>
```

`android:process=":pushservice"` 是刻意的：让锚点服务与个推**同进程**，进程被拉起时个推 SDK 的
静态状态也在同一进程，重连成本最低。不需要 `android:stopWithTask`（默认 `false` 即可）。

#### `index.uts` 桥接

```ts
const KEEPALIVE_SERVICE = "com.nuwax.pushkeepalive.PushKeepAliveService"

/** 幂等：重复调用只会重新 startService。 */
export function ensurePushKeepAlive(): void {
  const activity = UTSAndroid.getUniActivity()
  if (activity == null) return
  try {
    const intent = new Intent()
    intent.setClassName(activity, KEEPALIVE_SERVICE)
    activity.startService(intent)
  } catch (e) {
    console.warn("[push-keepalive] start failed " + e)
  }
}
```

### 4.3 接入点

已落地在 `utils/im/imPushClient.uts` 的 `bindImPushClient()`：

- `bindImPushClient()` 是幂等的推送监听绑定入口，登录后由 `scheduleImPushAfterLogin` 调用，
  已登录冷启动还会经 `bindImPushClientIfLoggedIn` 在 `onLaunch` 提前绑定一次 —— 两条路径都覆盖。
- 启动语句放在 `if (pushBound) return` **之前**：本函数存在「冷启动已绑定、登录后又调一次」
  的情况，放守卫之后会漏启动。函数内部有自己的 `pushKeepAliveEnsured` 一次性闸门，
  重复调用无副作用。
- 时机在 `registerPushListener()`（即 `uni.onPushMessage`）之前，但锚点服务本身不做 SDK 依赖，
  它只是把 `UniPushService` start 起来，SDK 未就绪时由该服务自己完成初始化。

```ts
// #ifdef APP-ANDROID
function ensurePushKeepAliveIfNoVendorChannel(): void {
  if (pushKeepAliveEnsured) return;
  pushKeepAliveEnsured = true;
  try {
    const oem = classifyOemPushVendor(`${Build.MANUFACTURER}`, `${Build.BRAND}`);
    if (oem != "none") return;          // ★ 厂商通道设备不启动
    ensurePushKeepAlive();
  } catch (e) {
    console.warn(`[ImPush] 保活锚点启动失败: ${e}`);
  }
}
// #endif
```

合规：`bindImPushClient` 本身已经会初始化个推 SDK（`onPushMessage`），锚点服务不额外
引入「同意前初始化第三方 SDK」的问题。

### 4.4 需要重新打包

新增原生 Service + Manifest 声明，**热更无效**，必须重新打自定义基座（或云打包）。
仅改 uvue/uts 业务代码时不受影响。

---

## 5. 风险与限制（必须向上说明）

1. **AMS 重启是退避的**。首次约 1s（钉钉实测 1000ms），反复被划掉后延迟会递增（钉钉同期其他服务
   出现 11000ms / 20047ms / 30036ms / 39972ms 的错峰值），上限约 60s。不是每次都能 1 秒回来。
2. **拉活到重连之间有断线窗口**（通常 1–5 秒）。这段时间到达的消息能否补收，**取决于个推控制台的
   「离线消息保存时长」配置**——端上改不了。上线前需要去个推控制台确认该值并记录。
3. **用户「强行停止」（设置里）之后，STICKY 也不会重启**。这是 Android 系统行为，无解。
4. **三星若把 App 判为"异常耗电"可能追加限制**。目前调研中未观察到，但无法排除。
5. **不能 100% 等价于厂商通道**。这是「显著改善」，不是「彻底解决」。厂商通道由系统级服务投递，
   进程死不死都能收；自建通道永远受进程存活约束。

---

## 6. 验证方法（真机）

前置：重打基座并安装后，登录 → 确认 `vendor == "none"` 设备上服务已启动。

```bash
ADB=/Applications/HBuilderX.app/Contents/HBuilderX/plugins/launcher-tools/tools/adbs/adb

# 1. 确认锚点服务已启动（应出现在 :pushservice 进程）
$ADB shell "dumpsys activity services com.nuwax.app" | grep -E "ServiceRecord|stopIfKilled"

# 2. 从最近任务划掉 App

# 3. 期望看到：kill + 1s 后 Start proc
$ADB logcat -d -v time | grep -E "nuwax" | grep -iE "Killing|Scheduling restart|Start proc"

# 期望输出形如：
#   Killing <pid>:com.nuwax.app:pushservice (adj 500): remove task
#   Killing <pid>:com.nuwax.app (adj 100): remove task
#   Scheduling restart of crashed service ...PushKeepAliveService in 1000ms for start-requested
#   Start proc <newpid>:com.nuwax.app:pushservice for service {...PushKeepAliveService}

# 4. 确认进程回来了且个推服务在跑
$ADB shell "ps -A | grep nuwax"
$ADB shell "dumpsys activity services com.nuwax.app" | grep UniPushService

# 5. 端到端：划掉后从另一台设备发一条 IM 消息，观察本机是否收到通知
```

失败判据：划掉后 30 秒内 `ps -A | grep nuwax` 仍为空 → 锚点服务未生效（检查 manifest 是否进了包、
是否返回了 `START_STICKY`）。

---

## 7. 不做什么

| 不做 | 原因 |
|---|---|
| **接 FCM** | 国内大量设备无 GMS；`fcmConfigured = false` 已是既有决策 |
| **WebSocket + 本地通知兜底** | 原 `im-push-fallback-plan.md` 的方案，需自建第二条通道与本地通知体系，代价远高于锚点服务 |
| **前台服务 / 常驻通知** | 钉钉 13 个服务 0 个前台服务，证明不是必需；且三星该路径不认 FGS |
| **换极光等其它 SDK** | 极光在国内同样没有三星厂商通道，底层仍是个推同构的 TCP 长连接（既有 §0.5 结论） |
| **在厂商通道设备上启用** | 无收益，且会额外拉起一个常驻进程 |
| **改 `AndroidManifest.xml` 的 `android:persistent`** | 该属性只对系统签名应用有效，第三方声明会被忽略 |

---

## 附：证据出处

| 结论 | 出处 |
|---|---|
| 三星按包名收集待杀进程 | 设备 `services.jar` → `classes3.dex` → `ActivityTaskSupervisor.killTaskProcessesIfPossible` @`4e4530` |
| 逐个 `killLocked("remove task")` | 同上 `classes.dex` → `ActivityManagerService$LocalService.killProcessesForRemovedTask` @`33ce60` |
| 不看 activities 以外状态 | 同上 → `WindowProcessController.shouldKillProcessForRemovedTask` @`5f8eac` |
| 个推返回 NOT_STICKY | `base.apk` → `classes3.dex` → `com.igexin.sdk.PushService.onStartCommand` |
| 个推无 onTaskRemoved / 无 startForeground | 全 dex 检索命中 0 |
| SDK 版本 3.3.7.0 | APK manifest `meta-data GTSDK_VERSION` |
| service 声明属性 | 离线 SDK `uni-push-release.aar/AndroidManifest.xml` |
| 钉钉 STICKY 拉活 | 真机 `logcat` + `dumpsys activity services`（2026-11-24） |
| 电池优化无效 | 真机实测：白名单 + `EXEMPTED` 待机桶下划掉仍被杀（2026-11-24） |
