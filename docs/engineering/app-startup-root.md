# App 固定根页面启动流程

## 原因与目标

之前 App 冷启动要从 `launch` 跳到登录或 `tab-shell`，Android 页面对应的 Activity 在切换期间需要额外画面遮挡。`nuwax-launch-splash` 用 Window/Decor 补画 Logo，形成了“系统大 Logo → 补画小 Logo”的两段启动画面；调整尺寸也无法消除两次画面的交接。

现在普通启动直接进入 `pages/tab-shell/tab-shell`。该页面始终作为根页面，在内部选择隐私、登录或主界面内容。系统启动屏仍由框架和系统处理，Android 保持 `app-android.splashScreen.autoClose = onReady`。业务页面不补画启动 Logo，也不等待网络响应才显示首屏。

这消除了应用代码中的重复 Logo 和启动中转跳页。最终系统启动屏与首帧的衔接效果需要新原生基座真机验证；静态检查和逻辑单测不能证明设备上完全没有空白帧。

## 状态与职责

| 状态 | 显示内容 | 放行条件 |
| --- | --- | --- |
| privacy | 本地隐私说明与原生同意按钮 | Android 框架真实授权与协议版本同时有效 |
| login | 原登录内容组件，先读取本地租户配置 | 无 Token；登录完成后通过原 `redirectTo` 流程回跳 |
| main | 原 Tab 内容、手势、聊天与录音抽屉 | 已授权且有 Token |

- `utils/appEntryState.uts` 管理根页面的状态、登录回跳与所有权。保存 Token 不会自动切到主界面，保留强制重置密码流程。
- `components/main-tab-content/main-tab-content.uvue` 从原 Tab 页面抽取；根页面转发显隐、就绪、返回和窗口尺寸事件。安全区仍读取实际 Window Insets，首帧不再覆盖白色遮罩。
- `subpackages/pages/login/login-content.uvue` 复用原登录表单及个人/企业、验证码、改密逻辑。旧登录路由继续保留，负责原查询参数和 H5 IdP 回跳解析。
- `components/app-privacy-consent/app-privacy-consent.uvue` 复用隐私协议正文、链接、原生授权按钮与拒绝退出流程。准备中的界面有本地说明，不挂载业务内容。
- `App.uvue` 继续在真实隐私授权后初始化 SDK。首次 onShow 即使被隐私门禁拦下也消费冷启动标记，避免授权后首次回前台丢失新扫码意图。
- `pages/launch/launch` 只兼容旧入口，普通启动不再经过该路由。
- H5 保持现有主界面入口与独立登录路由，小程序保持原生 Tab 导航。

## 登录与扫码

普通冷启动不执行 `reLaunch` 或 `switchTab`。登录成功回到 Tab 时，已有根页面原位换内容。

根页面上的鉴权失效原位显示登录；已在登录中的并发 401 不重建表单、不覆盖回跳。深层页面失效继续按原逻辑清栈进入登录路由。

明确的扫码登录链接属于业务导航：授权后每进程消费一次冷启动链接，热启动仍消费当前唤起参数。未登录时根页面保留确认目标；新二维码可更新目标而不重建登录界面。异域/畸形链接仍进入原错误页。确认仍需用户操作。

## 原生部分与打包

移除 `uni_modules/nuwax-launch-splash` 及包装工具、所有 hold/release 调用。旧基座里的 `LaunchSplashInitializer` 是自动初始化的 ContentProvider，**仅热更新业务代码无法移除它**。

本地离线 Android 打包脚本也把业务 Activity 的 Window 背景改为纯色；Android 12+ 只使用系统的启动图标，低版本继续使用 Launcher 启动背景。业务 Activity 不再使用带 Logo 的背景。

iOS 使用系统 `LaunchScreen`（App 启动瞬间由系统直接渲染，不经过 JS），源文件在 [nativeResources/ios/launchscreen/](../../nativeResources/ios/launchscreen/)：白底 + 居中品牌 Logo，没有任何背景图依赖方向。两条 iOS 打包路径共用这份源：

- **云打包（正式包）**：[manifest.json](../../manifest.json) `app-ios.distribute.splashScreens.storyboard` 指向 `NuwaxLaunchScreen.zip`。zip 由 [scripts/gen-ios-launchscreen-zip.sh](../../scripts/gen-ios-launchscreen-zip.sh) 生成（zip 根目录只有 `.storyboard` 与 `dc_launchscreen_icon@2x/@3x.png`，无子目录——HBuilderX 的硬要求）。改 Logo 后必须重跑该脚本并提交 zip。
- **本地离线基座**：[scripts/voip-native/device/prepare-ios.py](../../scripts/voip-native/device/prepare-ios.py) 在复制 SDK Demo 后覆盖其示例 `LaunchScreen.storyboard`，并把 `UILaunchStoryboardName` 固定为 `LaunchScreen`。仅改业务代码不会更新启动屏，需要重打 iOS 基座。

uni-app x 的 iOS 不支持 `splashScreens` 多密度启动图（那是老 uni-app 的 Android 方案），只支持自定义 storyboard。业务页面同样不再补画启动 Logo。

HarmonyOS 使用 `EntryAbility` 的系统简易启动页，同样不经过业务页面。启动图与背景色配置在 [manifest.json](../../manifest.json) 的 `app-harmony.distribute.splashScreens`；[harmony-configs/entry/src/main/module.json5](../../harmony-configs/entry/src/main/module.json5) 仅保留 `startWindowIcon` / `startWindowBackground` 资源引用。必须通过 manifest 指定图片，否则 HBuilderX 生成到 AppScope 的 1×1 透明占位图会覆盖 entry 下的同名资源，冷启动只显示白色背景。修改后需删除旧的 `unpackage/dist/dev/app-harmony` 原生工程并重新编译/安装；业务热更新不会替换 HAP 内的原生启动资源。

需要基于最新资源重新生成一次基座；清理旧原生构建缓存，避免残留旧模块。可检查最终 APK Manifest：不应再包含 `com.nuwax.launchsplash.LaunchSplashInitializer`。本轮没有启动 HBuilderX 编译或云打包。

## 新基座验收

1. 保留登录态，从最近任务划掉后从桌面冷启动，多次验证“系统 Logo → 消息页”，不出现第二幅启动 Logo 或空白中转页。
2. 未登录冷启动直接进入可交互的登录表单；租户配置/语言接口慢或断网时也有本地首屏。
3. 首次安装先显示隐私内容；同意前没有业务 SDK 初始化和推送注册；同意后在同一根页面进入登录；拒绝退出；协议链接可打开。
4. 个人/企业账号、密码/验证码登录，以及必须改密的账号正常；只有完成改密后才进主界面。
5. Token 过期和并发 401 仅显示一次登录，登录后返回原目标；退出登录正常。
6. 冷/热扫码、登录中收到新扫码、异域或无效二维码、确认/取消返回均正常。
7. 四个 Tab、消息下拉聊天、录音抽屉、二级页返回、前后台显隐、旋转/安全区与键盘行为正常。
8. H5 登录/IdP 回跳、Tab 切换和小程序首入口不受 App 根页面门禁影响。

自动化验证覆盖状态与导航语义，另对各平台条件分支做 SFC/模板/脚本语法与静态导入检查；不替代 UTS/Kotlin 编译和上述真机验收。
