// H5录音管理插件
// 完全兼容 uni.getRecorderManager API

// 检测当前平台
function isH5Platform() {
  // #ifdef H5
  return true;
  // #endif
  return false;
}

// H5录音管理器实现
class H5RecorderManager {
  constructor() {
    this.mediaRecorder = null;
    this.audioContext = null;
    this.analyser = null;
    this.audioChunks = [];
    this.startTime = null;
    this.isPaused = false;
    this.isRecording = false;
    // 触摸结束取消录音(自定义变量)
    this.touchEndCancelFlag = false;

    // 事件回调函数
    this.callbacks = {
      onStart: [],
      onPause: [],
      onResume: [],
      onStop: [],
      onError: [],
      onFrameRecorded: [],
      onInterruptionBegin: [],
      onInterruptionEnd: [],
    };

    // 默认配置
    this.defaultOptions = {
      duration: 60000, // 录音时长，单位ms，最大值600000（10分钟）
      sampleRate: 44100, // 采样率，有效值 8000/16000/44100
      numberOfChannels: 1, // 录音通道数，有效值 1/2
      encodeBitRate: 192000, // 编码码率，有效值见下表格
      format: 'mp3', // 音频格式，有效值 aac/mp3/wav/PCM
      frameSize: null, // 指定帧大小，单位 KB
    };
  }

