# H5端权限处理解决方案

## 问题描述

在H5端，当用户第一次拒绝麦克风权限后，浏览器会记住这个选择。后续再次调用 `navigator.mediaDevices.getUserMedia()` 时不会再次弹出权限选择框，而是直接返回 `Permission denied` 错误，导致用户无法重新选择权限。

## 解决方案

我们提供了一个完整的权限处理工具类，可以：

1. **检测权限状态** - 准确检测当前权限状态
2. **请求权限** - 智能请求权限，处理各种情况
3. **监听权限变化** - 实时监听权限状态变化
4. **显示权限引导** - 当权限被拒绝时，提供详细的操作引导
5. **重新请求权限** - 提供重新请求权限的机制

## 核心文件

### 1. 权限处理工具类
- **文件**: `utils/permissionHelper.uts`
- **功能**: 提供权限检测、请求、监听等核心功能

### 2. 录音按钮组件
- **文件**: `components/voice-recorder-button/voice-recorder-button.uvue`
- **功能**: 集成了权限处理逻辑的录音组件

### 3. 使用示例
- **文件**: `examples/permission-handler-example.uts`
- **功能**: 展示各种使用场景的示例代码

## 使用方法

### 基础使用

```typescript
import { MicrophonePermissionHelper } from '@/utils/permissionHelper'

// 检查权限状态
const state = await MicrophonePermissionHelper.check()
console.log('权限状态:', state) // 'granted' | 'denied' | 'prompt' | 'unknown'

// 请求权限
const success = await MicrophonePermissionHelper.request()
if (success) {
  console.log('权限获取成功')
} else {
  console.log('权限获取失败')
}

// 确保权限可用（推荐使用）
const hasPermission = await MicrophonePermissionHelper.ensure(true)
if (hasPermission) {
  // 开始录音
  startRecording()
} else {
  // 权限被拒绝，会显示引导
}
```

### 在组件中使用

```vue
<template>
  <view class="voice-recorder">
    <button @click="handleRecordClick">开始录音</button>
    
    <!-- 权限引导弹窗 -->
    <uni-popup v-if="showPermissionModal" type="center">
      <view class="permission-guide">
        <text>需要麦克风权限</text>
        <button @click="retryPermission">重新尝试</button>
      </view>
    </uni-popup>
  </view>
</template>

<script lang="uts" setup>
import { MicrophonePermissionHelper, type PermissionState } from '@/utils/permissionHelper'

const showPermissionModal = ref(false)

// 处理录音点击
const handleRecordClick = async () => {
  const hasPermission = await MicrophonePermissionHelper.ensure(true)
  if (hasPermission) {
    startRecording()
  } else {
    showPermissionModal.value = true
  }
}

// 重新尝试获取权限
const retryPermission = async () => {
  showPermissionModal.value = false
  const success = await MicrophonePermissionHelper.ensure(false)
  if (success) {
    startRecording()
  } else {
    showPermissionModal.value = true
  }
}
</script>
```

### 监听权限变化

```typescript
// 监听权限状态变化
MicrophonePermissionHelper.watch((state: PermissionState) => {
  console.log('权限状态变化:', state)
  
  if (state === 'granted') {
    // 用户授予了权限
    enableRecording()
  } else if (state === 'denied') {
    // 用户拒绝了权限
    disableRecording()
    showPermissionWarning()
  }
})
```

### 多权限处理

```typescript
import { PermissionManager } from '@/utils/permissionHelper'

const permissionManager = PermissionManager.getInstance()

// 检查多个权限
const permissions = ['microphone', 'camera'] as const

for (const permission of permissions) {
  const state = await permissionManager.checkPermission(permission)
  console.log(`${permission} 权限状态:`, state)
  
  if (state === 'denied') {
    permissionManager.showPermissionGuide(permission)
  }
}
```

## 权限状态说明

| 状态 | 说明 | 处理方式 |
|------|------|----------|
| `granted` | 权限已授予 | 可以直接使用功能 |
| `denied` | 权限被拒绝 | 显示权限引导，用户需要手动开启 |
| `prompt` | 需要请求权限 | 调用 `request()` 方法请求权限 |
| `unknown` | 权限状态未知 | 尝试请求权限来检测状态 |

## 权限引导流程

当权限被拒绝时，系统会：

1. **显示权限引导弹窗** - 提供详细的操作步骤
2. **提供重新尝试按钮** - 用户可以重新请求权限
3. **引导用户手动开启** - 如果重新请求失败，引导用户在浏览器设置中手动开启

### 权限引导步骤

1. 点击浏览器地址栏左侧的锁定图标
2. 找到"麦克风"选项，选择"允许"
3. 刷新页面后重新尝试录音

## 浏览器兼容性

### 支持的浏览器
- Chrome 47+
- Firefox 44+
- Safari 11+
- Edge 79+

### 权限API支持
- **Permissions API**: Chrome 43+, Firefox 46+, Safari 16+
- **getUserMedia API**: 所有现代浏览器

### 降级处理
对于不支持 Permissions API 的浏览器，系统会：
1. 尝试直接请求权限来检测状态
2. 根据请求结果判断权限状态
3. 提供相应的处理方案

## 最佳实践

### 1. 权限检查时机
- **页面加载时**: 检查权限状态，更新UI
- **功能使用前**: 确保权限可用
- **权限变化时**: 实时响应权限状态变化

### 2. 用户体验
- **渐进式权限请求**: 在用户真正需要时才请求权限
- **清晰的权限说明**: 解释为什么需要权限
- **友好的错误处理**: 提供详细的解决步骤

### 3. 错误处理
- **网络错误**: 区分权限错误和网络错误
- **浏览器不支持**: 提供降级方案
- **用户取消**: 优雅处理用户取消操作

## 常见问题

### Q: 为什么权限被拒绝后无法重新请求？
A: 这是浏览器的安全机制。当用户拒绝权限后，浏览器会记住这个选择，不会再次弹出权限选择框。需要通过权限引导让用户手动开启。

### Q: 如何检测权限是否被拒绝？
A: 使用 `MicrophonePermissionHelper.check()` 方法检测权限状态，或者监听权限变化事件。

### Q: 权限引导弹窗可以自定义吗？
A: 可以。`PermissionManager.showPermissionGuide()` 方法提供了基础的引导，你也可以创建自定义的引导UI。

### Q: 支持哪些权限类型？
A: 目前支持 `microphone`、`camera`、`geolocation`、`notifications` 等权限类型。

## 更新日志

### v1.0.0
- 初始版本
- 支持麦克风权限检测和请求
- 提供权限引导功能
- 支持权限状态监听

## 贡献

欢迎提交 Issue 和 Pull Request 来改进这个权限处理解决方案。
