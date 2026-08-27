# 发布前清理清单

> 正式打包/上架前逐项过一遍，避免敏感信息进入公开仓库跟踪文件。

## 密钥与签名（发布前复核）

- [x] 开发 PoP 等敏感值统一放 `scripts/local-secrets.env`（gitignore），文档/契约仅引用变量名。
- [x] 已提供 `scripts/local-secrets.env.example` 模板，不含真实值。
- [ ] **git 历史残留**：旧 PoP / AppKey / UUID 仍可能在历史 commit 中。当前方案仅清理 HEAD 跟踪文件。

## 打包前自检

```bash
# 1. 契约中不得含 developmentPoP 字段
git grep -n '"developmentPoP"' -- docs/
# 2. 跟踪文件中不得出现 export DCLOUD_APPKEY= 赋值（example 模板除外）
git grep -n 'export DCLOUD_APPKEY=' -- . ':!scripts/local-secrets.env.example'
# 3. 不得提交证书/私钥
git ls-files | rg -i '\.(p12|pem|mobileprovision|jks|keystore)$'
# 4. 确认 local-secrets.env 被忽略
git check-ignore scripts/local-secrets.env
# 5. 确认 config.uts 无测试域名 TODO
grep -n "打包正式环境时要删除" constants/config.uts
```

以上命令输出均应为空（第 4 条应显示被 ignore）。
