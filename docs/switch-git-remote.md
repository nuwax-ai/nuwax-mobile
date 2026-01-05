---
description: 如何在 GitLab 和 GitHub 之间切换 Git 远程仓库
---

# Git 远程仓库切换指南

本项目同时托管在 GitLab 和 GitHub，可根据需要切换远程仓库地址。

## 仓库地址

| 平台   | 仓库地址                                                                 |
| ------ | ------------------------------------------------------------------------ |
| GitLab | `https://git.yichamao.com/agent-platform/agent-platform-front-weapp.git` |
| GitHub | `https://github.com/nuwax-ai/nuwax-mobile.git`                           |

## 查看当前远程仓库

```bash
git remote -v
```

## 切换到 GitLab

```bash
git remote set-url origin https://git.yichamao.com/agent-platform/agent-platform-front-weapp.git
```

## 切换到 GitHub

```bash
git remote set-url origin https://github.com/nuwax-ai/nuwax-mobile.git
```

## 验证切换是否成功

```bash
git remote -v
```

输出应显示新的远程仓库地址，例如：

```
origin  https://github.com/nuwax-ai/nuwax-mobile.git (fetch)
origin  https://github.com/nuwax-ai/nuwax-mobile.git (push)
```

## 注意事项

1. 切换远程仓库前，请确保本地代码已提交或暂存
2. 切换后首次 `git pull` 可能需要处理分支追踪关系
3. 如需同时保留两个远程仓库，可以添加新的 remote 而非修改 origin：
   ```bash
   # 添加 GitLab 为额外的远程仓库
   git remote add gitlab https://git.yichamao.com/agent-platform/agent-platform-front-weapp.git
   
   # 添加 GitHub 为额外的远程仓库
   git remote add github https://github.com/nuwax-ai/nuwax-mobile.git
   
   # 推送到指定远程
   git push gitlab main
   git push github main
   ```