  // 开始录音
  start(options = {}) {
    if (this.isRecording) {
      this._triggerError('录音已在进行中');
      return;
    }

    const config = Object.assign({}, this.defaultOptions, options);
    // 检查浏览器支持
    if (
      typeof navigator.mediaDevices === 'undefined' ||
      !navigator.mediaDevices.getUserMedia
    ) {
      // 这里做一个消息原因增加说明
      const isHttpsProtocol =
        (typeof window !== 'undefined' &&
          window.location.protocol === 'https:') ||
        false;

      const msg = !isHttpsProtocol
        ? '需要在HTTPS模式下且同意浏览器录音授权时支持语音'
        : '当前浏览器不支持录音功能';

      this._triggerError(msg);
      return;
    }

    // 请求麦克风权限并开始录音
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          sampleRate: config.sampleRate,
          channelCount: config.numberOfChannels,
        },
      })
      .then(stream => {
        console.log('获取麦克风权限成功: stream', stream);
        if (this.touchEndCancelFlag) {
          this.touchEndCancelFlag = false;
          return;
        }
        this._initRecorder(stream, config);
      })
      .catch(error => {
        console.error('获取麦克风权限失败:', error);
        this._triggerError('获取麦克风权限失败: ' + error.message);
      });
  }

  // 初始化录音器
  _initRecorder(stream, config) {
    try {
      // 创建AudioContext用于音频处理
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();

      // 创建MediaRecorder
      const mimeType = this._getMimeType(config.format);

      if (!MediaRecorder.isTypeSupported(mimeType)) {
        uni.showToast({
          title: `不支持${config.format}格式，将使用默认格式`,
          icon: 'none',
        });
      }

      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported(mimeType)
          ? mimeType
          : undefined,
        audioBitsPerSecond: config.encodeBitRate,
      });
      console.log(stream, this.mediaRecorder.mimeType);

      this.audioChunks = [];
      this.startTime = Date.now();
      this.isRecording = true;
      this.isPaused = false;

      // 设置事件监听
      this.mediaRecorder.ondataavailable = event => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);

          // 触发帧录制回调
          if (config.frameSize && this.callbacks.onFrameRecorded.length > 0) {
            this._triggerFrameRecorded(event.data, false);
          }
        }
      };

      this.mediaRecorder.onstop = () => {
        this._handleRecordStop(config);
      };

      this.mediaRecorder.onerror = event => {
        this._triggerError('录音过程中出现错误: ' + event.error);
      };

      // 开始录音
      if (config.frameSize) {
        // 如果设置了frameSize，定时收集数据
        this.mediaRecorder.start(config.frameSize * 1024); // frameSize is in KB
      } else {
        this.mediaRecorder.start();
      }

      // 设置录音时长限制
      if (config.duration && config.duration > 0) {
        setTimeout(() => {
          if (this.isRecording && !this.isPaused) {
            this.stop();
          }
        }, config.duration);
      }

      // 触发开始事件
      this._triggerStart();
    } catch (error) {
      console.error('初始化录音器失败:', error);
      this._triggerError('初始化录音器失败: ' + error.message);
    }
  }

  // 获取MIME类型
  _getMimeType(format) {
    const mimeTypes = {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      aac: 'audio/aac',
      PCM: 'audio/wav',
    };
    return mimeTypes[format] || 'audio/webm';
  }

  // 暂停录音
  pause() {
    if (!this.isRecording || this.isPaused) {
      return;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.pause();
      this.isPaused = true;
      this._triggerPause();
    }
  }

  // 继续录音
  resume() {
    if (!this.isRecording || !this.isPaused) {
      return;
    }

    if (this.mediaRecorder && this.mediaRecorder.state === 'paused') {
      this.mediaRecorder.resume();
      this.isPaused = false;
      this._triggerResume();
    }
  }

  // 停止录音
  stop() {
    if (!this.isRecording) {
      return;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    // 停止所有音频轨道
    if (this.mediaRecorder && this.mediaRecorder.stream) {
      this.mediaRecorder.stream.getTracks().forEach(track => track.stop());
    }

    this.isRecording = false;
    this.isPaused = false;
  }

  // 处理录音停止
  _handleRecordStop(config) {
    if (this.audioChunks.length === 0) {
      this._triggerError('没有录制到音频数据');
      return;
    }

    // 创建音频文件
    const audioBlob = new Blob(this.audioChunks, {
      type: this._getMimeType(config.format),
    });

    // 创建临时文件URL
    const tempFilePath = URL.createObjectURL(audioBlob);

    // 计算录音时长
    const duration = this.startTime ? (Date.now() - this.startTime) / 1000 : 0;

    // 触发停止事件
    this._triggerStop({
      tempFilePath: tempFilePath,
      duration: duration,
      fileSize: audioBlob.size,
    });

    // 清理资源
    this._cleanup();
  }

  // 清理资源
  _cleanup() {
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.mediaRecorder = null;
    this.audioChunks = [];
    this.startTime = null;
    this.touchEndCancelFlag = false;
  }

  // 事件监听方法
  onStart(callback) {
    if (typeof callback === 'function') {
      this.callbacks.onStart.push(callback);
    }
  }

  onPause(callback) {
    if (typeof callback === 'function') {
      this.callbacks.onPause.push(callback);
    }
  }

  onResume(callback) {
    if (typeof callback === 'function') {
      this.callbacks.onResume.push(callback);
    }
  }

  onStop(callback) {
    if (typeof callback === 'function') {
      this.callbacks.onStop.push(callback);
    }
  }

  onError(callback) {
    if (typeof callback === 'function') {
      this.callbacks.onError.push(callback);
    }
  }

  onFrameRecorded(callback) {
    if (typeof callback === 'function') {
      this.callbacks.onFrameRecorded.push(callback);
    }
  }

  onInterruptionBegin(callback) {
    if (typeof callback === 'function') {
      this.callbacks.onInterruptionBegin.push(callback);
    }
  }

  onInterruptionEnd(callback) {
    if (typeof callback === 'function') {
      this.callbacks.onInterruptionEnd.push(callback);
    }
  }

  // 移除事件监听方法（支付宝小程序兼容）
  offStart(callback) {
    this._removeCallback('onStart', callback);
  }

  offPause(callback) {
    this._removeCallback('onPause', callback);
  }

  offResume(callback) {
    this._removeCallback('onResume', callback);
  }

  offStop(callback) {
    this._removeCallback('onStop', callback);
  }

  offFrameRecorded(callback) {
    this._removeCallback('onFrameRecorded', callback);
  }

  // 移除回调函数
  _removeCallback(eventName, callback) {
    if (callback && this.callbacks[eventName]) {
      const index = this.callbacks[eventName].indexOf(callback);
      if (index > -1) {
        this.callbacks[eventName].splice(index, 1);
      }
    }
  }

  // 触发事件的私有方法
  _triggerStart() {
    this.callbacks.onStart.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('onStart callback error:', error);
      }
    });
  }

  _triggerPause() {
    this.callbacks.onPause.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('onPause callback error:', error);
      }
    });
  }

  _triggerResume() {
    // 重置触摸结束取消录音标志
    this.touchEndCancelFlag = false;
    this.callbacks.onResume.forEach(callback => {
      try {
        callback();
      } catch (error) {
        console.error('onResume callback error:', error);
      }
    });
  }

  _triggerStop(result) {
    // 重置触摸结束取消录音标志
    this.touchEndCancelFlag = false;
    this.callbacks.onStop.forEach(callback => {
      try {
        callback(result);
      } catch (error) {
        console.error('onStop callback error:', error);
      }
    });
  }

  _triggerError(errMsg) {
    // 重置触摸结束取消录音标志
    this.touchEndCancelFlag = false;
    this.callbacks.onError.forEach(callback => {
      try {
        callback({ errMsg });
      } catch (error) {
        console.error('onError callback error:', error);
      }
    });
  }

  _triggerFrameRecorded(frameBuffer, isLastFrame = false) {
    // 重置触摸结束取消录音标志
    this.touchEndCancelFlag = false;
    this.callbacks.onFrameRecorded.forEach(callback => {
      try {
        callback({
          frameBuffer,
          isLastFrame,
        });
      } catch (error) {
        console.error('onFrameRecorded callback error:', error);
      }
    });
  }
}

// 全局实例
let recorderManagerInstance = null;

// 主函数：获取录音管理器
function getRecorderManager() {
  if (isH5Platform()) {
    // H5平台使用自定义实现
    if (!recorderManagerInstance) {
      recorderManagerInstance = new H5RecorderManager();
    }
    return recorderManagerInstance;
  } else {
    // 非H5平台直接使用uni.getRecorderManager
    return uni.getRecorderManager();
  }
}

// 导出
export default {
  getRecorderManager,
};
