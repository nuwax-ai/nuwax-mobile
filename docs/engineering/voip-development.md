# VoIP 开发与原生构建

当前实现处于三端接入验证阶段。`isVoipPlatformAccepted()` 为 false；正式接口未实现时生产入口隐藏。只能在 development 构建中主动配置独立开发身份。不要通过把此函数改为 true 来跳过验收。

Android / iPhone 专门测试页与签名安装包见 [真机测试包说明](voip-device-testing.md)。它通过原生 Debug 和显式包标记允许独立开发身份，启动直接进入测试页，仍不打开生产入口。

## 本地联调

```bash
pnpm install --frozen-lockfile
pnpm voip:dev
```

需要 Docker。固定 `livekit/livekit-server:v1.13.11`，本地信令默认 7890；LiveKit 7880/TCP、7881/TCP、7882/UDP。随机开发密钥仅写入忽略的 `out/voip-dev/`，权限 0600；进程退出时关闭其 compose 项目。不会连接平台账号或正式后端。

用 ego-browser 打开 localhost:7890，两页分别选 alice/bob 并登录，选择 alice↔bob；发起、接听、挂断。第三种身份 agent 会自动接听并发布合成音轨；它是明确的媒体替身，不验证 ASR、模型、TTS、上下文或真人音色。勾选“合成测试音频”可在不申请麦克风时检验真实 WebRTC；真人麦克风需由用户在浏览器授权。`nuwaxVoipDevStats()` 只返回状态和 RTP 统计，不返回 JWT。

手机联调需指定电脑 LAN IPv4，并让手机可访问对应端口：

```bash
VOIP_ADVERTISE_IP=192.168.1.100 VOIP_DEV_HOST=0.0.0.0 pnpm voip:dev
```

手机 development 构建进入 `subpackages/pages/voip-dev/voip-dev`，输入 `http://192.168.1.100:7890`，选择 Alice/Bob。开发身份与平台身份独立；退出开发身份会清理原生呼叫。发行构建不读取这个开关。真实环境必须 HTTPS/WSS；iOS LAN HTTP 仅可在隔离调试包中加 ATS 例外，不把例外合入正式 manifest。

```bash
pnpm voip:test
pnpm voip:prepare
pnpm voip:ios:check  # Xcode 原生桥编译；不安装、不签名
```

`voip:prepare` 从锁定的 JS SDK 重建 `static/app/voip/{media.html,media.js,versions.json}`，输出忽略。`hx-cli.sh` 每次 App 编译前都会执行。`offline-h5:clean` 只删 offline-h5 资源，保留其他 App 静态资源。

## HBuilderX 与隔离

本次本机 HX 为 **5.34.2026102909**。`scripts/local-base-env.sh` 旧默认 5.24 不适用，必须显式指定 5.34。所有 SDK 工作副本、资源、DerivedData、调试包放当前 worktree 的 `out/` 或 `unpackage/`；不能修改主 checkout 的 `unpackage/debug` 或共享 SDK 的 work 工程。

```bash
export NUWAX_HX_VERSION=5.34
export NUWAX_LOCAL_BASE_ROOT="$PWD/out/voip-native-work"
export ANDROID_ESP_WORK="$NUWAX_LOCAL_BASE_ROOT/android"
export IOS_ESP_BUILD_ROOT="$NUWAX_LOCAL_BASE_ROOT/ios"
export NUWAX_MAIN_ROOT="$PWD"
source scripts/local-base-env.sh
```

只把与 5.34 对应的只读 SDK 源复制进这些工作目录。Android Kotlin 2.2 / LiveKit 2.30.0、Core-Telecom 1.0.0；iOS LiveKit 2.19.0 exactVersion SPM，安装下限 15.0。依赖更新必须同步 native config、锁文件与本文件，再重新出自定义基座。标准基座不含新插件；UTS 转译成功不能证明 SDK、manifest、SPM、前台服务或推送已进入安装包。

## 鸿蒙可重复生成

Harmony 的媒体宿主为原生 `NuwaxVoipMediaAbility`，媒体与通话控制不依赖 UTS 聊天页。Ability 内 ArkWeb 使用打包资源，不远程加载可变 JS。跨桥只传本次短期媒体凭据；平台登录 token 只留原生控制层。返回键把主 Ability 提到前台，保留媒体 Ability 与 VoIP 长时任务；挂断必须销毁资源。

HBuilderX 生成 Harmony 原生工程后、hvigor 编译前执行：

```bash
pnpm voip:prepare
pnpm voip:harmony:assemble -- "$PWD/unpackage/dist/dev/app-harmony"
```

assemble 入口使用 DevEco 自带的 Node/JBR/hvigor，先执行 prepare 再编译 HAP。prepare 脚本只允许修改当前 worktree 忽略目录下的工程；合并权限、单个推送监听、媒体 Ability 和页面路由，并复制模板、i18n reason 和 ArkWeb 资源。重复执行不增加重复项；发现其他 Ability 已拥有 push listener 则拒绝构建，让维护者协调现有 uni-push 接收方，不能默默抢占。模板源在 `scripts/voip-native/harmony/`，不手改生成目录。每次 HBuilderX 重生成工程后都须重新运行该步骤；正式打包入口须把它设为 hvigor 前置步骤。

**ArkWeb 能否在后台/锁屏持续双向音频必须以真机验证为准。** 30 分钟、系统应答、回收后冷启动任一未通过，鸿蒙开关保持关闭。前台两页演示不能作为替代。

## 集成边界

客户端应用层集中在 `features/voip`，目录和对外入口见 [模块说明](../../features/voip/README.md)。正式接口切换、三端差异和对接批次见 [后端交接](voip-backend-integration.md)。


- `features/voip/callManager.uts`：账号隔离、单呼叫占用、原生事件收敛、权限、页面入口。
- `uni_modules/nuwax-voip`：三端原生媒体、系统来电与独立控制连接；UTS polling 只用于界面投影，后台不靠它运行。
- `features/voip/audioFocus.uts`：通话占用期间阻止录音/播报；释放后不自动恢复旧录音。消息音视频与通话互斥。
- Android 国内厂商 / FCM 接收器必须把通话邀请交给原生 `incoming()` hook；供应商具体分发配置和真机送达仍是验收项。不要把普通 IM 推送当作通话邀请。
- 后端按 [客户端契约](voip-client-contract.md) 实现；正式智能体由后端接入，开发合成音轨不能替代。

验收事实与未完成项见 [voip-acceptance.md](voip-acceptance.md)。
