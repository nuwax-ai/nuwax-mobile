# 两台 iPhone 的真实 App 测试包

本轮为完整女娲 App（`com.nuwax.app`）的内部测试环境 IPA，使用现有开发描述文件签名。不是原 Alice/Bob 专用测试宿主，也不需要连接 HBuilderX 获取页面资源。版本沿用当前 manifest；不自动合并、上传、修改生产配置或部署服务。

## 构建与校验

在 `mobile-voip` 工作树、HBuilderX 5.34 与隔离的对应离线 SDK 下执行：

```bash
bash scripts/voip-native/package-business-qa-ios.sh
```

默认从 `${NUWAX_SIGNING_HOME:-$HOME/workspace/nuwax-signing}/local-secrets.env` 加载统一签名配置，也可通过 `NUWAX_SIGNING_ENV` 指定受控配置。脚本先准备离线资源，再将当前源码快照复制到忽略目录 `out/voip-business-qa-project`；仅该副本固定测试域名 `https://testagent.xspaceagi.com`、开启 Android/iOS 测试域名的业务通话入口，并跳过会替换当前包的版本更新检查。主工作树的生产默认地址、升级策略与平台验收开关不变。QA 原生宿主还核对签名宿主固定的 API origin，防止恢复旧安装遗留的生产电话身份。

HBuilderX 生成本地 iOS 发行资源，随后离线 SDK 构建 Debug 原生宿主、签名、验证 APNs 元数据并生成独立 IPA。SDK `ipatype=2`，不链接 HX DebugServe；调试基座仍沿用原流程及路径。全 App 编译可临时提高 HX 堆内存，构建结束恢复既有配置。资源、证书派生文件及产物都不进入版本库。

产物位置：

- `out/voip-business-packages/Nuwax-VoIP-Test-<时间>.ipa`：发给同事安装的完整包。
- 同名 `.sha256`：文件完整性校验；同名 `.json`：构建变体元数据。
- `Nuwax-VoIP-Test-latest.ipa`：最新包的本地软链，转发时选择实际 IPA 文件。
- `out/voip-ios-audit-20261117/ipa-verification.json`：环境、内置资源与当前原生模块摘要核对结果。

`verify-business-qa-ios.py` 校验包名、真实产品名称、测试环境、发行宿主模式、后台模式、无 DebugServe、导出资源和内置资源逐文件一致、当前原生 Swift 实现一致及有效签名。签名与构建通过仍不代表实机启动或通话矩阵已验收。

## 安装和账号

1. 沿用团队已有的开发包安装方式（例如 Apple Configurator/Xcode）；也可把手机接到这台 Mac 后安装。开发签名的手机需允许开发者模式，系统信任按实际提示完成。2026-11-17 已回读本次 IPA 的内嵌描述文件，确认包含 LLD16 和 zhengqiang（ZQ）；签名材料统一维护在 `nuwax-signing`，未在 worktree 新增持久签名副本。
2. 这是同一 `com.nuwax.app` 的测试包，安装会覆盖现有同包名 App。测试环境原账号可继续使用；若现有安装曾登录生产环境，须退出后重新登录测试账号，不能把旧生产凭据当作测试凭据。
3. 两台手机分别登录不同测试账号，在真实联系人单聊中点「＋ → 语音通话/视频通话」。不用填写 LAN 地址、Alice/Bob 或 RTC JWT。
4. 本机记录从同一加号面板的「通话记录」进入；只显示该账号在这台手机上观察到的呼叫。回拨重新创建呼叫和检查能力，不复用旧 callId。

## 分层测试

先测前台两账号双向拨号、拒接、取消、无人接听、接通/静音/挂断；每通核对两端界面、系统通话和动态岛计时是否清除。再测最小化返回通话、权限首次申请/拒绝与设置、视频后台停采、音频路由、系统音频打断、30 秒重连上限及挂断后资源释放。

后台、锁屏、有进程、系统挂起、系统回收无进程、用户强退、重启首次解锁前后分别记录。**前台与在线通话通过不能作为未启动唤醒通过。** 专用 APNs sender、独立电话设备路由、原生凭据续期、权威终态/原子接听需后端先就绪；这些依赖与验收条件单列在[后端待配合清单](voip-backend-required.md)。本轮没有替团队修改任何生产证书或服务配置。

当前最低安装范围 iOS 15；系统 PushKit/LCK 来电面向 iOS 17.4+。旧系统仅保留前台通话/普通通知的降级范围，不承诺未启动时系统接听。
