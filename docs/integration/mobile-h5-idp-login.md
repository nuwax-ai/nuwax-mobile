# 移动 H5 统一登录（CAS / OAuth2）

本期接入浏览器 H5，优先满足西财统一认证。协议与 `workspace/nuwax` 的 PC Web 一致，使用后端写入的 Cookie 会话；不将 Cookie 导出为 App Token，也不从回调 URL 接收 Token。Android、iOS、鸿蒙原生壳和小程序沿用现有登录。

## 登录链路

1. 登录页读取公开接口 `GET /api/auth/idp/list`，按移动端配置展示入口。
2. 点击入口并确认协议后，顶层页面跳转到 `/api/auth/idp/authorize?provider=<id>&redirect=<callback>`。CAS/OAuth2 的授权码、state、PKCE、首次注册/绑定规则由后端处理。
3. 成功回调为 `/m/#/subpackages/pages/auth/idp-return?redirect=<移动业务路径>`。页面调用 `/api/user/getLoginInfo` 验证 Cookie（支持 HttpOnly），拿到有效用户后返回原移动页面；未指定目标时回消息首页。
4. 会话验证失败保留错误及重试入口；普通登录回退带 `local=1`，避免再次自动授权。列表失败、旧后端不支持或提供方被过滤时，账号/验证码登录仍可使用。

`autoRedirectIdpId` 只对当前配置允许的提供方生效。`local`、`idpError`、浏览器后退恢复会阻止自动跳转；同一提供方五分钟内只自动尝试一次。自动登录同样先确认服务协议，用户取消后保留普通表单。

## 入口配置

配置文件：`constants/authIdp.uts`。

- `MOBILE_IDP_ENABLED_TYPES` 默认 `CAS`、`OAUTH2`，微信本期关闭。
- `MOBILE_IDP_ALLOWED_IDS` 默认为空，不额外限制后端已启用的提供方。西财专版可填对应的 CAS 配置 ID，只显示该项。
- 后续启用微信时加入 `WECHAT`；微信浏览器选择 `OA`，其他浏览器选择 `QRCODE`。不在前端配置任何 Secret。

提供方 ID、类型及启停状态仍以同一租户的公开列表为准；不根据按钮名称推断协议。配置修改需重新编译 H5。

## 部署及验证条件

- H5 部署在业务域的 `/m/`，接口与页面同源。跨域开发和 App 内嵌 H5 不展示联合登录入口，避免产生仅在授权域有效的 Cookie。
- 后端应允许 `/m/#/…` 相对回跳，并设置可供 `/api/` 使用的 Cookie。不能通过 `document.cookie` 是否可读判断是否登录成功。
- 失败、取消、首次关联页面的返回位置由后端控制；当前公开协议的失败默认入口是 PC `/login?idpError=…`。如需全程保持移动页面，后端需保留移动返回上下文。本次未修改后端或 PC Web。
- 首次关联需普通登录时，移动登录页允许续接同源 `/auth/bind-or-register?token=…&bind=1`，不接受其他认证/API 地址。设置密码后同样保留该返回目标。

本次仅实现源码和本地回归；真实测试环境及西财账号由使用方验证，未部署。

## 本地回归

```bash
pnpm exec vitest run tests/authIdp.test.ts tests/idpNavigation.test.ts tests/authIdpRequest.test.ts

# HBuilderX 编译 H5 后，可用本地模拟接口走浏览器链路；不会转发真实 API。
node tests/fixtures/mobile-idp-server.mjs <HBuilderX生成的web目录>
```

模拟站点为 `http://127.0.0.1:18765/m/#/subpackages/pages/login/login?local=1`，需使用移动浏览器 UA。模拟授权写入 HttpOnly Cookie，回调验证通过后不保存 `ACCESS_TOKEN`。真实 IdP、内网可达性及服务器 Cookie 配置仍需环境验收。
