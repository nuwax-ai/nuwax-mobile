# iOS 伙伴页录音中断改造与验收

基线为 `feat-2026.11.24` 的 `34ce7d2f9`。每轮记录测试包的源码指纹、IPA SHA-256、iOS 和飞书版本。两台设备都用开发签名测试包并连接测试环境。包版本号相同的产物也要单独记录指纹。

## 实现方案

1. **中断时先保全音频。** 仍由 Swift 在确认麦克风被占用后封口，原生把每次打开和封口的文件登记到会话目录。UTS 确认分段状态已经写入本地缓存后清除恢复索引。冷启动时读取剩余索引，补入 UTS 尚未登记的文件。时长优先使用文件音轨，读数为零或暂时无法解码时保留非空文件。上传队列先做有限次数的补封口，并复核音频能否读取。
2. **首段上传独立于续录。** 在首段开录且已有笔记 ID 时，把该文件的上传参数交给原生。确认中断并封口后，测试宿主可直接把该文件提交给后台 `URLSession`。UTS 对同一路径读取原生任务状态和业务回执，成功后才标记已上传。未能交接给系统、业务失败或任务被取消时，原上传队列按段号补传。当前只为段号 0 接入原生传输。
3. **收到恢复信号后另开新段。** 继续支持旧 `ended` 和系统电话路径。原生检测到新录音器已开始计时后才把新段交给 UTS，同属一条笔记。iOS 27 恢复建议默认只记录送达时机，启用实验开关后才触发恢复。混音有单独开关，便于区分「通知到达」和「音频会话能重新激活」。收不到信号的后台场景保持暂停，回女娲后走现有兜底。面板分别显示通话暂停与首段上传状态。

默认交付并验收首段保全、冷启动对账和状态提示。系统后台上传需先在有回调的测试宿主通过服务端验收。后台自动续录按真机通过的系统和通话场景启用。

## 设备和账号

- Mac 飞书客户端登录账号 A，作为主叫。待测 iPhone 飞书客户端登录不同的账号 B，作为被叫。测试只在这两个已确认的账号之间拨打。若两台 iPhone 用同一账号 B，轮测时隔离另一台的通知，避免接错。
- iPhone 16 覆盖 iOS 27 的新恢复建议，iPhone 13 覆盖旧通知。开始时用手机内置麦克风，断开蓝牙耳机。Mac 飞书接通后静音 Mac 的通话麦克风。标识音从 Mac 扬声器播放，由 iPhone 麦克风在现场拾取。
- 人只需要登录账号。拨号、接听、挂断和切页由操作者负责，所有待采集声音由脚本播放。长通话过程中保持静音即可，测试者无需持续说话。

## 四个可识别的标识音

在 worktree 根目录生成。每个 WAV 约 4 秒，由不同的双音组成。脚本使用 macOS 默认音频输出，执行前将输出指向 Mac 扬声器。

```sh
python3 scripts/ios-tester/voice-note-qa.py generate
python3 scripts/ios-tester/voice-note-qa.py play before
```

| 标识 | 播放时机 | 要证明的结果 |
| --- | --- | --- |
| `before` | 伙伴页开始录音后，接听前 | 第一段保留了真实采样 |
| `during` | 两端都显示已接通后 | 女娲录音中没有通话期间的采样 |
| `after` | 确认挂断后立刻播放，iPhone 留在飞书 | 后台续录是否真正开始 |
| `returned` | 打开女娲之后播放 | 回前台的兜底路径是否可用 |

所有播放命令把开始和结束时刻写入 `out/ios-voice-note-qa/playback.jsonl`。每轮用 `--out out/ios-voice-note-qa/<case>` 保留自己的时间线。语音通话起止时间由操作者记入同一轮记录。

## 真机操作和判定

