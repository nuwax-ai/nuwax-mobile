# 真实 App 的 VoIP 业务接入

2026-11-09，分支 `feat/nuwa-basic-2026.11-voip-calls`。已合入两端一致的 `feat-2026.11@a8d6cc7db`；后端源码按 `nuwax-im/feat-video-meeting@fb880f2` 对接。本轮不修改后端，不合入明日普通发布分支，不上传基座。

## 当前入口与范围

使用完整“女娲Nuwax”App：同意隐私政策 → 登录测试环境 → 消息 → 真人联系人单聊 → 加号 → 语音/视频通话。安装身份仍为 `com.nuwax.app` / `__UNI__8BF05E4`。无需测试页面、Alice/Bob 身份或本地开发呼叫服务。真实 App 忽略专用测试宿主留下的开发身份。

当前仅在 **HBuilderX development 运行模式、测试地址 `https://testagent.xspaceagi.com`、Android/iOS** 开放入口。`isVoipPlatformAccepted()` 仍为 false；生产发行和鸿蒙入口未开放，不表示三端验收完成。能力由单聊详情及联系人 `subjectType=1` 判断；未知主体、群聊和智能体暂不开放。同账号的两台设备不作为主被叫，能力查询和创建均拦截呼叫自己。此判断是客户端联调范围，不代替后端能力声明。

## 协议与代码归属

| 环节 | 当前实现 |
| --- | --- |
| 会话资格、建房 | `servers/voipIm.uts` 复用统一请求、登录态与设备 ID；调用 RTC rooms，限制人数 2、空房回收 120 秒 |
| 业务与开发协议选择 | `servers/voip.uts` 的 `protocol=im-voip-v1/calls-v1`；开发服务和平台凭据保持隔离 |
| 单呼叫、页面、音频互斥 | `features/voip`；聊天页仅传 convId，页面不持有媒体或连接 |
| 后台控制、媒体、系统通话 | `uni_modules/nuwax-voip/utssdk/app-*` 原生单例；真实业务使用 IM WS，开发工具保留原 SSE |
| 普通 UniPush 邀请 | 既有 push 分发器只识别 `{type:"voip",convId,msgId}` 并交给功能；原生查询消息详情校验会话、时效及主体 |

主叫生成 callId/roomName → 创建 RTC 房间 → 原生获取本账号 RTC token → 连接并发布媒体 → 发送 `msgType=voip` 消息并保存 msgId。被叫接收邀请时不采集；点击接听并获得权限后入房，成功连接后调用 `/calls/answered`。主叫取消/超时调用 `/calls/ended`，被叫拒接调用 `/calls/declined`。通话中离房通过 LiveKit 对端离开事件结束另一端。

凭据映射为 `wsUrl → serverUrl`、`token → participantToken`。RTC 的 ISO expiresAt 不作为数字呼叫时效使用。邀请按消息 sendTime 加 60 秒过期；本地连接超时 30 秒。业务显示 active、开始计时必须同时有媒体连接与对端音频订阅。

独立原生 IM 连接使用现有 WS 协议 `im-v1`，控制路由为 `<physical baseId>#voip`，与普通消息连接的 deviceId 分开。握手 1000/1001、按服务端间隔心跳、断线重连；只 ACK VoIP 3002 邀请，处理 3007 通话事件，不注册额外 push 设备。收到拒绝或 KICK 时停止重连并报告错误。此连接仍占网关连接配额，需联调核对配额及普通消息离线推送。

**version 是客户端本地投影序号**，不声称后端提供了权威状态版本。已收到的取消/拒接终态会阻止同 callId 的迟到邀请恢复；退出或切账号使在途回调失效。主叫挂断或切账号时，正在发送的邀请若迟到成功，用捕获的原账号将其取消。重启、断线期间漏掉的状态仍需后端补偿。

## 本地 HBuilderX 基座

HBuilderX 与离线 SDK 均使用 **5.34**。脚本只修改此 worktree 的 `out/`，产物写 `out/voip-business-packages/` 及本 worktree `unpackage/debug/`，不安装、不上传。签名和 uni-push 配置仅通过受控本地路径传入，不提交。

```bash
# HBuilderX 已启动；绝对路径确保不使用主 checkout 或专用测试工程
/Applications/HBuilderX.app/Contents/MacOS/cli publish app \
  --type appResource --project "$PWD"

NUWAX_SIGNING_ENV=<受控签名环境文件> \
NUWAX_ANDROID_UNIPUSH_CONFIG=<匹配包名和签名的本地配置> \
  bash scripts/voip-native/package-business-android.sh

NUWAX_SIGNING_ENV=<受控签名环境文件> \
  bash scripts/voip-native/package-business-ios.sh

# 同名项目的 launch 命令存在歧义：给工作树导入一个唯一 IDE 名称。
# 链接放在工作树的同级，避免位于项目内部造成循环扫描。
ln -s nuwax-mobile ../hx-mobile-voip
/Applications/HBuilderX.app/Contents/MacOS/cli project open \
  --path "$(cd .. && pwd)/hx-mobile-voip"
# 使用 local 自定义基座模式，手机 Bundle ID/版本由 IPA/APK 读取。
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android \
  --project hx-mobile-voip --deviceId <Android序列号> --playground custom
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-ios \
  --project hx-mobile-voip --iosTarget device --deviceId <iPhone序列号> --playground custom --customType local
```

