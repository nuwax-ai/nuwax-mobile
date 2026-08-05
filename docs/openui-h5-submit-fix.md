# OpenUI H5 表单无法提交修复

## 问题
H5 场景下，OpenUI 生成的页面无法提交表单，顶部提示「Share preview is read-only and cannot submit forms.」。App 端正常（ticket 成功时）。

## 根因
`file-preview-page.uvue` 构建 OpenUI 预览 URL 时有两个分支：

1. **`_ticket` 分支**（ticket 成功）：`?fileUrl=...&_ticket=...&_sk=...` → **交互态（可提交）**。
2. **`sk` 回退**（ticket 失败）：`?sk=...` → **分享只读态（不可提交）**。

H5 生产环境无法设置 `Authorization` 请求头（网关限制），导致 `/api/user/ticket/create` 鉴权失败 → `getTicket()` 返回空 → 回退到 `?sk=` 分享只读态 → 渲染器显示 read-only 横幅 → 表单不可提交。

App 端能设 Authorization 头 → ticket 成功 → 走 `_ticket` 交互分支 → 可提交。

## 修复方案
**按文件类型区分回退策略**（`file-preview-page.uvue:313-325`）：

- **OpenUI 文件**（`.openui.json`）：ticket 失败时改用 `?fileUrl=...&_sk=...`（**无顶层 `sk`** → 渲染器按「会话内预览」处理 → 可交互/可提交）。不依赖 `_ticket` / Authorization 头。
- **非 OpenUI 文件**（PDF/图片等）：保持 `?sk=` 只读回退（只需查看，不受影响）。

核心逻辑：**顶层 `sk` 存在 = 分享页（只读）；顶层 `sk` 缺失 = 会话内预览（可交互）**。`_sk`（带下划线）只用于下载/取文件鉴权，不触发只读。

## 不受影响的部分
| 场景 | 是否受影响 |
|---|---|
| 分享链接（page URL 带 `?sk=`） | ❌ 不影响（走第一个分支，只读） |
| 会话内预览 + ticket 成功（App） | ❌ 不影响（走 `_ticket` 分支，未改） |
| 非 OpenUI 文件预览（PDF/图片） | ❌ 不影响（回退仍走 `?sk=`，只读） |
| 分享功能（share 按钮） | ❌ 不影响（独立逻辑） |

## 涉及文件
- `subpackages/pages/file-preview-page/file-preview-page.uvue`：回退分支按文件类型区分。

## 相关提交
- `d11cc700` fix(openui): H5 会话内 OpenUI 表单无法提交

## 注意
- 此修复的前提：渲染器（`file-preview.html`，后端静态资源）按**顶层 `sk`** 判断只读（`_sk` 不触发）。如果渲染器逻辑变更为按其他条件判断，需同步调整。
- H5 无法设 Authorization 头是网关限制，本修复绕过了对 `_ticket` 的依赖（用 cookie 同源鉴权替代）。
