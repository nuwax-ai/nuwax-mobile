/**
 * Nuwax Stream PCM Recorder（App-Harmony）—— HarmonyOS AudioCapturer 原生录音桥。
 *
 * 与 StreamPcmPlayerBridge.ets 定位一致：uts 依赖 ets（index.uts import 本类），
 * ets 不引用 uts（DCloud 官方鸿蒙混编约束）。
 *
 * 模型：AudioCapturer 采 16kHz mono PCM16（S16LE）→ on('readData') 回调拿 ArrayBuffer
 * → 同步写临时 .pcm 文件；stop 后回传文件路径，由上层走与 Android/iOS
 * RecorderManager format:'pcm' 完全一致的「读文件 → 流式 ASR 推流」链路。
 *
 * 生命周期：start →（异步创建 capturer）→ onStart → 持续写文件 → stop/release。
 * 幂等与代次：gen 令牌隔离异步创建流程，防止旧实例的异步回调串代（对齐 PlayerBridge）。
 * readData 回调运行在系统线程：只做文件写入与字节计数，不回调 JS；
 * onStart/onStop/onError 均在主线程触发（initCapturer 的 await 续体 / setTimeout 跳主线程）。
 */

import { audio } from '@kit.AudioKit'
import { fileIo as fs } from '@kit.CoreFileKit'

export class StreamPcmRecorderBridge {
  private capturer: audio.AudioCapturer | null = null
  private file: fs.File | null = null
  private filePath: string = ''
  private sampleRate: number = 16000
  /** 代次令牌：start/stop 自增，异步回调校验，防止旧实例的异步流程串代 */
  private gen: number = 0
  /** 本轮录音进行中（start 后、stop/release 前） */
  private running: boolean = false
  /** capturer.start() 成功且文件已就绪（onStart 已发）——stop 只在真正开录后回传 onStop */
  private started: boolean = false
  /** 已写入文件字节数（stop 后随 onStop 回传，供上层算时长/大小） */
  private recordedBytes: number = 0
  /** 录制时长自动停止定时器（对齐 RecorderManager duration 语义） */
  private durationTimer: number = 0

  private onStartCb: (() => void) | null = null
  private onStopCb: ((filePath: string, byteLength: number) => void) | null = null
  private onErrorCb: ((message: string) => void) | null = null

  isRecording(): boolean {
    return this.running
  }

  setOnStart(callback: (() => void) | null): void {
    this.onStartCb = callback
  }

  setOnStop(callback: ((filePath: string, byteLength: number) => void) | null): void {
    this.onStopCb = callback
  }

  setOnError(callback: ((message: string) => void) | null): void {
    this.onErrorCb = callback
  }

  /**
   * 开始录音：清旧状态 → 异步创建 AudioCapturer（16kHz mono PCM16）→ 写 filePath。
   * filePath 为绝对沙箱路径；durationMs 毫秒后自动停止（0 = 不限时长）。
   */
  start(filePath: string, durationMs: number): void {
    this.stopInternal(false)
    this.gen += 1
    const g = this.gen
    this.filePath = filePath
    this.running = true
    this.started = false
    this.recordedBytes = 0
    this.clearDurationTimer()
    this.initCapturer(g, durationMs)
  }