iOS 完整宿主包含完整业务资源、所有导出 UTS 模块、模块声明的本地 framework、ESPProvision 3.1.0/SwiftProtobuf 1.22.1、LiveKit 2.19.0 及 HBuilderX DebugServe；最低系统 15.0。它与专用测试宿主使用不同的生成目录；不注入 deviceTest 标记或测试启动页。Android 完整宿主启用 HX debug server，移除专用测试监听服务声明，保留正常 UniPush 依赖。

### HBuilderX 5.34 的 iOS 原生复用

本机 HBuilderX 动态 SPM 编译遇到 Xcode 索引目录参数错误；完整原生工程的同一 Swift 源码可正常构建。需要原生调试包装信息时，先让 HX 生成开发 Swift，再以 `NUWAX_IOS_HX_DEV_NATIVE=1` 执行 `package-business-ios.sh`，使用同一批生成代码构建完整宿主。`register-business-ios-cache.mjs` 核对 HX 版本、LiveKit 锁定版本、原生源文件、生成 Swift、构建时序及宿主签名后，登记实际已构建的原生缓存，并将成功的 HX 原生补丁整合、签名进宿主；校验失败会中止。`--verify-only` 只验证，不登记或打包。

```bash
NUWAX_IOS_HX_DEV_NATIVE=1 NUWAX_SIGNING_ENV=<受控签名环境文件> \
  bash scripts/voip-native/package-business-ios.sh
node scripts/voip-native/register-business-ios-cache.mjs
```

业务 `.uvue/.uts` 变更通过 HX 热更新；原生 Swift、插件 index.uts 或依赖变更需要重新构建并校验。IPA 使用保留显式目录记录的 ZIP 格式，供 HX 解析。以上流程未修改 HBuilderX 安装文件、未导出私钥、未上传包。大型项目首次开发编译需要充足 Node 内存；本次临时使用 8 GB，编译后恢复原设置。原生断点、后台来电及音视频通话仍需单独验收。

## 本轮真机状态

2026-11-09 已覆盖安装到 iPhone 16 与 Redmi，均为 `com.nuwax.app`、1.3.3（133）的完整 App。Android 覆盖前确认新旧签名一致，保留数据；从安装后的 APK 回读确认包含系统来电 Activity、通话服务和 HX debug server，没有专用测试标记或开发监听服务。两端均经 HBuilderX 同步并启动，iOS 设备中的 app-service.js 与当前开发产物 SHA-256 一致，同账号拦截已热更新。镜像核对完整消息页、联系人及“我的”版本信息通过。

互拨前需两个不同测试账号，彼此加为联系人并建立真人单聊。目前两机为同一账号，因此没有执行真实互拨，没有向现有联系人发消息或拨号。生产开关保持关闭，基座仅在本地。

## 验证与后端待补项

专项测试 56 项通过；全量 804 通过、37 项既有失败，失败名称相对合并基线没有新增。Android 全 App 编译、Swift 6 原生桥及鸿蒙未签名 HAP 构建分别留在 `out/voip-im-*.log`。构建、签名、安装和互拨的证据分开登记到[验收记录](voip-acceptance.md)。

以下仍是正式验收前置，不能以当前客户端适配替代：

- 测试环境已部署该后端分支、RTC 开关启用、两真实账号成功互拨；本轮尚无登录后的正式接口联调证据。
- 服务端持久化终态、断线补偿、账号忙线及原子抢接。当前 answered 事件不含获胜 deviceId，两个设备同时接听无法由客户端可靠裁决。
- 电话房间绑定主被叫/获胜设备并收紧 token 授权；当前同租户房间授权及 platform 级 identity 尚不满足该目标。
- 普通设备刷新不能清空 voipToken；PushKit token 的环境和精确撤销；鸿蒙原生 Push Token 的独立契约。
- 实际 PushKit、鸿蒙 VoIP、安卓厂商来电推送发送与冷启动原生接收。当前原生 WS 仅在进程有执行机会时工作，不能替代系统唤醒；普通 UniPush 回调不证明系统回收后可来电。
- 鸿蒙系统来电需要专用推送 native callId 和系统报告流程，当前入口保持关闭，不能用前台 ArkWeb 演示替代验收。
- 智能体真实媒体参与者、上下文及双向语音；当前真人 RTC 不声明模型视频能力。

后端逐项源码依据见[实际接口核对](voip-im-backend-review.md)。原[目标契约](voip-client-contract.md)保留作后端增强目标，不是当前已部署接口清单。
