/**
 * Nuwax Stream PCM Player（App-Harmony）—— HarmonyOS AudioRenderer 流式 PCM16 播放桥。
 *
 * 与 iOS 的 StreamPcmPlayerBridge.swift 定位一致：uts 依赖 ets（index.uts import 本类），
 * ets 不引用 uts（DCloud 官方鸿蒙混编约束）。
 *
 * 模型：主线程**单异步写循环** `await renderer.write(ab)` —— write 的 Promise 自带背压
 * （内部缓冲满时 resolve 延后），天然避免 ArkTS 跨线程队列同步问题；push 只入队，
 * 写循环顺序消费。为减少开局 underrun，攒够 START_PLAY_MS 起始缓冲才 start()。
 *
 * 接口与 app-android / app-ios 完全一致（initPlayer/push/flushPending/ensurePlaying/
 * playNow/setMuted/getWrittenMs/getEnqueuedMs/getPlayedMs/isDrained/hasPendingAudio/releasePlayer）。
 */

import { audio } from '@kit.AudioKit'

/** 开始播放前的最小缓冲（音频 ms）：略攒一点再播，减少开局 underrun（对齐 Android START_PLAY_MS） */
const START_PLAY_MS = 150
/**
 * 队列积压字节上限（约 60s 音频 @16kHz mono16 = 1.92MB）。
 * 生产（WS 投递）快于播放实时速度时队列会积压，超上限丢弃本帧（背压），保证不崩。
 * 鸿蒙侧 ArrayBuffer 为紧凑表示（1x 内存），上限主要为防积压本身失控。
 */
const MAX_QUEUED_BYTES = 1920000
/** renderer 内部缓冲时长估计（ms）：getBufferSize() 读取失败时的回退值 */
const FALLBACK_TAIL_MS = 200
/** 写循环空队列 / 未就绪时的轮询间隔（ms） */
const IDLE_POLL_MS = 20
/** 写失败 / 0 字节写入后的重试间隔（ms），避免忙等 */
const RETRY_POLL_MS = 10

export class StreamPcmPlayerBridge {
  private renderer: audio.AudioRenderer | null = null
  private sampleRate: number = 16000
  /** 已成功写入 renderer 的字节数 */
  private writtenBytes: number = 0
  /** 已入队（含队列积压）的字节数；排空判定用 */
  private enqueuedBytes: number = 0
  /** 当前在队（未写完）的字节数：背压上限判定用 */
  private queuedBytes: number = 0
  /** 因队列超上限被丢弃的字节数（正常播放应为 0，>0 说明生产远快于播放） */
  private droppedBytes: number = 0
  /** renderer 内部缓冲时长估计（ms）：最后一次 write 后需这么久才被硬件消费完 */
  private tailMs: number = FALLBACK_TAIL_MS
  private running: boolean = false
  private started: boolean = false
  /** 写循环是否在跑（幂等 kickDrain 用） */
  private draining: boolean = false
  /** playNow 强制开播标记：输入结束短音频不足起始缓冲也立即 start */
  private forceStart: boolean = false
  /** 代次令牌：initPlayer 自增，写循环/异步回调校验，防止旧实例的异步流程串代 */
  private gen: number = 0
  private lastWriteMs: number = 0
  /** 待写队列（ArrayBuffer，紧凑表示；push 追加、写循环顺序消费） */
  private queue: Array<ArrayBuffer> = []

  initPlayer(sampleRate: number): void {
    // 重置旧状态（含异步创建中/写循环中的旧实例，gen 令牌隔离）
    this.releasePlayer()
    this.gen += 1
    const g = this.gen
    this.sampleRate = sampleRate > 0 ? sampleRate : 16000
    this.writtenBytes = 0
    this.enqueuedBytes = 0
    this.queuedBytes = 0
    this.droppedBytes = 0
    this.tailMs = FALLBACK_TAIL_MS
    this.started = false
    this.draining = false
    this.forceStart = false
    this.lastWriteMs = 0
    this.queue = []
    this.running = true
    this.initRenderer(g)
  }

