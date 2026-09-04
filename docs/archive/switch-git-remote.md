---
description: 本仓库的 Git 远程命名约定与配置方法
---

# Git 远程仓库配置指南

本项目同时托管在内网 GitLab 与 GitHub。**两个 remote 按名字固定用途，不再是「切换 origin 地址」**：

| remote 名 | 托管平台 | 仓库地址                                                                  | 用途 |
| --------- | -------- | ------------------------------------------------------------------------- | ---- |
| `origin`  | 内网 GitLab | `https://git.yichamao.com/agent-platform/agent-platform-front-weapp.git` | **默认拉/推主仓** |
| `github`  | GitHub   | `https://github.com/nuwax-ai/nuwax-mobile.git`                            | 公开镜像 |

> 2026-09 起沿用主仓（nuwax）的命名方案：原 `origin`（GitHub）改名 `github`，原 `gitlab`（内网）改名 `origin`。**push 前先想清楚推哪个 remote。**

## 查看当前远程仓库

```bash
git remote -v
```

正确输出应为：

```
origin  https://git.yichamao.com/agent-platform/agent-platform-front-weapp.git (fetch)
origin  https://git.yichamao.com/agent-platform/agent-platform-front-weapp.git (push)
github  https://github.com/nuwax-ai/nuwax-mobile.git (fetch)
github  https://github.com/nuwax-ai/nuwax-mobile.git (push)
```

## 已有旧命名的克隆，改为新命名

```bash
# 旧命名：origin=GitHub、gitlab=内网 → 新命名：github=GitHub、origin=内网
git remote rename origin github
git remote rename gitlab origin

# 拉取并清理失效引用（remote 改名会自动迁移 origin/* 跟踪引用与分支上游）
git fetch --all --prune
```

## 只有 GitHub 克隆的，补配内网主仓

```bash
git remote rename origin github   # GitHub 让位为 github
git remote add origin https://git.yichamao.com/agent-platform/agent-platform-front-weapp.git
git fetch --all --prune
```

## 注意事项

1. `git remote rename` 会自动迁移远程跟踪分支（如 `origin/dev` → `github/dev`）和各本地分支的上游配置，无需手动调整
2. 改名后 `git pull` / `git push` 默认走 `origin`（内网主仓）；推 GitHub 需显式 `git push github <分支>`
3. 两端同名分支可能存在分叉（如 `dev`、`main`），同步前先确认领先落后关系，避免误合入
