# 语音录制转文本功能实现指南

## 概述

本项目已成功集成基于 `jz-h5-recorder-manager` 插件的语音录制转文本功能。用户可以通过长按按钮进行语音录制，录制完成后系统会自动将语音转换为文本并发送。

## 功能特性

✅ **完整的语音录制功能**
- 长按录音，松开停止
- 实时录音状态显示
- 录音时长显示
- 波形动画效果

✅ **智能语音转文字**
- 支持中文语音识别
- 模拟后端API服务
- 错误处理和重试机制
- 置信度和分段结果

✅ **优秀的用户体验**
- 震动反馈
- 状态提示
- 错误提示
- 流畅的界面切换

✅ **跨平台兼容**
- H5平台
- 小程序平台
- App平台

## 文件结构

```
components/
├── voice-recorder-button/           # 语音录制按钮组件
│   └── voice-recorder-button.uvue
├── chat-input-phone/               # 聊天输入组件（已集成语音功能）
│   └── chat-input-phone.uvue
utils/
├── voiceRecorderManager.uts        # 录音管理器封装
├── audioUploader.uts               # 音频上传工具
└── mockApiService.uts              # 模拟API服务
uni_modules/
└── jz-h5-recorder-manager/         # 录音插件（已安装）
```

## 组件使用方法

### 1. VoiceRecorderButton 组件

独立的语音录制按钮组件，可在任何页面中使用：

```vue
<template>
  <voice-recorder-button
    :duration="60000"
    :format="'mp3'"
    :show-waveform="true"
    button-text="长按录音"
    @record-start="handleRecordStart"
    @record-stop="handleRecordStop"
    @error="handleRecordError"
  />
</template>

<script lang="uts" setup>
import VoiceRecorderButton from '@/components/voice-recorder-button/voice-recorder-button.uvue'

const handleRecordStart = () => {
  console.log('开始录音')
}

const handleRecordStop = (text: string) => {
  console.log('录音结果:', text)
}

const handleRecordError = (error: any) => {
  console.error('录音错误:', error)
}
</script>
```

#### 组件参数

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| duration | number | 60000 | 最大录音时长(毫秒) |
| format | string | 'mp3' | 音频格式 |
| sampleRate | number | 44100 | 采样率 |
| buttonText | string | '长按录音' | 按钮提示文字 |
| showWaveform | boolean | true | 是否显示波形动画 |

#### 组件事件

| 事件名 | 参数 | 说明 |
|--------|------|------|
| record-start | - | 开始录音时触发 |
| record-stop | text: string | 录音结束并转换为文字时触发 |
| error | error: any | 录音或转换出错时触发 |

### 2. ChatInputPhone 组件

已集成语音录制功能的聊天输入组件，支持键盘输入和语音输入模式切换：

```vue
<template>
  <chat-input-phone 
    :on-enter="handleSendMessage"
  />
</template>

<script lang="uts" setup>
import ChatInputPhone from '@/components/chat-input-phone/chat-input-phone.uvue'

const handleSendMessage = (message: string, files: any[]) => {
  console.log('发送消息:', message)
  console.log('附件:', files)
}
</script>
```

## 工具类使用方法

### 1. VoiceRecorderManager

录音管理器封装类，提供完整的录音控制功能：

```typescript
import { createVoiceRecorderManager, RecorderConfig } from '@/utils/voiceRecorderManager'

// 创建录音管理器
const config: RecorderConfig = {
  duration: 60000,
  format: 'mp3',
  sampleRate: 44100
}

const recorderManager = createVoiceRecorderManager(config)

// 注册事件监听
recorderManager.onStart(() => {
  console.log('开始录音')
})

recorderManager.onStop((audioFile) => {
  console.log('录音完成:', audioFile)
})

recorderManager.onError((error) => {
  console.error('录音错误:', error)
})

// 开始录音
await recorderManager.startRecording()

// 停止录音
const audioFile = await recorderManager.stopRecording()
```

### 2. AudioUploader

音频文件上传和转换工具：

```typescript
import { createAudioUploader, AudioFile } from '@/utils/audioUploader'

// 创建上传器
const uploader = createAudioUploader({
  apiUrl: '/api/voice-to-text',
  timeout: 30000,
  language: 'zh-CN'
})

// 上传音频文件
const audioFile: AudioFile = {
  tempFilePath: 'path/to/audio.mp3',
  duration: 5.2,
  fileSize: 102400,
  format: 'mp3'
}

try {
  const result = await uploader.uploadAudio(audioFile, (progress) => {
    console.log('上传进度:', progress.percent + '%')
  })
  
  if (result.success) {
    console.log('转换结果:', result.text)
    console.log('置信度:', result.confidence)
  }
} catch (error) {
  console.error('上传失败:', error)
}
```

### 3. MockApiService

模拟API服务，用于测试和开发：

```typescript
import { createApiClient, convertVoiceToText } from '@/utils/mockApiService'

// 使用默认客户端
try {
  const text = await convertVoiceToText(audioFile, {
    format: 'mp3',
    duration: 5.2,
    language: 'zh-CN'
  })
  console.log('转换结果:', text)
} catch (error) {
  console.error('转换失败:', error)
}

// 自定义配置
const apiClient = createApiClient('https://your-api.com', false)
const response = await apiClient.voiceToText(audioFile, options)
```

## 配置说明

### 录音配置参数

