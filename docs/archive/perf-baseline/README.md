# 优化前基线(Phase 4 列表层修复前)

> 留存时间:2026-08-07 10:07。分支 `feat/nuwa-zhuoda-2026.07-perf-vdom`,改动前快照已存 `docs/perf-baseline/before-phase4-chat-conversation-component.uvue`(126367 字节,3563 行)。

## 任务 A — getMessageAttachments 分配

**现状**:每次函数调用无附件时 `return [] as any[]` 分配新数组;有附件时 `raw as any[]`。模板每 message cell 调 ~4 次。

模板内出现点(每 cell 反复触发):
- `:165` `v-if="hasMessageAttachments(item)"`(= 再调 getMessageAttachments)+ 函数体内 `:1057` 又调一次 → 实际 2 次
- `:178` `v-for="(file, fileIndex) in getMessageAttachments(item)"` → 1 次
- `:180` `@click="onPreview(file, getMessageAttachments(item))"` → 1 次
- `:1099` 函数体内其它调用 → 视路径

**合计:每 message cell 模板+函数内 ≥4 次 `getMessageAttachments` 调用,其中无附件时每次新建空数组。**

## 任务 B — isLastMessage 查表

模板内出现点(每 cell 反复触发):
- `:135` `:class="isLastMessage(listIndex)..."` → 1 次
- `:151` `:is-last-msg="isLastMessage(listIndex)"` → 1 次
- `:153` `:show-tool-bar="!(isConversationActive && isLastMessage(listIndex))"` → 1 次

**合计:每 message cell 3 次 `isLastMessage(listIndex)` 调用,每次都按 index 查 `messageList[listIndex]`。**

## 任务 C — deep watch

- `:2384` `watch(lastMessage, ..., { deep: true })` — 流式期 messageList 每 ~100ms 换新数组,deep watch 每帧深遍历嵌套字段。

其它 `deep:true`(`:2424` chatSuggestList、`:2453` conversationId)——不在本次范围,勿动。

## 运行时基线(待真机,Phase 2)
- mockStreamPerf + 帧探针(perfProbe)已就绪,Phase 2 真机跑出 avgFps/maxGap 后补填此处。
- 当前只有代码静态基线,无真机数字。