1. iPhone 打开女娲伙伴页录音，等面板开始计时。播放 `before` 两遍。Mac 拨飞书语音，iPhone 接起并留在飞书。确认接通后播放 `during` 两遍。短通话维持约 15 秒，长通话维持至少 3 分钟。
2. 通话期间在另一客户端或测试环境服务端查看笔记的第一段。分别记下原生封口、后台任务提交、服务端落段的时刻。挂断后仍从另一客户端查看一次。只有服务端返回第一段并且该段可播放，才记为后台已入库。
3. 从 Mac 挂断。iPhone 继续留在飞书，立即执行 `play after --repeat 5`，约 20 秒。然后回女娲执行 `play returned`，最后点完成。恢复日志必须在回女娲之前，且对应新文件中能找到 `after`，才记为后台续录通过。
4. 用 `[voice-note] m4a writing localId=...` 确定本轮录音目录。在测试包允许访问容器时复制该目录，或导出测试音频。最终完成后 App 可能清掉已上传的本地文件，介质可提前复制或从服务端下载。VAYS 对照通过分享功能导出测试录音，按播放时间轴人工确认，或按通话边界切段后交给检测器。

```sh
python3 scripts/ios-tester/voice-note-qa.py --out out/ios-voice-note-qa/feishu-long play during
python3 scripts/ios-tester/voice-note-qa.py --out out/ios-voice-note-qa/feishu-long play after --repeat 5

xcrun devicectl device copy from --device "$IOS_QA_DEVICE" \
  --domain-type appDataContainer --domain-identifier com.nuwax.app \
  --source "Documents/voice-notes/$VOICE_NOTE_QA_LOCAL_ID" \
  --destination out/ios-voice-note-qa/feishu-long/segments

python3 scripts/ios-tester/voice-note-qa.py check --expect background /path/to/first.m4a /path/to/next.m4a
```

按录音顺序传分段给检测器。兜底场景用 `--expect foreground`，要求 `after` 缺席、回女娲后才出现 `returned`。手动暂停或结束场景用 `--expect no-resume`。检测器只判断本地音频内容。后台上传按服务端读回单独验收。

## 对照组与发布门槛

| 组别 | 设置 | 通过标准 |
| --- | --- | --- |
| 原样基线 | 锁定 11.24 包，在两台 iPhone 跑飞书短、长通话 | 记录实际首段和续录现象，保留原生日志及测试音频 |
| 首段保全 | 改造包的默认路径，先关闭实验开关 | 原始第一段可播放。通话后强退再启动时，从本地恢复已关段，也能找回原生刚开而 UTS 未登记的段 |
| 原生后台上传 | 只启用测试宿主的后台上传 | 留在飞书时服务端有第一段。断网、鉴权失败或强退后保留文件，重进女娲按原段号补传。服务端同一笔记只有一条首段 |
| iOS 27 恢复通知 | 先仅观察新旧通知。再启用新通知的恢复路径，混音关闭 | 新通知在挂断后、回前台前送达。激活成功，新段出现 `after`，通话期间无 `during` |
| 混音 | 只启用混音，保持 iOS 27 恢复开关关闭 | 对比旧通知送达和音频会话激活结果。不能在对方仍通话时误启录音 |
| 回归 | 拒接、普通切后台、来电前手动暂停、通话中回女娲点完成、蜂窝或 FaceTime、重复来电、低网速 | 没接通也能恢复原录音，用户手动暂停或结束保持有效，重复中断的分段顺序和计时正确 |

两个续录开关都默认关闭。新通知开关在通过 iOS 27 真机验收后开放。混音在同包对照通过后考虑启用。飞书长通话无恢复信号的场景继续使用回女娲后恢复。

后台上传实验由独立测试宿主提供 `AppDelegate` 回调，打包时设置 `NUWAX_VOICE_NOTE_BACKGROUND_UPLOAD=1`。提交同一条笔记第 0 段，且要求笔记 ID、鉴权和源文件路径已在中断前交接。其他分段、未交接和失败通过既有补传队列处理。普通基座或云包需接入并验证同一宿主回调才能启用。

iOS 27 恢复和混音从打包后的 App 启动参数读取，每次只传一个。基线验证时不要附加调试器。

```sh
xcrun devicectl device process launch --device "$IOS_QA_DEVICE" --terminate-existing \
  com.nuwax.app -- -NuwaxVoiceNoteResumeRecommendation YES
xcrun devicectl device process launch --device "$IOS_QA_DEVICE" --terminate-existing \
  com.nuwax.app -- -NuwaxVoiceNoteMixWithOthers YES
```

记录 `began`、文件长度、录音时长、后台任务过期、上传响应、新旧恢复通知、音频会话激活错误域及错误码、挂断后的首个可验证采样。出现异常时以音频、日志和服务端读回三者为准。
