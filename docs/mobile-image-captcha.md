# 移动端图形验证码

本次从 `origin/feat/nuwa-zhuoda-2026.09.30` 拉取最新代码，基线为 `1adf059f7e2cb3bb48e28f6bc9d478a5cda2584f`。实现位于独立开发分支 `feat/nuwa-zhuoda-2026.10-image-captcha`，原工作区的其他需求改动保留。

对齐 PC Web 的 `ImageCaptcha`、`Login`、`VerifyCode` 和 `services/account.ts`：

- 租户配置 `openImageCaptcha = 1` 开启图形验证码，与 `openCaptcha` 阿里云验证码独立，支持同时开启。
- `GET /api/user/captcha/image` 返回 `data.captchaId` 和 `data.image`（base64 data URI）。
- 密码登录 `/api/user/passwordLogin`、短信和邮箱发码 `/api/user/code/send` 携带 `captchaId`、`captchaCode`。关闭开关时不发送空图形字段。
- 短信验证码登录 `/api/user/codeLogin` 维持既有契约，图形挑战在发码时消费。

输入框支持字母和数字，最多 8 字符，提交时去除首尾空白。点击图片或“换一张”会立即清空旧挑战，连续换图只接受最后一次响应，卸载后的迟到响应会被丢弃。图片或 ID 缺失时阻止提交，并提供重试入口。

密码登录失败后自动换图；发码失败后可立即重新输入图形验证码并重试。发码成功后开始倒计时，暂时隐藏图形输入，倒计时结束后加载新的挑战，重发不能复用旧验证码。旧的独立验证码输入页也接入了图形重发校验。

Android 请求体继续显式写入 `UTSJSONObject`，保证新增参数及既有统一账号、发码类型、阿里云参数完整序列化。新增文案使用独立 `Mobile.Auth.imageCaptcha*` key，补齐四个本地语言包及平台默认导入模板。

本轮验证（2026-10-08）：

- 20 项针对性测试通过：开关独立性、必填校验、换图加载期间作废、响应乱序、卸载失效、半个挑战响应、密码登录和短信/邮箱发码序列化。
- HBuilderX 5.26 H5 完整构建通过；Android 原生编译通过。
- H5 真实页面配合本地模拟接口验证：空输入拦截、正确携带参数、密码失败换图、短信发码失败重试、60 秒倒计时结束后重新校验、邮箱发码、图片加载失败与点击恢复、关闭开关后隐藏输入且请求不带图形字段。
- 国际化审计与同一基线均为 169 项存量缺口，新增缺口为 0；`git diff --check` 通过。
- iOS 业务页面编译完成，现有 `nuwax-stream-pcm-player` 原生插件报 `DCloudUTSExtAPI-Swift.h: unsupported Swift architecture`，整包运行尚待验证。
- 真实后端验证、阿里云 SDK 与图形验证码同时开启的联调、原生真机验收尚未进行；鸿蒙与微信本轮未编译。

测试命令：

```sh
node node_modules/vitest/vitest.mjs run tests/imageCaptcha.test.ts tests/accountImageCaptcha.test.ts
/Applications/HBuilderX.app/Contents/MacOS/cli publish web --project "$PWD" --webHosting false
/Applications/HBuilderX.app/Contents/MacOS/cli launch app-android --project "$PWD" --compile true
```

生成的 H5 产物单独保存在本机 `/tmp/nuwax-mobile-image-captcha-build-artifacts/web`，源码工作区恢复了原有构建产物。代码未推送。
