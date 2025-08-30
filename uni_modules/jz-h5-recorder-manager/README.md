# jz-h5-getRecorderManager 录音插件

## 插件简介

这是一个完全兼容 `uni.getRecorderManager` API 的H5录音插件。当在App和小程序平台使用时，会直接调用原生的 `uni.getRecorderManager`；当在H5平台使用时，会使用基于 Web Audio API 的自定义实现，确保录音功能在所有平台上都能正常工作。

## 特性

- ✅ 完全兼容 `uni.getRecorderManager` API
- ✅ 支持H5、App、小程序等全平台
- ✅ 支持多种音频格式：mp3、wav、aac、PCM
- ✅ 支持录音暂停/继续功能
- ✅ 支持帧录制回调
- ✅ 支持录音时长限制
- ✅ 完善的错误处理机制
- ✅ 自动权限检测和申请

## 安装使用

### 1. 引入插件

```javascript
// 引入插件
import jzRecorder from '@/uni_modules/jz-h5-getRecorderManager'

// 获取录音管理器
const recorderManager = jzRecorder.getRecorderManager()
```

### 2. 基本用法

```javascript
<template>
  <view>
    <button @tap="startRecord">开始录音</button>
    <button @tap="pauseRecord">暂停录音</button>
    <button @tap="resumeRecord">继续录音</button>
    <button @tap="stopRecord">停止录音</button>
    <button @tap="playRecord">播放录音</button>
  </view>
</template>

<script>
import jzRecorder from '@/uni_modules/jz-h5-getRecorderManager'

export default {
  data() {
    return {
      recorderManager: null,
      audioContext: null,
      recordFile: null
    }
  },
  
  onLoad() {
    // 获取录音管理器
    this.recorderManager = jzRecorder.getRecorderManager()
    
    // 获取音频播放器
    this.audioContext = uni.createInnerAudioContext()
    this.audioContext.autoplay = true
    
    // 监听录音事件
    this.initRecorderEvents()
  },
  
  methods: {
    // 初始化录音事件监听
    initRecorderEvents() {
      // 录音开始
      this.recorderManager.onStart(() => {
        console.log('录音开始')
        uni.showToast({ title: '录音开始', icon: 'none' })
      })
      
      // 录音暂停
      this.recorderManager.onPause(() => {
        console.log('录音暂停')
        uni.showToast({ title: '录音暂停', icon: 'none' })
      })
      
      // 录音继续
      this.recorderManager.onResume(() => {
        console.log('录音继续')
        uni.showToast({ title: '录音继续', icon: 'none' })
      })
      
      // 录音停止
      this.recorderManager.onStop((res) => {
        console.log('录音停止', res)
        this.recordFile = res.tempFilePath
        uni.showToast({ 
          title: `录音完成，时长：${res.duration}秒`, 
          icon: 'none' 
        })
      })
      
      // 录音错误
      this.recorderManager.onError((err) => {
        console.error('录音错误', err)
        uni.showToast({ title: err.errMsg, icon: 'none' })
      })
    },
    
    // 开始录音
    startRecord() {
      this.recorderManager.start({
        duration: 60000, // 录音时长60秒
        sampleRate: 44100, // 采样率
        numberOfChannels: 1, // 声道数
        encodeBitRate: 192000, // 编码码率
        format: 'mp3' // 录音格式
      })
    },
    
    // 暂停录音
    pauseRecord() {
      this.recorderManager.pause()
    },
    
    // 继续录音
    resumeRecord() {
      this.recorderManager.resume()
    },
    
    // 停止录音
    stopRecord() {
      this.recorderManager.stop()
    },
    
    // 播放录音
    playRecord() {
      if (this.recordFile) {
        this.audioContext.src = this.recordFile
        this.audioContext.play()
      } else {
        uni.showToast({ title: '请先录音', icon: 'none' })
      }
    }
  },
  
  onUnload() {
    // 清理资源
    if (this.audioContext) {
      this.audioContext.destroy()
    }
  }
}
</script>
```

## API 说明

### getRecorderManager()

获取全局唯一的录音管理器实例。

**返回值：**
- RecorderManager：录音管理器对象

### RecorderManager 对象方法

#### start(options)

开始录音。

**参数：**

| 参数名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| duration | Number | 否 | 录音时长，单位ms，最大值600000（10分钟），默认60000 |
| sampleRate | Number | 否 | 采样率，有效值 8000/16000/44100，默认44100 |
| numberOfChannels | Number | 否 | 录音通道数，有效值 1/2，默认1 |
| encodeBitRate | Number | 否 | 编码码率，默认192000 |
| format | String | 否 | 音频格式，有效值 aac/mp3/wav/PCM，默认mp3 |
| frameSize | Number | 否 | 指定帧大小，单位 KB |

#### pause()

暂停录音。

#### resume()

继续录音。

#### stop()

停止录音。

### 事件监听方法

#### onStart(callback)

监听录音开始事件。

#### onPause(callback)

监听录音暂停事件。

#### onResume(callback)

监听录音继续事件。

#### onStop(callback)

监听录音停止事件。

**回调参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| tempFilePath | String | 录音文件的临时路径 |
| duration | Number | 录音总时长，单位秒 |
| fileSize | Number | 录音文件大小，单位字节 |

#### onError(callback)

监听录音错误事件。

**回调参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| errMsg | String | 错误信息 |

#### onFrameRecorded(callback)

监听已录制完指定帧大小的文件事件。

**回调参数：**

| 参数名 | 类型 | 说明 |
|--------|------|------|
| frameBuffer | ArrayBuffer | 录音分片结果数据 |
| isLastFrame | Boolean | 当前帧是否正常录音结束前的最后一帧 |

## 平台差异说明

| 平台 | 支持情况 | 说明 |
|------|----------|------|
| H5 | ✅ | 使用 Web Audio API 实现 |
| App | ✅ | 直接使用 uni.getRecorderManager |
| 微信小程序 | ✅ | 直接使用 uni.getRecorderManager |
| 支付宝小程序 | ✅ | 直接使用 uni.getRecorderManager |
| 其他小程序 | ✅ | 直接使用 uni.getRecorderManager |

## 注意事项

1. **权限问题**：H5环境下首次使用需要用户授权麦克风权限
2. **HTTPS要求**：H5环境下需要在HTTPS协议下才能正常使用录音功能
3. **浏览器兼容性**：需要浏览器支持 MediaRecorder API
4. **文件格式**：H5环境下实际保存的文件格式可能与设置的格式不同，取决于浏览器支持情况
5. **临时文件**：H5环境下生成的是Blob URL，需要及时处理或下载

## 更新日志

### v1.0.0
- 初始版本发布
- 完全兼容 uni.getRecorderManager API
- 支持H5环境下的录音功能
- 支持多种音频格式和参数配置

## 技术支持

如有问题请联系：
- QQ：578031621
- 仓库地址：https://gitcode.com/weixin_47770976/jz-h5-getRecorderManager