  /** 异步创建 AudioRenderer（createAudioRenderer 为 Promise）；失败仅告警，无音频时上层看门狗兜底 */
  private async initRenderer(g: number): Promise<void> {
    try {
      const opts: audio.AudioRendererOptions = {
        streamInfo: {
          // 16kHz 用枚举（兼容低 API）；其他采样率回退 number（API 26+ 支持）
          samplingRate: this.sampleRate === 16000
            ? audio.AudioSamplingRate.SAMPLE_RATE_16000
            : this.sampleRate,
          channels: audio.AudioChannel.CHANNEL_1,
          sampleFormat: audio.AudioSampleFormat.SAMPLE_FORMAT_S16LE,
          encodingType: audio.AudioEncodingType.ENCODING_TYPE_RAW,
        },
        rendererInfo: {
          // STREAM_USAGE_MUSIC：纯播报无需任何权限；rendererFlags 0=普通渲染器（低时延 ArkTS 不支持）
          usage: audio.StreamUsage.STREAM_USAGE_MUSIC,
          rendererFlags: 0,
        },
      }
      const renderer: audio.AudioRenderer = await audio.createAudioRenderer(opts)
      if (!this.running || g != this.gen) {
        // initPlayer 已被新的初始化/释放覆盖：立即释放刚创建的 renderer
        renderer.release().catch(() => {
          // ignore
        })
        return
      }
      this.renderer = renderer
      // 内部缓冲时长估计：getBufferSize 返回字节数 → ms，夹取到 [50,500]。
      // 保守取大（宁可 drain 稍晚也不掐尾音）；读取失败回退常量。
      try {
        const bufBytes: number = await renderer.getBufferSize()
        if (bufBytes > 0 && this.sampleRate > 0) {
          let ms = Math.ceil((bufBytes * 1000) / (this.sampleRate * 2))
          if (ms < 50) {
            ms = 50
          }
          if (ms > 500) {
            ms = 500
          }
          this.tailMs = ms
        }
      } catch (eBuf) {
        this.tailMs = FALLBACK_TAIL_MS
      }
      // 有数据在排队时立即接续播放
      this.kickDrain()
    } catch (eInit) {
      console.error('[StreamPcmPlayerBridge] createAudioRenderer failed', eInit)
      this.running = false
    }
  }