```typescript
interface RecorderConfig {
  duration?: number        // 录音时长(ms)，默认60000
  sampleRate?: number      // 采样率，默认44100
  numberOfChannels?: number // 声道数，默认1
  encodeBitRate?: number   // 编码码率，默认192000
  format?: string          // 音频格式，默认'mp3'
  frameSize?: number       // 帧大小(KB)，可选
}
```

### 上传配置参数

```typescript
interface UploadConfig {
  apiUrl?: string          // API地址
  timeout?: number         // 超时时间(ms)
  language?: string        // 语言类型
  enableRetry?: boolean    // 是否启用重试
  maxRetries?: number      // 最大重试次数
  retryDelay?: number      // 重试延迟(ms)
}
```

## 错误处理

系统提供完善的错误处理机制：

### 错误类型

| 错误代码 | 错误说明 | 处理方案 |
|----------|----------|----------|
| PERMISSION_DENIED | 麦克风权限被拒绝 | 引导用户开启权限 |
| DEVICE_NOT_SUPPORTED | 设备不支持录音 | 提示更换设备 |
| DURATION_TOO_SHORT | 录音时长过短 | 提示最少录音时长 |
| DURATION_TOO_LONG | 录音时长过长 | 自动停止录音 |
| NETWORK_ERROR | 网络连接异常 | 重试或离线提示 |
| UPLOAD_FAILED | 上传失败 | 重试上传 |

### 错误处理示例

```typescript
import { ErrorHandler } from '@/utils/voiceRecorderManager'

try {
  await recorderManager.startRecording()
} catch (error) {
  // 使用错误处理器
  await ErrorHandler.handleRecordingError(error)
}
```

## 性能优化

### 1. 内存管理

```typescript
import { MemoryManager } from '@/utils/audioUploader'

// 清理音频文件
MemoryManager.cleanupAudioFile(filePath)

// 清理所有文件
MemoryManager.cleanupAllAudioFiles()
```

### 2. 文件大小限制

- 最大文件大小：10MB
- 最短录音时长：1秒
- 最长录音时长：10分钟

### 3. 并发控制

- 同时最多保留3个录音文件
- 自动清理过期文件
- 内存泄漏防护

## 自定义配置

### 1. 修改API端点

```typescript
// 在 audioUploader.uts 中修改默认配置
const uploader = createAudioUploader({
  apiUrl: 'https://your-api.com/speech-to-text',
  timeout: 60000,
  language: 'en-US'
})
```

### 2. 自定义模拟数据

```typescript
import { mockApiService } from '@/utils/mockApiService'

// 添加自定义文本
mockApiService.addMockText('short', '自定义短文本')
mockApiService.addMockText('long', '自定义长文本内容...')

// 设置成功率
mockApiService.setSuccessRate(0.98)

// 设置请求延迟
mockApiService.setRequestDelay(2000)
```

### 3. 样式自定义

在组件的 `<style>` 部分修改CSS变量：

```scss
.voice-button {
  --primary-color: #1890ff;     // 主色调
  --success-color: #52c41a;     // 成功色
  --error-color: #ff4d4f;       // 错误色
  --recording-color: #ff4d4f;   // 录音中颜色
}
```

## 测试功能

### 1. 功能测试

在聊天页面中测试以下功能：
- 切换到语音输入模式
- 长按录音按钮开始录音
- 松开按钮停止录音
- 查看转换结果

### 2. 错误测试

测试各种错误场景：
- 拒绝麦克风权限
- 录音时长过短
- 网络异常情况

### 3. 性能测试

- 连续多次录音
- 长时间录音
- 内存使用情况

## 部署说明

### 1. 生产环境配置

替换模拟API为真实API：

```typescript
// 在 audioUploader.uts 中修改
const uploader = createAudioUploader({
  apiUrl: 'https://production-api.com/voice-to-text'
})
```

### 2. 权限配置

确保在 `manifest.json` 中配置麦克风权限：

```json
{
  "permissions": {
    "record-audio": {
      "desc": "录音功能需要使用麦克风"
    }
  }
}
```

### 3. 平台兼容性

| 平台 | 支持情况 | 备注 |
|------|----------|------|
| H5 | ✅ | 需要HTTPS环境 |
| 微信小程序 | ✅ | 需要配置域名白名单 |
| App | ✅ | 需要申请录音权限 |

## 故障排除

### 常见问题

1. **录音没有声音**
   - 检查麦克风权限
   - 确认设备支持录音
   - 检查音量设置

2. **转换失败**
   - 检查网络连接
   - 确认API配置正确
   - 查看控制台错误信息

3. **界面不响应**
   - 检查组件导入
   - 确认事件绑定正确
   - 查看控制台错误

### 调试模式

开启调试模式查看详细日志：

```typescript
// 在控制台中执行
localStorage.setItem('VOICE_DEBUG', 'true')
```

## 更新日志

### v1.0.0 (2025-01-22)
- ✅ 完成语音录制按钮组件
- ✅ 完成录音管理器封装
- ✅ 完成音频上传工具
- ✅ 完成模拟API服务
- ✅ 完成聊天输入组件集成
- ✅ 完成错误处理机制
- ✅ 完成性能优化
- ✅ 完成文档说明

## 技术支持

如有问题，请查阅：
1. 本文档的故障排除部分
2. `jz-h5-recorder-manager` 插件文档
3. uni-app官方文档

## 许可证

本项目遵循项目根目录的许可证协议。