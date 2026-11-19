# iOS 无进程来电：到公司后的操作细则

编写日期：2026-11-17，供 11 月 18 日及后续联调使用。对应真实女娲 App `com.nuwax.app`、工作树 `mobile-voip`、分支 `feat/nuwa-basic-2026.11-voip-calls`。总方案见 [厂商申请与完整流程](voip-cn-provider-onboarding.md)，当前代码交付见 [统一计划](voip-delivery-plan.md)。

**目标：补齐现有 UniPush／个推 → APNs VoIP → PushKit → LCK → LiveKit，随后验证 iPhone 上滑退出 App 后的来电。** 普通消息继续原 UniPush，复用现有 IM 和会议 RTC；先不新建 APNs 服务、不重复初始化推送 SDK、不默认双投。现有单测通过不表示这条投递已经完成；旧 IPA 没有后续待补的绑定／发送代码。

本清单区分“查看”“本地代码”“测试部署”“生产变更”。阅读控制台和准备本地补丁可以先做；任何生产应用配置、凭据、权益或部署的保存／替换／提交，都先让用户确认具体动作。测试部署也先说明目标、版本、变更和回退，再确认执行。本次文档整理没有执行这些动作。

## 0. 到公司先准备这些

| 谁准备 | 需要准备什么 | 完成标志 |
| --- | --- | --- |
| 你／测试同学 | iPhone 16 和已可用的 Android；两台登录不同的测试账号；USB 数据线和可访问测试服务的网络 | 知道各自显示名和真实单聊，避免打错联系人 |
| 移动端同学 | 本工作树和已推送代码；HBuilderX 5.34、匹配的离线 SDK；原生绑定增量的开发时间 | 不在主工作区、旧测试宿主或生产默认资源上修改 |
| 后端同学 | 现有 IM 测试服务、设备登记实现及 UniPush 调用位置；可交付具体测试部署版本 | 会议在线接打可用之外，明确谁补电话设备和触发发送 |
| DCloud／个推管理员 | 现有 DCloud 应用、UniPush 2.0 应用及云函数测试空间的访问权限 | 能查看本应用真实 VoIP 能力，不默认等同于普通 APNs |
| Apple 账号管理员 | 现有 App ID、开发 profile 和统一签名目录的使用权限 | 不需要重新申请整套签名 |

本机统一签名目录为 `/Users/apple/workspace/nuwax-signing`，配置入口 `local-secrets.env`。直接使用受控文件；不要把 P8、证书密码或完整 token 发到聊天、截图或 Git。

## 1. 固定联调对象与环境【你＋开发，只读】

- [ ] 确认分支和干净状态；有其他同学的未提交改动先保留，不覆盖。

```bash
cd /Users/apple/.codex/worktrees/mobile-voip/nuwax-mobile
git branch --show-current
git status --short
git log -3 --oneline
```

- [ ] 本次业务基线是 `ff8d49019`，已包含 `0936f019a` 的 PushKit／Keychain 修补。开始开发前 fetch 两个实际远程，核对专项会话提交及两端 `feat-2026.11`；需求线又有更新时按原约定保留双方提交并合入本分支，两端不同先查清差异，不强推。本次只整理文档，没有再次合入新需求代码；合并后须重新验证，不能沿用旧测试数字。
- [ ] 同一共享 Swift 文件顺序修改，不重复覆盖，不同时打包／安装。
- [ ] 两台手机都使用真实 App 的固定测试环境 `https://testagent.xspaceagi.com`，后端和云函数也选相应测试部署；记录云函数实际空间与版本，不能只看 App 的 API 地址。
- [ ] 记录两账号、主被叫方向、设备／系统版本、App 包摘要。优先 Android 主叫 → iPhone 被叫，不增加另一台 iPhone 的签名与系统版本变量。

**本步产物：一张环境卡：分支／提交、测试 API、IM 版本、云函数空间／版本、两台设备和账号。缺少测试云函数空间时先让管理员确认隔离方式，不向现有生产函数直接上传。**

## 2. 复核 Apple 现有材料【管理员，只读优先】

- [ ] Apple Developer → Certificates, Identifiers & Profiles → Identifiers → 选择 `com.nuwax.app`，确认 Push Notifications 已启用。
- [ ] 检查现有 APNs key 的授权范围、Team／Key ID 和私钥保管路径；本项目此前已核对现有 key 与开发 profile，不重复创建／撤销 key。
- [ ] 检查将用的开发 profile 包含 iPhone 16、与本地签名 identity 匹配且未失效；签名材料仍维护在统一目录。
- [ ] 出包后再回读已签 App 和内嵌 profile：bundle 一致，`aps-environment` 与宿主元数据一致，后台模式和隐私声明存在，真实启动 hook 已打入二进制。