  /** 推入一帧 PCM16 LE 字节（Uint8Array 直传；转精确尺寸 ArrayBuffer 交给 renderer.write） */
  push(chunk: Uint8Array): void {
    if (!this.running || chunk == null || chunk.byteLength == 0) {
      return
    }
    const len = chunk.byteLength
    // 背压：在队字节超上限时丢弃本帧（对齐 Android/iOS；正常播放不会触发）
    if (this.queuedBytes + len > MAX_QUEUED_BYTES) {
      this.droppedBytes += len
      return
    }
    let ab: ArrayBuffer
    const srcBuffer = chunk.buffer
    // ArkTS 下 Uint8Array.buffer 类型为 ArrayBufferLike，需 instanceof 缩窄后才能赋给 ArrayBuffer
    if (srcBuffer instanceof ArrayBuffer && chunk.byteOffset == 0 && srcBuffer.byteLength == len) {
      ab = srcBuffer
    } else {
      ab = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + len)
    }
    this.queue.push(ab)
    this.queuedBytes += len
    this.enqueuedBytes += len
    this.kickDrain()
  }

  /** 冲刷积压：写循环持续消费，无需额外冲刷 */
  flushPending(): void {
    // no-op
  }

  /** 攒够起始缓冲后开始播放（幂等；写循环内按 START_PLAY_MS 自动 start） */
  ensurePlaying(): void {
    this.kickDrain()
  }

  /** 立即开始播放（幂等；输入结束时强制用，短音频不足起始缓冲也开播） */
  playNow(): void {
    this.forceStart = true
    this.kickDrain()
  }

  /** 静音开关：音量 0 / 1 */
  setMuted(muted: boolean): void {
    const renderer = this.renderer
    if (renderer == null) {
      return
    }
    renderer.setVolume(muted ? 0 : 1).catch((e: Error) => {
      console.warn('[StreamPcmPlayerBridge] setVolume failed', e)
    })
  }

  /** 已写入 renderer 的 PCM 时长（ms） */
  getWrittenMs(): number {
    return Math.floor((this.writtenBytes * 1000) / (this.sampleRate * 2))
  }

  /** 已入队（含队列积压）的 PCM 总时长（ms）；排空兜底 deadline 用 */
  getEnqueuedMs(): number {
    return Math.floor((this.enqueuedBytes * 1000) / (this.sampleRate * 2))
  }

  /** 已播放的 PCM 时长（ms）≈ 已写入 − renderer 内部缓冲 tail（尚未被硬件消费的部分） */
  getPlayedMs(): number {
    let played = this.getWrittenMs() - this.tailMs
    if (played < 0) {
      played = 0
    }
    return played
  }

  /**
   * 写入的音频是否已全部播完（排空判定用）。
   * ttsWebSocketPlayer.checkNativeDrain 只在输入结束后查询，中途空档不会误判；
   * 判定：队列空 && 已写 >0 && 距最后一次 write ≥ tail+容差（renderer 内部缓冲已冲刷到硬件）。
   */
  isDrained(): boolean {
    if (this.writtenBytes <= 0 || this.queuedBytes > 0) {
      return false
    }
    const since = Date.now() - this.lastWriteMs
    return since >= this.tailMs + 50
  }

  /** 是否仍有未排空的音频（含队列积压） */
  hasPendingAudio(): boolean {
    return !this.isDrained()
  }

  /** 停止写循环并释放 AudioRenderer（幂等；异步释放失败仅告警） */
  releasePlayer(): void {
    // 诊断：释放时的终态（dropped/written/played，判断是否提前排空/背压丢帧）
    console.log(
      '[StreamPcmPlayerBridge] release droppedBytes=' + this.droppedBytes +
        ' enqueuedMs=' + this.getEnqueuedMs() +
        ' writtenMs=' + this.getWrittenMs() +
        ' playedMs=' + this.getPlayedMs(),
    )
    this.running = false
    this.queue = []
    this.queuedBytes = 0
    const renderer = this.renderer
    this.renderer = null
    if (renderer != null) {
      renderer.stop().catch((e: Error) => {
        console.warn('[StreamPcmPlayerBridge] stop failed', e)
      })
      // release 不可逆，可在任意状态调用；stop 未完成时调用由框架兜底
      renderer.release().catch((e: Error) => {
        console.warn('[StreamPcmPlayerBridge] release failed', e)
      })
    }
  }

  /** 幂等拉起写循环（单异步任务；循环结束后 draining 复位） */
  private kickDrain(): void {
    if (this.draining) {
      return
    }
    this.draining = true
    const g = this.gen
    this.drainLoop(g)
  }

  /** 单异步写循环：顺序 `await renderer.write(ab)`，write 的 Promise 自带背压 */
  private async drainLoop(g: number): Promise<void> {
    try {
      while (this.running && g == this.gen) {
        const renderer = this.renderer
        if (renderer == null) {
          // renderer 尚未创建完成（异步 initRenderer 在跑）
          await this.sleepMs(IDLE_POLL_MS)
          continue
        }
        if (!this.started) {
          const threshold = (START_PLAY_MS * this.sampleRate * 2) / 1000
          if (!this.forceStart && this.queuedBytes < threshold) {
            await this.sleepMs(IDLE_POLL_MS)
            continue
          }
          await this.startRenderer(renderer)
          if (!this.started) {
            await this.sleepMs(IDLE_POLL_MS)
            continue
          }
        }
        if (this.queue.length == 0) {
          await this.sleepMs(IDLE_POLL_MS)
          continue
        }
        const ab: ArrayBuffer | undefined = this.queue.shift()
        if (ab == null || ab.byteLength == 0) {
          continue
        }
        const totalLen = ab.byteLength
        let written = 0
        try {
          // write() 自 API 11 起废弃（官方推荐 on('writeData') 拉取模式）。仍保留 push 模式：
          // writeData 回调运行在系统线程且不能 async，跨线程访问队列有损坏风险；write() 的
          // Promise 自带背压且全部在主线程，与 Android/iOS 的 push 架构一致。废弃≠移除，
          // API 12+ 仍可用；若未来 SDK 移除再迁移 writeData。
          written = await renderer.write(ab)
        } catch (eWrite) {
          console.warn('[StreamPcmPlayerBridge] write failed', eWrite)
          if (this.running) {
            // 写失败：退回队列首，避免丢帧，稍候重试
            this.queue.unshift(ab)
            await this.sleepMs(RETRY_POLL_MS)
          }
          continue
        }
        if (written >= totalLen) {
          this.queuedBytes -= totalLen
          this.writtenBytes += totalLen
          this.lastWriteMs = Date.now()
        } else if (written > 0) {
          // 部分写入：剩余字节偏移续写（不再整帧重写）
          const remain = ab.slice(written, totalLen)
          this.queuedBytes -= written
          this.writtenBytes += written
          this.lastWriteMs = Date.now()
          this.queue.unshift(remain)
        } else {
          // 0 字节：缓冲满，整帧留待重试，稍候再写避免忙等
          this.queue.unshift(ab)
          await this.sleepMs(RETRY_POLL_MS)
        }
      }
    } finally {
      // 仅当前代次的循环可复位 draining（防止旧实例 cleared 新实例的标记）
      if (g == this.gen) {
        this.draining = false
      }
    }
  }

  /** 幂等 start() */
  private async startRenderer(renderer: audio.AudioRenderer): Promise<void> {
    if (this.started) {
      return
    }
    try {
      await renderer.start()
      this.started = true
    } catch (eStart) {
      console.error('[StreamPcmPlayerBridge] start failed', eStart)
      this.started = false
    }
  }

  private sleepMs(ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      setTimeout((): void => {
        resolve()
      }, ms)
    })
  }
}
