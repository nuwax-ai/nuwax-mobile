# 发布前清理清单

> 正式打包/上架前逐项过一遍，避免敏感信息进入公开仓库跟踪文件。

## 密钥与签名（发布前复核）

- [x] 开发 PoP 已从文档脱敏（`Nuwax7-Dev-PoP` → `<DEV_POP（受控渠道获取，勿入仓库）>`）。
- [x] `scripts/local-secrets.env` 已加入 `.gitignore`，敏感配置不入库。
- [ ] **git 历史残留**：旧 PoP / AppKey / UUID 仍可能在历史 commit 中（`git log -S` 可查）。当前方案仅清理 HEAD 跟踪文件；若需彻底清洗历史，另开 `git filter-repo` 专项。

## 打包前自检

```bash
# 1. 确认无敏感值进入跟踪文件（本文件中的 grep 示例行除外）
git grep -n -e "Nuwax7-Dev-PoP" -e "02c109ded799bad828c3183534b330e3" -e "bb47873e-" -e "89GQ2RJVW7"
# 2. 确认 local-secrets.env 被忽略
git check-ignore scripts/local-secrets.env
# 3. 确认 config.uts 无测试域名 TODO
grep -n "打包正式环境时要删除" constants/config.uts   # 应为空
```
