# push-send 回滚备份

## v1.3.7

- 2026-11-19 从 Git 标签 `v1.3.7` 导出完整函数目录，包含 `index.js` 和 `package.json`。它与 VoIP 合入前的 `8d211727a` 函数目录内容一致。
- 原路径为 `uniCloud-alipay/cloudfunctions/push-send/`，Git 目录对象为 `317df3f28d99daf405153d323b743e50d7de4e4d`。
- 这是仓库中的 VoIP 前基线。生产当前版本尚未核对。备份存放在 `backups/`，需要恢复时再将选定版本放回云函数目录。

## 覆盖前确认备份

1. 用生产 IM 实际调用的 URL 确认对应的 uniCloud 服务空间和 Space ID。在临时 HBuilderX 项目里下载当前云端 `push-send`，保留完整函数目录。
2. 对比下载的目录与 `v1.3.7/`。如果源码有差异，保留这份 Git 基线，另按下载日期保存云端源码，并把实际下载的版本登记为回滚目标。

   ```bash
   diff -qr /path/to/downloaded/push-send backups/unicloud/push-send/v1.3.7
   ```

3. 在受控配置里记录部署前的 URL 路径、Node.js 运行时、`uni-cloud-push` 扩展和环境变量。仓库备份只记录密钥引用，`PUSH_SIGN_KEY` 实值和含密钥的 `.env` 留在受控配置里。

## 恢复

1. 先让 IM 恢复与备份版本匹配的请求格式。恢复 `v1.3.7` 时，会议邀请恢复为 `payload.type=meeting_invite`，并停用依赖逐 CID 选路回执的新来电请求。
2. 把确认的备份版本放进临时项目中该服务商对应的 `cloudfunctions/push-send/`。核对目标 Space ID 和原 URL 路径，按覆盖前的运行配置上传这一个函数。设备路由集合 `voip-device-routes` 可以保留。
3. 用测试账号验证普通消息前后台行为、角标和会议邀请，并检查 IM 调用和云函数日志。