  private async initCapturer(g: number, durationMs: number): Promise<void> {
    try {
      const opts: audio.AudioCapturerOptions = {
        streamInfo: {
          // 16kHz 用枚举（兼容低 API）；其他采样率回退 number（与 PlayerBridge 一致）
          samplingRate: this.sampleRate === 16000
            ? audio.AudioSamplingRate.SAMPLE_RATE_16000
            : this.sampleRate,
          channels: audio.AudioChannel.CHANNEL_1,
          sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
          encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW,
        },
        capturerInfo: {
          // SOURCE_TYPE_MIC：普通麦克风采录；capturerFlags 0 = 默认
          source: audio.SourceType.SOURCE_TYPE_MIC,
          capturerFlags: 0,
        },
      }
      const capturer: audio.AudioCapturer = await audio.createAudioCapturer(opts)
      if (!this.running || g != this.gen) {
        // 已被新的 start/stop 覆盖：立即释放刚创建的 capturer
        capturer.release().catch(() => {
          // ignore
        })
        return
      }
      // 先挂到实例字段：await start 期间 stop() 到达时，stopInternal 能接管清理
      this.capturer = capturer
      // 先开文件再 start：避免 start 后到 onStart 之间的首段 PCM 被丢（TRUNC 覆盖旧文件）
      const file = fs.openSync(
        this.filePath,
        fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC,
      )
      this.file = file
      this.recordedBytes = 0
      capturer.on('readData', (data: ArrayBuffer) => {
        this.handleReadData(g, data)
      })
      await capturer.start()
      if (!this.running || g != this.gen) {
        // stop/release 已接管清理（stopInternal 已关文件并 release capturer）
        return
      }
      this.started = true
      const startCb = this.onStartCb
      if (startCb != null) {
        startCb()
      }
      if (durationMs > 0) {
        this.durationTimer = setTimeout((): void => {
          this.durationTimer = 0
          if (this.running) {
            this.stopInternal(true)
          }
        }, durationMs)
      }
    } catch (eInit) {
      console.error('[StreamPcmRecorderBridge] createAudioCapturer failed', eInit)
      const file = this.file
      this.file = null
      if (file != null) {
        try {
          fs.closeSync(file)
        } catch (_eClose) {
          // ignore
        }
      }
      const cap = this.capturer
      this.capturer = null
      if (cap != null) {
        cap.release().catch(() => {
          // ignore
        })
      }
      if (this.running && g == this.gen) {
        this.running = false
        this.started = false
        const errCb = this.onErrorCb
        if (errCb != null) {
          errCb('录音启动失败')
        }
      }
    }
  }

  /** readData 系统线程回调：PCM 帧同步写文件（仅文件 IO 与字节计数，不回调 JS） */
  private handleReadData(g: number, data: ArrayBuffer): void {
    if (!this.running || g != this.gen || data == null || data.byteLength == 0) {
      return
    }
    const file = this.file
    if (file == null) {
      return
    }
    try {
      fs.writeSync(file.fd, data)
      this.recordedBytes += data.byteLength
    } catch (eWrite) {
      // 写文件失败（磁盘满等）：停止本轮并回传错误路径；setTimeout 跳回主线程再回调，避免系统线程触发页面逻辑
      console.warn('[StreamPcmRecorderBridge] write pcm failed', eWrite)
      setTimeout((): void => {
        if (this.running) {
          this.stopInternal(true)
        }
      }, 0)
    }
  }

  /** 停止录音（松手）：正常收尾，回传文件路径 */
  stop(): void {
    this.stopInternal(true)
  }

  /** 释放（页面销毁 / 弃用）：不回传 onStop */
  release(): void {
    this.stopInternal(false)
  }

  private stopInternal(emitStop: boolean): void {
    if (!this.running && this.capturer == null && this.file == null) {
      return
    }
    this.gen += 1
    this.clearDurationTimer()
    this.running = false
    const wasStarted = this.started
    this.started = false
    const file = this.file
    this.file = null
    if (file != null) {
      try {
        fs.closeSync(file)
      } catch (eClose) {
        console.warn('[StreamPcmRecorderBridge] close file failed', eClose)
      }
    }
    const capturer = this.capturer
    this.capturer = null
    if (capturer != null) {
      capturer.stop().catch((e: Error) => {
        console.warn('[StreamPcmRecorderBridge] stop failed', e)
      })
      // release 不可逆，可在任意状态调用；stop 未完成时调用由框架兜底
      capturer.release().catch((e: Error) => {
        console.warn('[StreamPcmRecorderBridge] release failed', e)
      })
    }
    // 仅在真正开录后回传 onStop（stop 早于 onStart 的看门狗场景不发，避免空文件推 ASR）
    if (emitStop && wasStarted) {
      const stopCb = this.onStopCb
      if (stopCb != null) {
        stopCb(this.filePath, this.recordedBytes)
      }
    }
  }

  private clearDurationTimer(): void {
    if (this.durationTimer != 0) {
      clearTimeout(this.durationTimer)
      this.durationTimer = 0
    }
  }
}
