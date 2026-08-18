/**
 * Nuwax Stream PCM Player（App-Harmony）—— HarmonyOS AudioRenderer 流式 PCM16 播放桥。
 *
 * 与 iOS 的 StreamPcmPlayerBridge.swift 定位一致：uts 依赖 ets（index.uts import 本类），
 * ets 不引用 uts（DCloud 官方鸿蒙混编约束）。
 *
 * 模型：**writeData 拉取模式**（官方推荐，API 12+）。系统在需要数据时回调 on('writeData')，
 * 回调在系统音频线程执行：同步把队首帧拷入系统提供的 ArrayBuffer 并返回 VALID/INVALID，
 * 绝不 async / 不回调 JS（对齐同目录 StreamPcmRecorderBridge 的 readData 处理模式）。
 *
 * 为什么不用 write() push 模式：write() 自 API 11 起废弃（官方 @useinstead 指向 writeData），
 * 实测部分鸿蒙版本在 HAL 停止消费时 write() 的 Promise 会永久挂起不结算（>5s），把整条
 * 写循环堵死、音频中断（日志特征：write hung > 5000ms + 队列积压数秒）。拉取模式下系统
 * 按实时速率索取，不存在 push 侧阻塞；渲染器停消费时队列只增不消，由主线程 drainLoop
 * 轮询「已 start 但 5s 无拉取」判停滞并放弃，避免静默挂死。
 *
 * 数据流：push() 主线程入队（拷贝独立 ArrayBuffer）→ 系统 writeData 拉取消费，队列积压
 * 即自然背压。尾部不足一段时静音补零填满，保证尾音不丢。音频焦点中断（PAUSE/STOP/MUTE）
 * 期间暂停停滞判定，恢复后继续播。
 *
 * 接口与 app-android / app-ios 完全一致（initPlayer/push/flushPending/ensurePlaying/
 * playNow/setMuted/getWrittenMs/getEnqueuedMs/getPlayedMs/isDrained/hasPendingAudio/releasePlayer）。
 */

import { audio } from '@kit.AudioKit'

/** 开始播放前的最小缓冲（音频 ms）：略攒一点再播，减少开局 underrun（对齐 Android START_PLAY_MS）。
 *  鸿蒙模拟器 writeData HAL 启动延迟大，150ms 一次填充即耗尽、等下批音频时空转补零造成开局卡顿；
 *  调大到 1000ms 给 HAL 更多开局余量（真机可按需调回）。 */
const START_PLAY_MS = 1000
/**
 * 队列积压字节上限（约 10 分钟音频 @16kHz mono16 = 19.2MB，对齐 Android）。
 * 生产（WS 投递）快于播放实时速度时队列会积压，超上限丢弃本帧（背压），保证不崩。
 */
const MAX_QUEUED_BYTES = 19200000
/** renderer 内部缓冲时长估计（ms）：getBufferSize() 读取失败时的回退值 */
const FALLBACK_TAIL_MS = 200
/** 主线程轮询间隔（ms）：renderer 创建等待 / 起始缓冲等待 / 停滞检测 */
const IDLE_POLL_MS = 20
/**
 * 停滞判定窗口（ms）：start 后队列有积压但超过该时长未发生任何 writeData 拉取，
 * 说明 HAL 停止消费（渲染器挂死）——清队让上层 isDrained 收尾。
 * 音频焦点中断（audioInterrupt PAUSE/STOP/MUTE）期间不计时：暂停是外部原因，
 * 恢复后应继续播而非判死。
 */
const WRITE_STALL_MS = 5000
/** 无有效拉取恢复窗口（ms）：start 后该时长内 writeData 无任何有效填充（writtenBytes==0）
 *  → 重建渲染器恢复（模拟器 writeData HAL 偶发不回调 writeData，重建可救回声音） */
const NO_FILL_RECOVER_MS = 3000
/** 渲染器重建次数上限：超限仍无音频则交给停滞清队收尾（防无限重建刷屏） */
const MAX_RENDERER_RECOVERS = 2

