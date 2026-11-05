# Android 隐私协议与授权版本

Android 启动弹窗在可滚动文本区域本地展示完整协议。`privacy-source-v2.9.md` 是 2026-11-04 修订版协议快照，来源为产品提供的 Markdown 文件；`android-clipboard-disclosure.md` 是 Android 实际行为补充说明。启动页正文使用 `scripts/generate-app-privacy-policy-content.mjs` 从协议快照生成 `constants/appPrivacyPolicyContent.uts`。

`scripts/generate-app-privacy-policy.mjs` 根据快照和行为说明生成 `constants/appPrivacyPolicy.uts` 中的独立授权版本。首次启动、授权版本不匹配、框架授权被重置时，Android 都需要用户重新明确同意。退出登录保留授权版本；iOS / Harmony 不使用此弹窗逻辑。

网页有实质变更时，应先核对线上完整内容，更新此处快照和对照说明，再运行生成脚本并重新打包。当前实现不会自动检测网页热更新，不能仅更新线上网页就认为旧用户已经收到再次授权。

当前 1.3.3 (133) 网页弹窗 APK 已完成本地构建、正式签名和专用安卓模拟器验证：同意后关闭弹窗进入登录页，保存独立授权版本，杀进程重启后不再弹出；拒绝不记录同意。已登录路由的验证使用过隔离的测试 token，不等于真实账号验收。

线上剪贴板说明由网站维护方更新，当前尚未更新。最新网页弹窗 APK 的 VIVO 复测待网页更新后进行；历史其他 APK 的双引擎结果不作为当前包的通过结论。