当前既有开发包记录是 `development`；新包必须再次回读，不能按“测试环境”三个字推定 sandbox。APNs topic 应对应 `com.nuwax.app.voip`；凭据存在不等于供应商已配置该 topic。Apple key 可跨开发／生产鉴权与 token 投递环境匹配是两件事。见 [Apple 配置记录](voip-ios-push-handoff.md#2026-11-17-apple-developer-配置核对与开发签名更新)和 [Apple token 认证](https://developer.apple.com/help/account/capabilities/communicate-with-apns-using-authentication-tokens/)。

**本步产物：有效签名/profile、实际签名环境、凭据保管人与可用授权范围。若只缺配置核对，继续代码开发；不要为了测试新建生产 key。**

## 3. 问清 UniPush／个推的真实 VoIP 能力【管理员，可先提咨询】

打开 DCloud 开发者中心，选本应用 `__UNI__8BF05E4` 的 UniPush 2.0 服务；核对其实际关联应用和已有 iOS 凭据。已有普通 APNs 配置先保留。向技术支持提交下面的问题，按实际应用填写，不发私钥：

```text
应用：女娲Nuwax；DCloud AppID __UNI__8BF05E4；Bundle ID com.nuwax.app。
现状：使用 uni-app x / HBuilderX 5.34 的现有 UniPush 2.0，普通消息正常。
目标：真实一对一来电，通过现有唯一 PushKit registry 接原生系统通话。

请针对本应用确认：
1. options.ios.type=voip 是否可用；本应用的 VoIP topic 和凭据应在哪个入口配置？
2. 开发签名 token 与生产签名 token 的路由如何区分？请给实际支持的设置方式。
3. settings.strategy.ios=2 的厂商直投能力是否已开通？若未开通，申请入口、条件和可用替代方式是什么？
4. 现有 iOS SDK 绑定 PushKit token 到 CID 的正确生命周期、轮换和失效处理是什么？
5. 如何取得本次 VoIP 的 taskId、平台受理／失败原因和到达回执？短 TTL 实际如何映射 APNs expiration？
请明确只使用已有应用的测试路由，不替换普通消息和生产凭据。
```

这里的支持依据是 [DCloud options→个推映射](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/options.html)、[个推 VoIP 类型](https://docs.getui.com/getui/server/rest_v2/common_args/)及 [DCloud strategy 需开通说明](https://doc.dcloud.net.cn/uniCloud/uni-cloud-push/api.html#settings)。它们证明产品接口有能力，尚不证明本应用已配置完成。

- [ ] 取得针对本应用的 topic／凭据、环境选择和直投策略答复；不要自行增加未经文档支持的 `is_sandbox` 等字段。
- [ ] 若需保存现有生产应用配置，先列出原值所在项、拟变更项、普通消息影响和回退方式，给用户确认后再操作。
- [ ] 若供应商明确不支持本应用所需路线，再评审已有直连 APNs 备用适配器；不能无声切换或两路同时发。

**本步产物：工单／控制台证据和确定的投递配置。未获直投能力时可以继续本地补代码，但不能将后台在线透传当作无进程 VoIP 验收。**

## 4. 补 iOS 原生绑定【移动端同学，本地代码】

文件入口：`uni_modules/nuwax-voip/utssdk/app-ios/NuwaxVoipBridge.swift`，现有 token 回调和注册器。

- [ ] 保留现有唯一 PKPushRegistry、启动恢复、PushKit 先报告系统及后台验证任务；不复制供应商示例再创建第二个 registry。
- [ ] 在既有 UniPush／个推 SDK 初始化后，将真实 PushKit token 交给 `GeTuiSdk.registerVoipTokenCredentials`；处理 token 先到、CID 后到、token／CID 轮换和重新初始化顺序。
- [ ] 原生依赖及本地构建／检查脚本同步处理，保证完整宿主能真正链接调用，不只写一个未打入包的方法。
- [ ] 账号切换、退出、token 失效按登录代次和登记版本撤销业务路由；旧回调不能重绑为旧账号。SDK 无已确认的独立解绑 API 时，不用空 token、销毁全局 SDK 或解绑普通消息 alias 假装完成撤销。
- [ ] 原先直连 APNs 注册器与新聚合适配器协调为一个有效注册入口和一套就绪状态，避免持续请求未部署接口。保留包名／签名环境校验，不按测试域名猜环境。
- [ ] SDK BOOL 只记本地受理；后端登记回执、发送配置就绪和手机实际收到分别记录，不能把 BOOL 直接显示成“来电已就绪”。

接口依据：[个推原生 VoIP 绑定](https://docs.getui.com/getui/mobile/ios/xcode/)。已有 PushKit／Keychain 修补必须保留。本步不能用仅热更 uvue/UTS 代替重新编译原生代码。

**本步产物：绑定及生命周期补丁、脱敏阶段日志、回归测试；不是要求你在控制台填写一串 token。**

## 5. 补后端设备与邀请触发【后端同学，先本地后测试部署】

- [ ] 选定实际设备接口：扩展现有 `/devices`，或等价实现 `/calls/devices`；前后端确定一份契约。不要求为此新建一套服务，也不把历史 `/calls/devices` GET 404 当作所有等价接口都不存在。
- [ ] 存储／关联账号、设备、CID、平台、bundle、签名环境、电话能力和登记版本。个推负责 token 绑定时，IM 可只存 CID 路由，但登录归属、撤销及轮换仍要实现。
- [ ] 普通消息设备刷新不覆盖电话字段；退出／换账号在服务端撤销旧路由，旧 register／revoke 不能复活或删除更新后的记录。
- [ ] 真实单聊邀请创建成功后选择目标电话设备并投递，不直接沿用“WS 在线便跳过推送”的普通离线消息门禁；同设备／callId 去重。
- [ ] 给 iOS 电话分支完整的 `callId/convId/msgId/calleeId/mediaType/expiresAt` 和必要显示名，ID 全为字符串。只给两个定位 ID 的 Android 普通通知载荷不足以替代 iOS 原生先报来电所需数据。
- [ ] 取消、接听、拒接和挂断继续业务控制连接；不要拿 VoIP push 发保活或取消。基础冷唤醒之外，权威终态补偿、原子抢接及原生登录续期仍属于正式产品待交付，见 [后端清单](voip-backend-required.md)。

**本步产物：实际接口说明、测试服务 commit／部署版本、一个有效账号的电话设备路由。会议建房／签票 ready 不等于这一层已 ready。** 不修改 `agent-platform`；由对应后端同学交付服务端代码。

## 6. 补现有 push-send 电话分支【云函数同学，先本地】

目录：`uniCloud-alipay/cloudfunctions/push-send/`。现有 `voip.js` 只做普通邀请通知白名单和 TTL，不是真正的 PushKit sender。

- [ ] 保留既有调用鉴权，并由受信后端选择电话目标；不能让任意请求传 CID／options 就得到电话发送权限。
- [ ] 增加明确的 iOS 电话分支，筛出已登记 iOS 电话 CID，不把 Android／iOS 混在一个电话批次。
- [ ] 校验完整邀请、被叫归属、有效期和去重，拒绝过期／非法邀请，不携带平台 token、RTC JWT 或任意 URL。
- [ ] 构造真正的 `options.ios.type="voip"` 及已校验 payload；业务 `payload.type="voip"` 本身不改变 APNs 类型。普通聊天／Android 邀请沿用原路径。
- [ ] 按本应用获准方式设置厂商直投和签名环境；短投递 TTL 建议仅数秒且不超过邀请剩余时间，核实最终 APNs expiration，不能把 60 秒业务响铃窗口当作长队列保留。
- [ ] 增加电话分支、混合平台拒绝／分流、鉴权、过期、去重和普通消息回归测试；日志只保存 callId、任务标识及错误码等必要字段。

**本步产物：本地补丁和测试、拟部署测试空间／函数版本、与现有普通消息不冲突的检查结果。**

## 7. 确认测试部署并生成新包【你确认目标，负责同学执行】

部署前给用户看具体清单：IM 测试版本、云函数测试空间及版本、拟改配置、影响范围与回退版本。仅在确认的目标执行；若测试与生产共用配置，明确列出共享项，不能将其当作独立测试配置直接改。

- [ ] 测试部署完成，后端和云函数交付实际版本，而非仅口头“接口写好了”。
- [ ] 运行新增相关测试与现有 VoIP 回归；新依赖须在原生宿主中通过编译／链接。下面是明天执行的命令，本次没有运行平台编译：

```bash
pnpm voip:test
pnpm voip:ios:push:check
pnpm voip:ios:check
git diff --check
```

- [ ] 新代码在两端提交同步后，用 HBuilderX 5.34 和匹配 SDK 生成真实 App 测试环境资源及完整签名 IPA：

```bash
bash scripts/voip-native/package-business-qa-ios.sh
```

该脚本默认使用统一签名配置，仅本地出包，不上传、安装或部署。它把完整真实 App 源码复制到忽略目录后固定测试环境，内置完整业务页面，移除 HX DebugServe；不是旧 Alice/Bob 测试 App。安装文件名可能带 `VoIP-Test`，bundle 仍是 `com.nuwax.app`。

- [ ] 回读包内原生实现、启动 hook、签名、环境和资源摘要；在 `out/voip-business-packages/` 记录 IPA 实体文件、SHA-256 和配套构建元数据。
- [ ] 同签名覆盖安装到 iPhone 16，不卸载清数据。确认真实测试环境账号、不同主叫账号；生产账号遗留身份不可直接复用。完整说明见 [测试包手册](voip-ios-qa-package.md)。
- [ ] 退出 HBuilderX／Xcode 的自动运行与热更干扰，确认没有调试守护自动重启 App。后续只读日志观察不要主动启动被叫 App。

**本步产物：包含本次绑定代码的新 IPA 已安装、电话设备路由对应本次账号／环境、测试服务版本可追踪。缺任一项，不开始“杀进程后收不到”的反复拨号。**

## 8. 用同一通电话确认投递确实到 PushKit【两人测试，开发看日志】

先让 iPhone 完成登录及注册，Android 从真实单聊发一通语音。按同一 callId 依次核对：

| 层 | 需要看到的结果 |
| --- | --- |
| IM | 邀请成功且有效，选择的被叫账号／设备正确 |
| 云函数 | 明确进入 iOS VoIP 分支，有本次任务标识，不是普通通知或在线透传 |
| 供应商 | 本次真实 VoIP 的受理／失败原因，环境与 topic 匹配 |
| iPhone 原生 | `PushKit received` 关联本次 callId，随后系统报告完成；在线 WS 到达不能替代此项 |
| 系统及媒体 | 来电持续可接听，接听后双向声音正常；挂断后动态岛、采集和音频会话清理 |

SDK 受理、`registered`、`serverReady/nativePush`、UniPush errCode=0、APNs 200 都分别留证；任何单一回执不能替代手机 PushKit 到达。基础前台通话通过也不能代替这一轮投递证据。

## 9. 再测你关心的“上滑退出后还来电”【你按顺序操作】

1. **桌面后台**：iPhone 返回桌面，不清理 App；Android 拨号。接听、说话、挂断，确认动态岛消失。
2. **锁屏**：iPhone 锁屏，Android 拨号。确认系统来电、实际铃声、接听和双向声音；挂断释放。
3. **用户上滑退出**：iPhone 进入多任务界面，将女娲 App 上滑移除。此后不要点 App 图标，不让 HBuilderX 自动拉起。开发记录拨号前进程快照；Android 再拨，观察 PushKit、系统来电及接听。
4. **系统回收无进程**：另列一轮，由开发记录自然回收或受控终止方式和前后进程。不要把第 3 步当作系统自然回收，也不要把调试器 Stop 当成所有真实系统状态。
5. **重启后已首次解锁、未再打开 App**：独立记录后测试；重启尚未首次解锁另记保护边界，当前 Keychain 不保证可读，不以降低保护等级解决。

开发可用只读命令保存拨号前进程快照，按实际 UDID 和文件路径填写；不要为了查进程先 launch App：

```bash
xcrun devicectl device info processes --device <iPhone的UDID> --json-output <忽略目录中的快照文件.json>
```

第 3 步是你说的“杀后台”。Apple [说明真正 VoIP 可启动或唤醒未运行 App](https://developer.apple.com/documentation/pushkit/responding-to-voip-notifications-from-pushkit)，但本项目仍须按实际 iOS、退出方式和签名逐项验证；不能由普通通知规则或文档能力推断用户上滑场景已经通过。

## 10. 失败时按停在哪一层处理

| 最后一个成功位置 | 接下来检查什么 |
| --- | --- |
| IM 没有电话设备目标 | 账号／CID／签名环境、能力登记、退出撤销和在线门禁；不是先改手机通知 |
| 云函数走了普通分支 | IM 调用参数、平台拆分、已部署函数版本和实际 options 构造 |
| 供应商拒绝 | 本次错误码对应的授权／topic／环境／token 绑定，保留任务标识；不反复重建证书 |
| 供应商受理、没有 PushKit | token 到 CID 的真实绑定、环境与 topic、直投策略及设备状态；拿该任务标识向供应商定位 |
| PushKit 有，系统来电无或立即结束 | 系统报告错误、重复／过期／账号校验、后台 HTTP、签名系统能力及终态；不要先盲改勿扰 |
| 系统来电有，接听媒体失败 | RTC 签票、房间权限、麦克风、WSS／ICE／TURN 与真实网络 |
| 挂断后动态岛残留 | 系统动作确认、UUID／callId 映射、旧任务隔离及音频释放；先停止新通话留日志 |

记录模板：`日期／设备／iOS／包摘要／IM与函数版本／账号／退出方式／拨号前进程／callId／任务标识／PushKit／系统来电／铃声／双向声音／挂断释放／结论`。

单条路线至少取得一通完整证据后，再测重复／迟到／取消先到、拒接、超时、账号切换和网络恢复。iPhone 上滑退出验证通过后，仍需原子抢接／权威终态、30 分钟锁屏音频和正式发行渠道回归，不能直接标记全产品生产 ready。
