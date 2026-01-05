# 会话组件自动滚动底部规则文档

> 本文档描述了 `chat-conversation-component` 会话组件中自动滚动到底部的完整逻辑规则。
> 
> **最后更新**: 2025-12-30

---

## 核心状态变量

| 变量名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `autoToLastMsg` | `boolean` | `false` | 是否启用自动滚动到底部 |
| `scrollTouch` | `boolean` | `false` | 用户是否正在触摸滚动（touchend 后延迟 300ms 重置） |
| `mouseScroll` | `boolean` | `false` | 鼠标滚轮是否在滚动（H5专用） |
| `scrollInBottom` | `boolean` | `true` | 当前视图是否在底部 |
| `needSetLockAutoToLastMsg` | `boolean` | `true` | 是否需要检查锁定自动滚动 |
| `scrollIntoView` | `string` | `''` | 滚动目标元素ID，设为 `"last-msg"` 触发滚动 |

**文件位置**: `layers/AgentDetailData.uts`

---

## 触发自动滚动的场景

### 1. 发送消息时
- **代码位置**: `chat-conversation-component.uvue` → `handleSendMessage`
- **行为**: 设置 `autoToLastMsg = true`，调用 `scrollToLastMsg(false)`

### 2. 加载历史消息时
- **代码位置**: `layers/AgentDetailService.uts` → `handleQueryConversation`
- **行为**: 设置 `autoToLastMsg = true`

### 3. 点击"滚动到底部"按钮
- **代码位置**: `layers/ScrollManager.uts` → `scrollToLastMsg`
- **行为**: 设置 `autoToLastMsg = true`，`scrollIntoView = "last-msg"`

### 4. 流式消息更新时
- **代码位置**: `layers/AgentDetailService.uts` → `handleChangeMessageList`
- **行为**: 当 `autoToLastMsg = true` 时，发送 `streamMessageUpdate` 事件
- **响应**: 100ms 防抖后调用 `scrollToLastMsg(false)`

### 5. 消息列表/建议列表变化时
- **代码位置**: `chat-conversation-component.uvue`
- **行为**: 通过 watch 监听，调用 `handleScrollToLastMsg()`

---

## 取消自动滚动的情况

### 1. 用户主动向上滚动
- **条件**: 触摸/鼠标滚动 + 向上滚动 + 距离底部 > 50px
- **代码位置**: `layers/ScrollManager.uts` → `setIsInScrollBottom`

### 2. 消息列表为空
- **代码位置**: `layers/ScrollManager.uts` → `lockAutoToLastMsg`

---

## 滚动检测逻辑（兼容微信小程序）

```typescript
// 使用事件参数获取滚动信息
const scrollTop = e?.detail?.scrollTop ?? 0
const scrollHeight = e?.detail?.scrollHeight ?? 0

// 微信小程序使用估算值，其他平台使用 DOM 查询
// #ifdef MP-WEIXIN
const offsetHeight = 600
// #endif
// #ifndef MP-WEIXIN
const offsetHeight = uni.getElementById('msg-list')?.offsetHeight ?? 600
// #endif

const diff = scrollHeight - scrollTop - offsetHeight

// 判断是否在底部（距离 < 30px）
scrollInBottom = diff < 30

// 用户向上滚动时，距离超过 50px 才禁用自动滚动
if ((scrollTouch || mouseScroll) && isScrollingUp) {
    autoToLastMsg = diff <= 50
}
```

---

## 事件总线

| 事件名 | 发送位置 | 监听位置 | 用途 |
|--------|---------|---------|------|
| `streamMessageUpdate` | `AgentDetailService.uts` | `chat-conversation-component.uvue` | 流式消息更新触发滚动（100ms防抖）|
| `updateMessageComponent` | `AgentDetailService.uts` | `chat-conversation-component.uvue` | 更新消息组件内容 |

---

## 平台兼容性

| 平台 | 触摸检测 | 鼠标检测 | DOM 查询 |
|------|----------|----------|----------|
| 微信小程序 | `touchstart/end/cancel` | 不适用 | 使用事件参数 |
| H5/Web | `touchstart/end/cancel` | `wheel` 事件 | `uni.getElementById` |
| App | `touchstart/end/cancel` | 不适用 | `uni.getElementById` |

---

## 相关文件

| 文件 | 职责 |
|------|------|
| `layers/AgentDetailData.uts` | 状态变量定义 |
| `layers/ScrollManager.uts` | 滚动逻辑管理（跨平台兼容）|
| `layers/AgentDetailService.uts` | 消息处理与事件触发 |
| `chat-conversation-component.uvue` | 主组件，事件监听与 watch |
