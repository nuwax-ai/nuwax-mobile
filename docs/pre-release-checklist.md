# 发布前清理清单

> 正式打包/上架前逐项过一遍。这些是联调期间为定位问题临时加的开关、硬编码、调试入口，**不处理会导致 release 包走测试环境 / 暴露调试信息**。

## 🚫 必改（不改会出生产事故）

- [ ] **`constants/config.uts:22-24`** —— 删除 `TODO 打包正式环境时要删除` 块（强制 `API_BASE_URL = testagent.xspaceagi.com`）。**不删 → release 包也走测试后端。** 同时确认 prod 分支 `API_BASE_URL = https://agent.nuwax.com`、Vox 走全局域名。
- [ ] **开发配网 PoP** —— 量产固件必须改为**每设备独立 PoP/salt/verifier**（契约 §7）。仓内 dev PoP 已脱敏（见下「已处理」），但联调设备仍用固定 PoP，发布前确认固件侧已切换。

## 🧹 调试残留（建议清理，非致命）

- [ ] **`subpackages/pages/provision/provision-entry/provision-entry.uvue`**
  - `showQrInvalid`：QR 解析失败的 toast 现在始终拼 `(QR_XXX)` 错误码（自定义基座下 NODE_ENV 门控失效临时放开）→ 正式版恢复 `process.env.NODE_ENV === 'development'` 门控，或直接去掉错误码拼接。
  - 临时入口「🛠 调试页 test-provision」+ `goDebug()`：发布前删除（仅联调用）。
  - 脱敏扫码日志 `[provision-entry] scan raw ... / parse ...`：正式版可降级或移除。
- [ ] **`uni_modules/nuwax-esp-provisioning/.../EspProvisioningBridge.swift` + `utils/provisioning/iosEspProvisioningClient.uts`**
  - `[EspBridge→UTS]` 原生日志通道（`fwd` → `logSink` → `console.log`）：非密钥（不打 PoP/密码），但属调试噪声。正式版建议**降级为只在异常时输出**，或加 debug 开关。
- [ ] **`@UTSJS.keepAlive`**（`setNativeEspLog` / `startNativeEspScan` / `provisionNativeEspDevice`）：保留（修的是真 bug，非调试残留）。

## 🔑 密钥与签名（已处理，发布前复核）

- [x] 开发 PoP 已从文档脱敏（4 处 → `<DEV_POP（受控渠道获取）>`）。
- [x] `DCLOUD_APPKEY` / `IOS_DEVELOPMENT_TEAM` / `IOS_PROVISIONING_PROFILE_UUID` 已移出仓库 → `scripts/local-secrets.env`（已 gitignore）；提交模板 `local-secrets.env.example`。
- [x] 无 `.p12/.mobileprovision/.cer/.pem/.key` 进仓库；无私钥内容；无模型 API key（前端不持有）。
- [ ] **git 历史残留**：dev PoP + 旧 AppKey/UUID 在历史 commit（`git log -S` 可查）。**私有仓可不动**；若仓库转为公开/外包，需 `git filter-repo` 清洗历史并强制推送。

## 📦 打包前自检

```bash
# 1. 确认无敏感值进入跟踪文件
git grep -n -e "<REDACTED>" -e "<REDACTED>" -e "<REDACTED>" -e "<REDACTED>"   # 应为空
# 2. 确认 local-secrets.env 被忽略
git check-ignore scripts/local-secrets.env
# 3. 确认 config.uts 的 test 域名 TODO 已删
grep -n "打包正式环境时要删除" constants/config.uts   # 应为空
# 4. 确认 prod 环境分支正确（NODE_ENV=production 时走 agent.nuwax.com）
```

> 关联：[offline-sdk-distribution-s3.md](./offline-sdk-distribution-s3.md) · [local-custom-base-maintenance.md](./local-custom-base-maintenance.md)