export class StreamPcmPlayerBridge {
  private renderer: audio.AudioRenderer | null = null
  private sampleRate: number = 16000
  /** 已交给 renderer（写入 writeData 缓冲，含补零尾段）的字节数 */
  private writtenBytes: number = 0
  /** 已入队（含队列积压）的字节数；排空判定用 */
  private enqueuedBytes: number = 0
  /** 当前在队（未交给 renderer）的字节数：背压上限判定用 */
  private queuedBytes: number = 0
  /** 因队列超上限被丢弃的字节数（正常播放应为 0，>0 说明生产远快于播放） */
  private droppedBytes: number = 0
  /** renderer 内部缓冲时长估计（ms）：最后一次有效拉取后需这么久才被硬件消费完 */
  private tailMs: number = FALLBACK_TAIL_MS
  private running: boolean = false
  private started: boolean = false
  /** 写循环是否在跑（幂等 kickDrain 用） */
  private draining: boolean = false
  /** playNow 强制开播标记：输入结束短音频不足起始缓冲也立即 start */
  private forceStart: boolean = false
  /** 代次令牌：initPlayer 自增，回调/写循环/中断事件校验，防止旧实例异步流程串代 */
  private gen: number = 0
  /** 最后一次有效 writeData 填充的时刻（停滞判定基准） */
  private lastFillMs: number = 0
  /** 停滞诊断日志已打标记（防刷屏） */
  private stallLogged: boolean = false
  /** 音频焦点中断中（PAUSE/STOP/MUTE）：暂停停滞计时，恢复后继续 */
  private interrupted: boolean = false
  /** 连续 INVALID 返回次数（诊断：无数据空等） */
  private invalidCount: number = 0
  /** 首次有效拉取诊断已打标记（确认 writeData 拉取开始） */
  private firstFillLogged: boolean = false
  /** 渲染器序号：每次创建自增，writeData 回调校验（重建后旧回调不得再消费队列） */
  private rendererSeq: number = 0
  /** 无有效拉取计时起点（0=未计时）；start 后无任何填充超 NO_FILL_RECOVER_MS 触发重建 */
  private noFillSinceMs: number = 0
  /** 渲染器重建次数（initPlayer 重置） */
  private recoverCount: number = 0
  /** 待写队列（ArrayBuffer，紧凑表示；push 追加、writeData 回调消费） */
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
    this.lastFillMs = 0
    this.stallLogged = false
    this.interrupted = false
    this.invalidCount = 0
    this.firstFillLogged = false
    this.rendererSeq = 0
    this.noFillSinceMs = 0
    this.recoverCount = 0
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
      console.log(
        '[StreamPcmPlayerBridge] renderer created sampleRate=' +
          this.sampleRate +
          ' gen=' + g,
      )
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
      // writeData 拉取回调：系统音频线程同步执行（对齐 recorder 的 readData 模式），
      // 只做队首拷贝与字节计数，不 async、不回调 JS。rg 代次令牌防旧 renderer 串代：
      // 新 initPlayer 后旧实例的回调一律返回 INVALID，不再消费新代次队列。
      // rSeq 渲染器序号：重建渲染器（recoverRenderer，同 gen）后旧实例回调也失效。
      this.rendererSeq += 1
      const rg = g
      const rSeq = this.rendererSeq
      renderer.on('writeData', (data: ArrayBuffer): audio.AudioDataCallbackResult => {
        if (
          rSeq != this.rendererSeq ||
          rg != this.gen ||
          !this.running ||
          !this.started
        ) {
          return audio.AudioDataCallbackResult.INVALID
        }
        return this.fillWriteData(data)
      })
      // 音频焦点中断：PAUSE/STOP/MUTE 期间暂停停滞判定（外部暂停不是渲染器挂死）；
      // 恢复（RESUME/UNDUCK/UNMUTE）后校准停滞时钟，继续播。仅诊断与计时，不阻塞拉取。
      renderer.on('audioInterrupt', (interrupt: audio.InterruptEvent): void => {
        this.handleInterrupt(rg, interrupt)
      })
      // 有数据在排队时立即接续播放
      this.kickDrain()
    } catch (eInit) {
      console.error('[StreamPcmPlayerBridge] createAudioRenderer failed', eInit)
      this.running = false
    }
  }

  /**
   * writeData 回调体（系统音频线程）：把队首帧拷贝进系统提供的缓冲。
   * - 整帧拷贝；跨帧部分拷贝后剩余部分重新切片留队首；
   * - 尾部不足一段时静音补零填满（官方推荐，避免脏数据/杂音并保证尾音播完）；
   * - 队空返回 INVALID（系统丢弃本段并再次请求，即自然背压）。
   */
  private fillWriteData(data: ArrayBuffer): audio.AudioDataCallbackResult {
    const cap = data.byteLength
    if (cap == 0) {
      return audio.AudioDataCallbackResult.INVALID
    }
    const out = new Uint8Array(data)
    let filled = 0
    while (filled < cap && this.queue.length > 0) {
      const head = this.queue[0]
      if (head == null || head.byteLength == 0) {
        this.queue.shift()
        continue
      }
      const headLen = head.byteLength
      const need = cap - filled
      if (headLen <= need) {
        out.set(new Uint8Array(head), filled)
        filled += headLen
        this.queuedBytes -= headLen
        this.queue.shift()
      } else {
        // 跨帧部分拷贝：已拷部分计入，剩余留队首（slice 复制一份，避免共享底层缓冲）
        out.set(new Uint8Array(head.slice(0, need)), filled)
        filled = need
        this.queuedBytes -= need
        this.queue[0] = head.slice(need)
      }
    }
    if (filled == 0) {
      this.invalidCount += 1
      // 队列空：返回 VALID + 静音补零，而非 INVALID。
      // 实测模拟器上 INVALID 会让系统以 ~100/s 忙轮询（空转 CPU + HAL 退化，逐次播放更卡，
      // 日志表现为 writtenMs 冻结 + invalidCount 每 200ms +20）；补零填满后系统按实时
      // 节奏消费静音，数据到达立即续播。静音不计入 writtenBytes（排空判定仍以真实音频为准），
      // 但刷新 lastFillMs（是有效系统交互，避免停滞误判）。补零尾段语义与部分填充一致。
      if (this.invalidCount <= 3) {
        console.warn(
          '[StreamPcmPlayerBridge] writeData empty queue -> silence fill count=' +
            this.invalidCount +
            ' queuedMs=' +
            Math.floor((this.queuedBytes * 1000) / (this.sampleRate * 2)) +
            ' enqueuedMs=' +
            Math.floor((this.enqueuedBytes * 1000) / (this.sampleRate * 2)),
        )
      }
      out.fill(0)
      this.lastFillMs = Date.now()
      this.noFillSinceMs = 0
      return audio.AudioDataCallbackResult.VALID
    }
    if (filled < cap) {
      // 尾部不足一段：静音补零填满（官方推荐，避免历史脏数据造成杂音）
      out.fill(0, filled)
    }
    this.writtenBytes += cap
    this.lastFillMs = Date.now()
    this.noFillSinceMs = 0
    this.invalidCount = 0
    if (!this.firstFillLogged) {
      this.firstFillLogged = true
      console.log(
        '[StreamPcmPlayerBridge] first writeData fill cap=' +
          cap +
          ' queuedBytes=' +
          this.queuedBytes,
      )
    }
    return audio.AudioDataCallbackResult.VALID
  }

  /** 推入一帧 PCM16 LE 字节（拷贝成独立 ArrayBuffer 入队，绝不复用接收缓冲——对齐 Android 逐帧拷贝） */
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
    // slice 返回精确尺寸的新 ArrayBuffer；若直传 chunk.buffer（零拷贝快路径），
    // 底层缓冲被 WS 接收层复用/覆盖时会污染已入队帧，导致播放出杂音或静音
    const ab: ArrayBuffer = chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + len)
    this.queue.push(ab)
    this.queuedBytes += len
    this.enqueuedBytes += len
    this.kickDrain()
  }

  /** 冲刷积压：writeData 拉取持续消费，无需额外冲刷 */
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

  /** 已交给 renderer 的 PCM 时长（ms；含补零尾段，可能略大于实际音频时长） */
  getWrittenMs(): number {
    return Math.floor((this.writtenBytes * 1000) / (this.sampleRate * 2))
  }

  /** 已入队（含队列积压）的 PCM 总时长（ms）；排空兜底 deadline 用 */
  getEnqueuedMs(): number {
    return Math.floor((this.enqueuedBytes * 1000) / (this.sampleRate * 2))
  }

  /** 已播放的 PCM 时长（ms）≈ 已交给 renderer − renderer 内部缓冲 tail（尚未被硬件消费的部分） */
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
   * 判定：队列空 && 已写 >0 && 距最后一次有效拉取 ≥ tail+容差（renderer 内部缓冲已冲刷到硬件）。
   */
  isDrained(): boolean {
    if (this.writtenBytes <= 0 || this.queuedBytes > 0) {
      return false
    }
    const since = Date.now() - this.lastFillMs
    return since >= this.tailMs + 50
  }

  /** 是否仍有未排空的音频（含队列积压） */
  hasPendingAudio(): boolean {
    return !this.isDrained()
  }

  /** 停止拉取并释放 AudioRenderer（幂等；异步释放失败仅告警） */
  releasePlayer(): void {
    // 诊断：释放时的终态（dropped/written/played/invalid，判断是否提前排空/背压丢帧/空转）
    console.log(
      '[StreamPcmPlayerBridge] release droppedBytes=' + this.droppedBytes +
        ' invalidCount=' + this.invalidCount +
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
      // 不调 renderer.off('writeData')：实测模拟器上 off 会导致 libaudio 内 NULL 解引用
      // SIGSEGV（2026-08-18 cppcrash）。回调有 gen/running 守卫，release 后自然不会再进
      // fillWriteData，无需显式摘除。stop/release 幂等，异步失败仅告警。
      renderer.stop().catch((e: Error) => {
        console.warn('[StreamPcmPlayerBridge] stop failed', e)
      })
      // release 不可逆，可在任意状态调用；stop 未完成时调用由框架兜底
      renderer.release().catch((e: Error) => {
        console.warn('[StreamPcmPlayerBridge] release failed', e)
      })
    }
  }

  /**
   * 音频焦点中断事件（系统音频线程回调）：维护 interrupted 标志。
   * 暂停/停止/静音类中断置位 → drainLoop 暂停停滞判定（外部暂停不是渲染器挂死）；
   * 恢复类中断复位并校准停滞时钟。DUCK（音量降低）不置位——播放继续，正常拉取。
   */
  private handleInterrupt(rg: number, interrupt: audio.InterruptEvent): void {
    if (rg != this.gen) {
      return
    }
    const hint = interrupt.hintType
    console.warn(
      '[StreamPcmPlayerBridge] audioInterrupt event=' + interrupt.eventType +
        ' hint=' + hint +
        ' force=' + interrupt.forceType,
    )
    if (hint == audio.InterruptHint.INTERRUPT_HINT_PAUSE ||
        hint == audio.InterruptHint.INTERRUPT_HINT_STOP ||
        hint == audio.InterruptHint.INTERRUPT_HINT_MUTE) {
      this.interrupted = true
    } else if (hint == audio.InterruptHint.INTERRUPT_HINT_RESUME ||
               hint == audio.InterruptHint.INTERRUPT_HINT_UNDUCK ||
               hint == audio.InterruptHint.INTERRUPT_HINT_UNMUTE ||
               hint == audio.InterruptHint.INTERRUPT_HINT_NONE) {
      this.interrupted = false
      // 恢复：校准停滞时钟，避免把中断期误判为停滞
      this.lastFillMs = Date.now()
    }
  }

  /**
   * 重建渲染器恢复声音（保留队列）：start 后无有效拉取 / 渲染器挂起时先重建而非
   * 直接清队收尾。模拟器 writeData HAL 偶发不回调或停拉，重建（同 gen、同队列）
   * 可能恢复；达上限仍无音频则交给 giveUpOnStall 收尾。rendererSeq 自增使旧渲染器
   * 的 writeData 回调立即失效（不双消费队列）。
   */
  private async recoverRenderer(reason: string): Promise<void> {
    if (this.recoverCount >= MAX_RENDERER_RECOVERS) {
      console.error(
        '[StreamPcmPlayerBridge] no-audio after ' +
          this.recoverCount +
          ' renderer recovers, give up',
      )
      this.giveUpOnStall('no audio after renderer recovers')
      return
    }
    this.recoverCount += 1
    console.warn(
      '[StreamPcmPlayerBridge] recreating renderer: ' +
        reason +
        ' (recover=' +
        this.recoverCount +
        ')',
    )
    const old = this.renderer
    this.renderer = null
    this.started = false
    this.lastFillMs = 0
    this.firstFillLogged = false
    this.noFillSinceMs = 0
    if (old != null) {
      old.stop().catch((e: Error) => {
        console.warn('[StreamPcmPlayerBridge] stop old renderer failed', e)
      })
      old.release().catch((e: Error) => {
        console.warn('[StreamPcmPlayerBridge] release old renderer failed', e)
      })
    }
    await this.initRenderer(this.gen)
  }

  /**
   * 渲染器停滞处理：清空积压并停止写循环，让上层 isDrained 判定结束（release 由上层触发）。
   * 仅停滞场景调用，正常播放不经过。
   */
  private giveUpOnStall(reason: string): void {
    if (!this.stallLogged) {
      console.error(
        '[StreamPcmPlayerBridge] renderer stalled: ' +
          reason +
          ', give up queue (' +
          this.queuedBytes +
          'B) to let drain conclude',
      )
      this.stallLogged = true
    }
    this.queue = []
    this.queuedBytes = 0
    this.running = false
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

  /**
   * 主线程管理循环：等待 renderer 创建 → 攒够起始缓冲（或 playNow）→ start()。
   * start 之后音频消费完全由系统 writeData 拉取驱动；本循环只做停滞轮询
   * （start 后队列有积压却长时间无拉取 = HAL 停消费，判停滞清队收尾）。
   */
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
          // start 成功：停滞时钟从此刻起算（首个 writeData 应很快到达）
          this.lastFillMs = Date.now()
          continue
        }
        // 已 start：系统按实时速率拉取。无有效拉取/停拉先重建渲染器恢复（模拟器 HAL
        // 偶发不回调或挂起，重建同 gen 同队列可救回声音），失败才清队收尾。
        if (!this.interrupted) {
          // 无任何有效填充（writtenBytes==0 且队列非空）：HAL 不回调 writeData → 重建恢复。
          // 队列空（written==0 && queued==0）时是服务端音频未到、渲染器空闲，不误重建。
          if (this.writtenBytes <= 0 && this.queuedBytes > 0) {
            if (this.noFillSinceMs == 0) {
              this.noFillSinceMs = Date.now()
            } else if (Date.now() - this.noFillSinceMs >= NO_FILL_RECOVER_MS) {
              this.noFillSinceMs = 0
              this.recoverRenderer(
                'no writeData fill for ' + NO_FILL_RECOVER_MS + 'ms',
              )
              continue
            }
          } else {
            this.noFillSinceMs = 0
          }
          // 队列有积压却长时间无拉取 → HAL 停消费：先重建，超限再清队收尾
          if (this.queuedBytes > 0) {
            const since = Date.now() - this.lastFillMs
            if (since > WRITE_STALL_MS) {
              if (this.recoverCount < MAX_RENDERER_RECOVERS) {
                this.recoverRenderer(
                  'no pull for > ' + WRITE_STALL_MS + 'ms',
                )
                continue
              }
              this.giveUpOnStall(
                'no pull for > ' + WRITE_STALL_MS + 'ms',
              )
            }
          }
        }
        await this.sleepMs(IDLE_POLL_MS)
      }
    } finally {
      // 仅当前代次的循环可复位 draining（防止旧实例 cleared 新实例的标记）
      if (g == this.gen) {
        this.draining = false
      }
    }
  }

  /**
   * 幂等 start()。带 WRITE_STALL_MS 超时：模拟器上 renderer.start() 可能挂起不结算
   * （HAL 故障，症状与旧 write() 挂起同类），超时判停滞收尾，避免无声静默挂住。
   */
  private async startRenderer(renderer: audio.AudioRenderer): Promise<void> {
    if (this.started) {
      return
    }
    try {
      let startDone = false
      const startP: Promise<void> = renderer.start().then((): void => {
        startDone = true
      })
      await Promise.race([startP, this.sleepMs(WRITE_STALL_MS)])
      if (!startDone) {
        console.error(
          '[StreamPcmPlayerBridge] renderer start hung > ' +
            WRITE_STALL_MS +
            'ms',
        )
        this.giveUpOnStall('start hung > ' + WRITE_STALL_MS + 'ms')
        return
      }
      this.started = true
      console.log('[StreamPcmPlayerBridge] renderer started')
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
