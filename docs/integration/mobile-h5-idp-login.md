# 移动 H5 统一登录（服务端配置驱动）

本期接入浏览器 H5，优先满足西财统一认证。协议与 `workspace/nuwax` 的 PC Web 一致，使用后端写入的 Cookie 会话；不将 Cookie 导出为 App Token，也不从回调 URL 接收 Token。Android、iOS、鸿蒙原生壳和小程序沿用现有登录。

原生 App 的复用范围、授权/Token 交接方案、平台打包要求和后端确认清单统一见[联合登录总方案与原生接入计划](mobile-idp-native-plan.md)。原生当前尚无完整授权桥及会话交接，不能通过启用 H5 开关直接开放。

## 登录链路

1. 登录页读取公开接口 `GET /api/auth/idp/list`；服务端 `items` 决定手动入口，`autoRedirectIdpId` 决定是否自动认证及使用哪个提供方。
2. 自动统一认证时先勾选同意协议并直接跳转；手动入口仍先确认协议，再由顶层页面跳转到 `/api/auth/idp/authorize?provider=<id>&redirect=<callback>`。CAS/OAuth2 的授权码、state、PKCE、首次注册/绑定规则由后端处理。
3. 成功回调为 `/m/#/subpackages/pages/auth/idp-return?redirect=<移动业务路径>`。页面调用 `/api/user/getLoginInfo` 验证 Cookie（支持 HttpOnly），拿到有效用户后返回原移动页面；未指定目标时回消息首页。
4. 会话验证失败显示错误及重试/返回登录页入口。返回登录页后重新读取服务端配置，不注入 `local` 参数。未配置自动认证或列表请求失败时保留普通表单。

自动认证只采用服务端返回的有效 `autoRedirectIdpId`，不要求该 ID 出现在手动按钮列表中；`items` 为空或缺失也不会吞掉自动配置。`local`、`idpError`、弹窗标记、本地表单 `disabled`、手动按钮的微信 UA 过滤均不覆盖自动项。自动发起前同步勾选协议，不弹出确认框。

每次进入登录页、页面返回或浏览器后退恢复时重新读取配置并自动跳转。不读写 `sessionStorage` 尝试标识，不设置冷却或重试次数限制；只去重同次展示内的并发导航，并丢弃页面隐藏/卸载或服务域变化前的旧请求。浏览器导航抛异常时解除加载并提示失败，下次返回时仍重新按配置处理。

## 配置归属

- 提供方启停、类型、可见 ID 和自动项全部由服务端管理，已移除前端类型/ID 白名单。
- 手动入口仅对微信 `OA/QRCODE` 按浏览器 UA 选择展示形态；这一展示过滤不影响服务端自动项。
- H5 微信使用后端网页授权，不引入微信原生 SDK；Android/iOS SDK 仍不在本阶段接入。
- `local` 或错误参数只作历史参数/提示信息，不能停用服务端配置的自动认证。需要账号、验证码或首次绑定续接时，由后端给出相应配置和流程，前端不自行绕过。
- 不在前端保存任何 IdP Secret；不通过回调 URL 接收业务 Token。

## 部署及验证条件

- H5 部署在业务域的 `/m/`，接口与页面同源。跨域开发和 App 内嵌 H5 不展示联合登录入口，避免产生仅在授权域有效的 Cookie。
- 后端应允许 `/m/#/…` 相对回跳，并设置可供 `/api/` 使用的 Cookie。不能通过 `document.cookie` 是否可读判断是否登录成功。
- 失败、取消、首次关联页面的返回位置由后端控制；当前公开协议的失败默认入口是 PC `/login?idpError=…`。如需全程保持移动页面，后端需保留移动返回上下文。本次未修改后端或 PC Web。
- 首次关联需普通登录时，移动登录页允许续接同源 `/auth/bind-or-register?token=…&bind=1`，不接受其他认证/API 地址。设置密码后同样保留该返回目标。

本次仅实现源码和本地回归；真实测试环境及西财账号由使用方验证，未部署。

## 本地回归

```bash
pnpm exec vitest run tests/authIdp.test.ts tests/idpNavigation.test.ts tests/authIdpRequest.test.ts tests/idpLoginConsent.test.ts

# HBuilderX 编译 H5 后，可用本地模拟接口走浏览器链路；不会转发真实 API。
node tests/fixtures/mobile-idp-server.mjs <HBuilderX生成的web目录>
```

模拟站点为 `http://127.0.0.1:18765/m/#/subpackages/pages/login/login`，需使用移动浏览器 UA。模拟服务默认不配置自动项；需要模拟自动认证时通过 `/_fixture` 设置 `auto`，不使用 URL 参数覆盖。模拟授权写入 HttpOnly Cookie，回调验证通过后不保存 `ACCESS_TOKEN`。真实 IdP、内网可达性及服务器 Cookie 配置仍需环境验收。
