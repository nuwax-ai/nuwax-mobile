# VoIP 功能模块

一对一通话的应用层实现集中在本目录。当前真实 App 接入从[业务接入说明](../../docs/engineering/voip-business-integration.md)开始，已对接后端 `feat-video-meeting` 的实际协议；[客户端目标契约](../../docs/engineering/voip-client-contract.md)保留为后端增强目标。

## 代码归属

| 位置 | 职责 |
| --- | --- |
| `integration.uts` | 宿主生命周期、账号退出、普通邀请推送的接入出口 |
| `callManager.uts` | 应用级单呼叫管理、账号代次、能力检查、权限、原生事件与导航 |
| `callState.uts` | 纯状态规则、版本和终态去重、媒体就绪投影 |
| `audioFocus.uts` | 供现有录音、播放模块使用的轻量占用检查及中断事件 |
| `development.uts` | 开发构建和专用测试包闸门 |
| `callErrors.uts` | 稳定错误对象 |
| `components/chat-actions.uvue` | 单聊加号菜单中的独立语音、视频、返回通话入口 |
| `screens/call.uvue` | 通话界面与用户操作 |
| `screens/development.uvue` | 独立测试身份、测试服务、设备诊断和开发监听 |

HTTP 按仓库约定集中在 `servers/voip.uts` 和 `servers/voipIm.uts`。三端原生能力归属 `uni_modules/nuwax-voip`。路由注册页 `subpackages/pages/voip-call` 和 `voip-dev` 只挂载这里的界面组件。构建模板放 `scripts/voip-native`，开发服务放 `scripts/voip-dev`，回归测试放 `tests/voip`。

## 宿主接入边界

- `App.uvue` 通过 `integration.uts` 同步初始化、退出和前后台。通话持有者为应用级管理器及原生单例，页面卸载只清理展示订阅。
- 聊天页挂载 `chat-actions.uvue`，输入 `convId`。呼叫能力、拨号和忙线处理归组件及管理器。
- 已有推送分发器识别 `{type:"voip",convId,msgId}`（兼容开发协议 `voip.invite`）后交给 `integration.uts`，原生推送回调交给原生桥。
- 录音、TTS 和消息音视频只依赖 `audioFocus.uts` 的占用检查与中断事件。此入口保持轻量，避免播放器与管理器形成循环依赖。
- 通知清理模块通过 `integration.uts` 查询鸿蒙原生通话占用。
- 主应用启动页按既有登录流程运行。测试包使用 `scripts/voip-native/device` 自己的启动页。

新增通话规则、后端字段、重连逻辑和平台差异均在上述归属目录实现。新增宿主接点时同步更新对接说明及边界测试。

## 修改与验证

后端路径、请求和身份配置从 `servers/voip.uts` 修改。原生真实业务使用独立 IM WS，开发工具保留 REST/SSE，各自维护后台连接，调整协议时同步核对三端桥。业务状态改动从 `callState.uts` 和 `callManager.uts` 修改，系统来电改动在插件对应平台实现。

运行 `pnpm voip:test`，再通过 HBuilderX 5.34 导出三端资源和构建原生宿主。验收记录分别填写源码检查、编译、安装和真机结果。已安装包的通话证据只对应当时包的源码，结构调整后需重新出包复测。
