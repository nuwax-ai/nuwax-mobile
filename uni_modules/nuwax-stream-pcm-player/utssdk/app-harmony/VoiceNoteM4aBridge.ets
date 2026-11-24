/**
 * 伙伴页录音。鸿蒙 ArkTS 的 MediaKit 没有可用的音频编码器类（AudioEncoder 只是旧枚举），
 * 因此整段录音共用一个 AVRecorder：切段时 stop + reset 后换文件再 prepare，不 release、不新建。
 * 不走聊天页的 StreamPcmRecorder。
 */
import { media } from '@kit.MediaKit'
import { audio } from '@kit.AudioKit'
import { fileIo as fs } from '@kit.CoreFileKit'

/**
 * 读当前这次录音的振幅。方法在系统 AVRecorder 上，编译用的声明里没有，所以单独挂出来再调用。
 */
interface AmplitudeRecorder {
  getAudioCapturerMaxAmplitude(): Promise<number>
}

/** API 20 起，来电打断时改为写入静音，不把采集器停掉。必须在 prepare 之前调用。 */
interface MuteInterruptRecorder {
  setWillMuteWhenInterrupted(muteWhenInterrupted: boolean): Promise<void>
}

function amplitudeToLevel(amp: number): number {
  if (!(amp > 0)) {
    return 0
  }
  let unit = amp
  if (amp > 1) {
    unit = amp / 32767
  }
  // 正常说话的峰值大约是满幅的 15%，再高才顶到最高柱。
  unit = unit / 0.15
  if (unit > 1) {
    unit = 1
  }
  if (unit < 0) {
    unit = 0
  }
  let level = Math.round(Math.pow(unit, 0.8) * 100)
  if (level < 0) {
    level = 0
  }
  if (level > 100) {
    level = 100
  }
  return level
}

export class VoiceNoteM4aBridge {
  private recorder: media.AVRecorder | null = null
  private file: fs.File | null = null
  private currentPath: string = ''
  private fileOpen: boolean = false
  private segmentStartedAt: number = 0
  private pausedAccumMs: number = 0
  private pauseBeganAt: number = 0
  private lastClosedDurationMs: number = 0
  private selfActionUntil: number = 0
  private interruptHold: boolean = false
  private interruptBeganAt: number = 0
  private pendingEvents: string[] = []
  private inputLevel: number = 0
  private levelBusy: boolean = false
  private levelStartedAt: number = 0

  private ringResumeBusy: boolean = false
  /** 接通期间写入的静音区间，成对的起止毫秒。封口时从文件里剪掉。 */
  private silenceMarks: number[] = []
  private silenceOpen: boolean = false

  private markSelfAction(): void {
    this.selfActionUntil = Date.now() + 800
  }

  private noteRecorderState(state: media.AVRecorderState): void {
    if (Date.now() < this.selfActionUntil || !this.fileOpen) {
      return
    }
    if ((state == 'paused' || state == 'error') && !this.interruptHold) {
      if (!this.callConnected()) {
        this.keepRecordingThroughRing()
        return
      }
      this.interruptBeganAt = Date.now()
      this.interruptHold = true
      this.pushEvent('began')
      return
    }
    if (state == 'started' && this.interruptHold && this.interruptGraceDone() && !this.otherCallActive()) {
      this.pushEvent('ended')
    }
  }

  /** 电话已接通或语音通话已建立。响铃不算。 */
  private callConnected(): boolean {
    try {
      const scene = audio.getAudioManager().getAudioSceneSync()
      if (scene == audio.AudioScene.AUDIO_SCENE_PHONE_CALL) {
        return true
      }
      if (scene == audio.AudioScene.AUDIO_SCENE_VOICE_CHAT) {
        return true
      }
    } catch (_eScene) {
    }
    return false
  }

  /**
   * 接通后不暂停采集器。暂停后再 resume 要重新启动麦克风，后台会被系统拒绝。
   * 这里只记下静音区间，当前文件封口时再剪掉。
   */
  private noteCallSilence(): void {
    if (!this.fileOpen) {
      return
    }
    if (this.callConnected()) {
      if (!this.silenceOpen) {
        this.silenceOpen = true
        this.silenceMarks.push(this.mediaElapsedMs())
      }
      return
    }
    if (this.silenceOpen) {
      this.silenceOpen = false
      this.silenceMarks.push(this.mediaElapsedMs())
    }
  }

  private mediaElapsedMs(): number {
    if (this.segmentStartedAt <= 0) {
      return 0
    }
    const endAt = this.pauseBeganAt > 0 ? this.pauseBeganAt : Date.now()
    let elapsed = endAt - this.segmentStartedAt - this.pausedAccumMs
    if (elapsed < 0) {
      elapsed = 0
    }
    return elapsed
  }

  /** 只是来电响铃时，系统可能把录音器按住。拉回来继续写，不进入暂停。 */
  private keepRecordingThroughRing(): void {
    if (this.ringResumeBusy || !this.fileOpen || this.callConnected()) {
      return
    }
    const av = this.recorder
    if (av == null) {
      return
    }
    this.ringResumeBusy = true
    this.markSelfAction()
    av.resume().then((): void => {
      this.ringResumeBusy = false
    }).catch((): void => {
      this.ringResumeBusy = false
    })
  }

  /** 通话把当前段封口后，旧的 AVRecorder 往往还停在暂停或错误态，prepare 会直接失败。先丢掉它再开下一段。 */
  async restartSegment(filesDir: string, localId: string, indexName: string): Promise<string> {
    const av = this.recorder
    this.recorder = null
    this.fileOpen = false
    this.closeFd()
    if (av != null) {
      try {
        await av.release()
      } catch (_eRelease) {
      }
    }
    return await this.startSegment(filesDir, localId, indexName)
  }

  async startSegment(filesDir: string, localId: string, indexName: string): Promise<string> {
    const path = this.preparePath(filesDir, localId, indexName)
    if (path.length == 0) {
      return ''
    }
    const av = await this.ensureRecorder()
    if (av == null) {
      return ''
    }
    if (this.fileOpen) {
      await this.finishFile()
    }
    const opened = await this.openFile(av, path)
    if (!opened) {
      return ''
    }
    return this.currentPath
  }

  /** 封上当前 m4a，立刻让同一个 AVRecorder 写下一段。 */
  async rotateSegment(filesDir: string, localId: string, indexName: string): Promise<string> {
    if (this.recorder == null) {
      return ''
    }
    const path = this.preparePath(filesDir, localId, indexName)
    if (path.length == 0) {
      return ''
    }
    await this.finishFile()
    const opened = await this.openFile(this.recorder, path)
    if (!opened) {
      return ''
    }
    return this.currentPath
  }

  async pauseSegment(): Promise<string> {
    this.markSelfAction()
    const av = this.recorder
    if (av == null || !this.fileOpen) {
      return '0'
    }
    try {
      await av.pause()
      this.pauseBeganAt = Date.now()
      return '1'
    } catch (ePause) {
      // 电话接通时系统已经把录音器按成 paused，再 pause 会被拒绝。
      // 这时采集器还在，挂断后直接 resume。封口再新建采集器，后台会被系统拒绝。
      console.warn('[voice-note] m4a pause failed', av.state, ePause)
      if (av.state == 'paused') {
        this.pauseBeganAt = Date.now()
        return '1'
      }
      try {
        await this.finishFile()
        return '2'
      } catch (eSeal) {
        console.warn('[voice-note] m4a pause seal failed', eSeal)
        return '0'
      }
    }
  }

  async resumeSegment(): Promise<string> {
    this.markSelfAction()
    const av = this.recorder
    if (av == null || !this.fileOpen) {
      return '0'
    }
    try {
      await av.resume()
      this.finishInterruptionResume()
      return '1'
    } catch (eResume) {
      if (av.state == 'started') {
        this.finishInterruptionResume()
        return '1'
      }
      console.warn('[voice-note] m4a resume failed', eResume)
      return '0'
    }
  }

  async stopSegment(): Promise<string> {
    this.markSelfAction()
    this.interruptHold = false
    this.pendingEvents = []
    await this.finishFile()
    const av = this.recorder
    this.recorder = null
    if (av != null) {
      try {
        await av.release()
      } catch (_eRelease) {
      }
    }
    return '1'
  }

  takeClosedDurationMs(): string {
    const duration = this.lastClosedDurationMs
    this.lastClosedDurationMs = 0
    return `${duration}`
  }

  /** 其他应用抢走音频时返回一次 began 或 ended，读完即清。通话结束后系统经常不把录音器拉回 started。 */
  takeInterruption(): string {
    this.noteCallSilence()
    if (!this.interruptHold && this.fileOpen && !this.callConnected()) {
      const av = this.recorder
      if (av != null && (av.state == 'paused' || av.state == 'error')) {
        this.keepRecordingThroughRing()
      }
    }
    if (this.interruptHold && this.interruptGraceDone() && !this.otherCallActive()) {
      this.pushEvent('ended')
    }
    if (this.pendingEvents.length == 0) {
      return ''
    }
    const event = this.pendingEvents[0]
    const next: string[] = []
    for (let i = 1; i < this.pendingEvents.length; i++) {
      next.push(this.pendingEvents[i])
    }
    this.pendingEvents = next
    return event
  }

  private interruptGraceDone(): boolean {
    return Date.now() - this.interruptBeganAt >= 800
  }

  /** 响铃或通话还在时不要恢复。暂停只认已接通的电话和语音通话。 */
  private otherCallActive(): boolean {
    try {
      const scene = audio.getAudioManager().getAudioSceneSync()
      if (scene == audio.AudioScene.AUDIO_SCENE_RINGING) {
        return true
      }
      if (scene == audio.AudioScene.AUDIO_SCENE_PHONE_CALL) {
        return true
      }
      if (scene == audio.AudioScene.AUDIO_SCENE_VOICE_CHAT) {
        return true
      }
    } catch (_eScene) {
    }
    return false
  }

  private pushEvent(event: string): void {
    const size = this.pendingEvents.length
    if (size > 0 && this.pendingEvents[size - 1] == event) {
      return
    }
    this.pendingEvents.push(event)
    if (this.pendingEvents.length > 4) {
      const kept: string[] = []
      for (let i = this.pendingEvents.length - 4; i < this.pendingEvents.length; i++) {
        kept.push(this.pendingEvents[i])
      }
      this.pendingEvents = kept
    }
  }

  private finishInterruptionResume(): void {
    if (this.pauseBeganAt > 0) {
      this.pausedAccumMs = this.pausedAccumMs + (Date.now() - this.pauseBeganAt)
      this.pauseBeganAt = 0
    }
    this.interruptHold = false
    this.pendingEvents = []
  }

  /**
   * 当前输入音量，0 到 100。
   * 读这次 AVRecorder 自己的采集振幅，不读系统输入设备。
   */
  takeLevel(): string {
    if (!this.fileOpen) {
      this.inputLevel = 0
      return '0'
    }
    this.pollLevel()
    return `${this.inputLevel}`
  }

  private pollLevel(): void {
    const now = Date.now()
    if (this.levelBusy && now - this.levelStartedAt < 800) {
      return
    }
    this.levelBusy = true
    this.levelStartedAt = now
    this.readAmplitude().then((level: number): void => {
      this.inputLevel = level
      this.levelBusy = false
    }).catch((): void => {
      this.levelBusy = false
    })
  }

  private async readAmplitude(): Promise<number> {
    const av = this.recorder
    if (av == null || !this.fileOpen) {
      return 0
    }
    try {
      const meter = av as AmplitudeRecorder
      const amp = await meter.getAudioCapturerMaxAmplitude()
      return amplitudeToLevel(amp)
    } catch (eAmp) {
      console.warn('[voice-note] amplitude failed', eAmp)
      return 0
    }
  }

  /**
   * 把已经封口、并且长过一段的 m4a 按 segmentMs 拆成多份。
   * 当前 SDK 的 MediaKit 不再导出 AVDemuxer / AVMuxer，因此按 m4a 盒子重写采样表，AAC 帧原样拷贝。
   * 返回每行「路径\\t时长毫秒」。拆不开或本来就只要一段时返回空字符串，原文件保留。
   */
  async splitFile(path: string, segmentMs: number): Promise<string> {
    if (path.length == 0 || segmentMs < 1000) {
      return ''
    }
    const pieces = await splitSealedM4a(path, segmentMs)
    if (pieces.length <= 1) {
      return ''
    }
    let text = ''
    for (let i = 0; i < pieces.length; i++) {
      if (i > 0) {
        text = text + '\n'
      }
      text = text + pieces[i].path + '\t' + pieces[i].durationMs
    }
    try {
      fs.unlinkSync(path)
    } catch (_eUnlink) {
    }
    return text
  }

  private async ensureRecorder(): Promise<media.AVRecorder | null> {
    if (this.recorder != null) {
      return this.recorder
    }
    try {
      this.recorder = await media.createAVRecorder()
      this.recorder.on('stateChange', (state: media.AVRecorderState, _reason: media.StateChangeReason): void => {
        this.noteRecorderState(state)
      })
      return this.recorder
    } catch (eCreate) {
      console.warn('[voice-note] m4a create failed', eCreate)
      return null
    }
  }

  /**
   * 来电或语音通话优先级更高。不设置时系统会把录音器打成 error，后台不能再新建麦克风。
   * 设置后采集器保持录音。接通期间的静音留在文件里，封口时再剪掉。
   */
  private async enableMuteWhenInterrupted(av: media.AVRecorder): Promise<void> {
    try {
      const muteable = av as MuteInterruptRecorder
      await muteable.setWillMuteWhenInterrupted(true)
      console.info('[voice-note] mute when interrupted on')
    } catch (eMute) {
      console.warn('[voice-note] mute when interrupted unavailable', eMute)
    }
  }

  private async openFile(av: media.AVRecorder, path: string): Promise<boolean> {
    this.markSelfAction()
    let opened: fs.File
    try {
      opened = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
    } catch (eOpen) {
      console.warn('[voice-note] m4a open failed', eOpen)
      return false
    }
    try {
      const profile: media.AVRecorderProfile = {
        audioBitrate: 64000,
        audioChannels: 1,
        audioCodec: media.CodecMimeType.AUDIO_AAC,
        audioSampleRate: 16000,
        fileFormat: media.ContainerFormatType.CFT_MPEG_4A,
      }
      const config: media.AVRecorderConfig = {
        audioSourceType: media.AudioSourceType.AUDIO_SOURCE_TYPE_MIC,
        profile: profile,
        url: `fd://${opened.fd}`,
      }
      await this.enableMuteWhenInterrupted(av)
      await av.prepare(config)
      await av.start()
      this.file = opened
      this.currentPath = path
      this.fileOpen = true
      this.segmentStartedAt = Date.now()
      this.pausedAccumMs = 0
      this.pauseBeganAt = 0
      this.interruptHold = false
      this.pendingEvents = []
      this.silenceMarks = []
      this.silenceOpen = false
      return true
    } catch (eStart) {
      console.warn('[voice-note] m4a start failed', eStart)
      try {
        fs.closeSync(opened)
      } catch (_eClose) {
      }
      try {
        await av.reset()
      } catch (_eReset) {
      }
      return false
    }
  }

  private async finishFile(): Promise<void> {
    this.markSelfAction()
    if (!this.fileOpen || this.recorder == null) {
      this.closeFd()
      return
    }
    const endAt = this.pauseBeganAt > 0 ? this.pauseBeganAt : Date.now()
    let duration = endAt - this.segmentStartedAt - this.pausedAccumMs
    if (duration < 0) {
      duration = 0
    }
    this.lastClosedDurationMs = duration
    const sealedPath = this.currentPath
    const marks: number[] = []
    for (let i = 0; i < this.silenceMarks.length; i++) {
      marks.push(this.silenceMarks[i])
    }
    if (this.silenceOpen) {
      marks.push(duration)
    }
    this.silenceMarks = []
    this.silenceOpen = false
    try {
      await this.recorder.stop()
    } catch (_eStop) {
    }
    try {
      await this.recorder.reset()
    } catch (_eReset) {
    }
    this.fileOpen = false
    this.segmentStartedAt = 0
    this.pausedAccumMs = 0
    this.pauseBeganAt = 0
    this.currentPath = ''
    this.closeFd()
    if (sealedPath.length > 0 && marks.length >= 2) {
      const trimmed = dropCallSilence(sealedPath, marks)
      if (trimmed > 0) {
        this.lastClosedDurationMs = trimmed
      }
    }
  }

  private closeFd(): void {
    const opened = this.file
    this.file = null
    if (opened == null) {
      return
    }
    try {
      fs.closeSync(opened)
    } catch (_eClose) {
    }
  }

  private preparePath(filesDir: string, localId: string, indexName: string): string {
    const safeId = this.sanitize(localId)
    const safeIndex = this.sanitize(indexName)
    if (safeId.length == 0 || safeIndex.length == 0) {
      return ''
    }
    const folder = `${filesDir}/voice-notes/${safeId}`
    try {
      fs.mkdirSync(folder, true)
    } catch (_eMkdir) {
    }
    return `${folder}/${safeIndex}.m4a`
  }

  private sanitize(raw: string): string {
    return raw.split('/').join('_').split('..').join('_').trim()
  }
}

class SplitPiece {
  path: string = ''
  durationMs: number = 0
}

class Mp4Span {
  type: number = 0
  payload: Uint8Array = new Uint8Array(0)
  children: Mp4Span[] = []
  container: boolean = false
}

class SttsEntry {
  count: number = 0
  delta: number = 0
}

class StscEntry {
  firstChunk: number = 0
  samplesPerChunk: number = 0
  descIndex: number = 1
}

class SampleRange {
  start: number = 0
  end: number = 0
  mediaDuration: number = 0
}

class M4aLayout {
  moov: Mp4Span | null = null
  ftyp: Uint8Array = new Uint8Array(0)
  sizes: number[] = []
  deltas: number[] = []
  offsets: number[] = []
  mediaScale: number = 0
  movieScale: number = 0
  trakIndex: number = 0
  descIndex: number = 1
}

const BOX_FTYP: number = 0x66747970
const BOX_MOOV: number = 0x6d6f6f76
const BOX_MDAT: number = 0x6d646174
const BOX_MVHD: number = 0x6d766864
const BOX_TRAK: number = 0x7472616b
const BOX_TKHD: number = 0x746b6864
const BOX_MDIA: number = 0x6d646961
const BOX_MDHD: number = 0x6d646864
const BOX_HDLR: number = 0x68646c72
const BOX_MINF: number = 0x6d696e66
const BOX_STBL: number = 0x7374626c
const BOX_STTS: number = 0x73747473
const BOX_STSC: number = 0x73747363
const BOX_STSZ: number = 0x7374737a
const BOX_STCO: number = 0x7374636f
const BOX_CO64: number = 0x636f3634
const BOX_STSS: number = 0x73747373
const BOX_CTTS: number = 0x63747473
const BOX_EDTS: number = 0x65647473
const HANDLER_SOUN: number = 0x736f756e
const SPLIT_FILE_LIMIT: number = 96 * 1024 * 1024

function dropCallSilence(path: string, marks: number[]): number {
  if (path.length == 0 || marks.length < 2) {
    return -1
  }
  const source = readFileBytes(path)
  if (source == null) {
    return -1
  }
  const layout = readLayout(source)
  if (layout == null || layout.mediaScale <= 0 || layout.moov == null) {
    return -1
  }
  const count = layout.sizes.length < layout.deltas.length ? layout.sizes.length : layout.deltas.length
  const compact = new M4aLayout()
  compact.moov = layout.moov
  compact.ftyp = layout.ftyp
  compact.mediaScale = layout.mediaScale
  compact.movieScale = layout.movieScale
  compact.trakIndex = layout.trakIndex
  compact.descIndex = layout.descIndex
  let tick = 0
  let keptDuration = 0
  let dropped = 0
  for (let i = 0; i < count; i++) {
    const startMs = Math.floor(tick * 1000 / layout.mediaScale)
    tick = tick + layout.deltas[i]
    const endMs = Math.floor(tick * 1000 / layout.mediaScale)
    if (sampleInCall(startMs, endMs, marks)) {
      dropped = dropped + 1
      continue
    }
    compact.sizes.push(layout.sizes[i])
    compact.deltas.push(layout.deltas[i])
    compact.offsets.push(layout.offsets[i])
    keptDuration = keptDuration + layout.deltas[i]
  }
  if (dropped <= 0 || compact.sizes.length <= 0) {
    return -1
  }
  const range = new SampleRange()
  range.start = 0
  range.end = compact.sizes.length
  range.mediaDuration = keptDuration
  const temp = path + '.nosilence.m4a'
  const piece = writePiece(source, compact, range, temp)
  if (piece == null) {
    removeFile(temp)
    return -1
  }
  const trimmed = readFileBytes(temp)
  removeFile(temp)
  if (trimmed == null || !writeFileBytes(path, copyBuffer(trimmed))) {
    return -1
  }
  console.info('[voice-note] call silence removed ' + dropped)
  return piece.durationMs
}

function copyBuffer(view: Uint8Array): ArrayBuffer {
  const raw = new ArrayBuffer(view.byteLength)
  const out = new Uint8Array(raw)
  for (let i = 0; i < view.byteLength; i++) {
    out[i] = view[i]
  }
  return raw
}

function sampleInCall(startMs: number, endMs: number, marks: number[]): boolean {
  let i = 0
  while (i + 1 < marks.length) {
    let from = marks[i] - 1200
    if (from < 0) {
      from = 0
    }
    const to = marks[i + 1] + 400
    if (endMs > from && startMs < to) {
      return true
    }
    i = i + 2
  }
  return false
}

async function splitSealedM4a(path: string, segmentMs: number): Promise<SplitPiece[]> {
  const empty: SplitPiece[] = []
  const made: SplitPiece[] = []
  try {
    const source = readFileBytes(path)
    if (source == null) {
      return empty
    }
    const layout = readLayout(source)
    if (layout == null || layout.mediaScale <= 0) {
      return empty
    }
    const segmentTicks = Math.floor(segmentMs * layout.mediaScale / 1000)
    if (segmentTicks <= 0) {
      return empty
    }
    const ranges = sliceRanges(layout.deltas, layout.sizes.length, segmentTicks)
    if (ranges.length <= 1) {
      return empty
    }
    for (let i = 0; i < ranges.length; i++) {
      const piece = writePiece(source, layout, ranges[i], partPath(path, i))
      if (piece == null) {
        await discardPieces(made)
        return empty
      }
      made.push(piece)
    }
    if (made.length <= 1) {
      await discardPieces(made)
      return empty
    }
    return made
  } catch (eSplit) {
    console.warn('[voice-note] m4a split failed', eSplit)
    await discardPieces(made)
    return empty
  }
}

function partPath(source: string, index: number): string {
  const dot = source.lastIndexOf('.')
  const stem = dot > 0 ? source.substring(0, dot) : source
  return stem + '_p' + index + '.m4a'
}

function readFileBytes(path: string): Uint8Array | null {
  let input: fs.File | null = null
  try {
    const stat = fs.statSync(path)
    const length = stat.size
    if (length < 32 || length > SPLIT_FILE_LIMIT) {
      return null
    }
    input = fs.openSync(path, fs.OpenMode.READ_ONLY)
    const raw = new ArrayBuffer(length)
    const got = fs.readSync(input.fd, raw)
    if (got != length) {
      return null
    }
    return new Uint8Array(raw)
  } catch (eRead) {
    console.warn('[voice-note] m4a split read failed', eRead)
    return null
  } finally {
    if (input != null) {
      try {
        fs.closeSync(input)
      } catch (_eClose) {
      }
    }
  }
}

function writeFileBytes(path: string, raw: ArrayBuffer): boolean {
  let opened: fs.File | null = null
  try {
    opened = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
    const wrote = fs.writeSync(opened.fd, raw)
    return wrote == raw.byteLength
  } catch (eWrite) {
    console.warn('[voice-note] m4a split write failed', eWrite)
    return false
  } finally {
    if (opened != null) {
      try {
        fs.closeSync(opened)
      } catch (_eClose) {
      }
    }
  }
}

function removeFile(path: string): void {
  if (path.length == 0) {
    return
  }
  try {
    fs.unlinkSync(path)
  } catch (_eUnlink) {
  }
}

function payloadView(bytes: Uint8Array): DataView {
  const raw = bytes.buffer as ArrayBuffer
  return new DataView(raw, bytes.byteOffset, bytes.byteLength)
}

function copyUint8(src: Uint8Array): Uint8Array {
  const dst = new Uint8Array(src.length)
  for (let i = 0; i < src.length; i++) {
    dst[i] = src[i]
  }
  return dst
}

function copySpan(view: DataView, offset: number, length: number): Uint8Array {
  const dst = new Uint8Array(length)
  for (let i = 0; i < length; i++) {
    dst[i] = view.getUint8(offset + i)
  }
  return dst
}

function isContainer(type: number): boolean {
  return type == BOX_MOOV || type == BOX_TRAK || type == BOX_MDIA || type == BOX_MINF || type == BOX_STBL
}

function clampU32(value: number): number {
  if (value <= 0) {
    return 0
  }
  if (value >= 4294967295) {
    return 4294967295
  }
  return Math.floor(value)
}

function defaultFtyp(): Uint8Array {
  const bytes = new Uint8Array(28)
  const view = payloadView(bytes)
  view.setUint32(0, 28)
  view.setUint32(4, BOX_FTYP)
  view.setUint32(8, 0x4d344120)
  view.setUint32(12, 0)
  view.setUint32(16, 0x4d344120)
  view.setUint32(20, 0x6d703432)
  view.setUint32(24, 0x69736f6d)
  return bytes
}

function parseBoxes(view: DataView, start: number, end: number): Mp4Span[] {
  const list: Mp4Span[] = []
  let offset = start
  while (offset + 8 <= end) {
    const size32 = view.getUint32(offset)
    const type = view.getUint32(offset + 4)
    let header = 8
    let size = size32
    if (size32 == 1) {
      if (offset + 16 > end) {
        break
      }
      const hi = view.getUint32(offset + 8)
      const lo = view.getUint32(offset + 12)
      if (hi != 0) {
        break
      }
      size = lo
      header = 16
    } else if (size32 == 0) {
      size = end - offset
    }
    if (size < header || offset + size > end) {
      break
    }
    const box = new Mp4Span()
    box.type = type
    if (isContainer(type)) {
      box.container = true
      box.children = parseBoxes(view, offset + header, offset + size)
    } else {
      box.payload = copySpan(view, offset + header, size - header)
    }
    list.push(box)
    offset = offset + size
  }
  return list
}

function findChild(boxes: Mp4Span[], type: number): Mp4Span | null {
  for (let i = 0; i < boxes.length; i++) {
    if (boxes[i].type == type) {
      return boxes[i]
    }
  }
  return null
}

function findTopBox(view: DataView, fileLength: number, type: number): Mp4Span | null {
  let offset = 0
  while (offset + 8 <= fileLength) {
    const size32 = view.getUint32(offset)
    const boxType = view.getUint32(offset + 4)
    let header = 8
    let size = size32
    if (size32 == 1) {
      if (offset + 16 > fileLength) {
        break
      }
      const hi = view.getUint32(offset + 8)
      const lo = view.getUint32(offset + 12)
      if (hi != 0) {
        break
      }
      size = lo
      header = 16
    } else if (size32 == 0) {
      size = fileLength - offset
    }
    if (size < header || offset + size > fileLength) {
      break
    }
    if (boxType == type) {
      const box = new Mp4Span()
      box.type = type
      if (isContainer(type)) {
        box.container = true
        box.children = parseBoxes(view, offset + header, offset + size)
      } else {
        box.payload = copySpan(view, offset, size)
      }
      return box
    }
    offset = offset + size
  }
  return null
}

function readTimescale(payload: Uint8Array, v0Offset: number, v1Offset: number): number {
  if (payload.length < 4) {
    return 0
  }
  const view = payloadView(payload)
  const version = view.getUint8(0)
  const offset = version == 1 ? v1Offset : v0Offset
  if (payload.length < offset + 4) {
    return 0
  }
  return view.getUint32(offset)
}

function readStts(payload: Uint8Array, sampleCount: number): number[] {
  if (payload.length < 8 || sampleCount <= 0) {
    return []
  }
  const view = payloadView(payload)
  const count = view.getUint32(4)
  const deltas: number[] = []
  let cursor = 8
  let remain = sampleCount
  for (let i = 0; i < count && remain > 0; i++) {
    if (cursor + 8 > payload.length) {
      break
    }
    let n = view.getUint32(cursor)
    const delta = view.getUint32(cursor + 4)
    cursor = cursor + 8
    if (n > remain) {
      n = remain
    }
    for (let j = 0; j < n; j++) {
      deltas.push(delta)
    }
    remain = remain - n
  }
  return deltas
}

function readSizes(payload: Uint8Array): number[] {
  if (payload.length < 12) {
    return []
  }
  const view = payloadView(payload)
  const fixed = view.getUint32(4)
  const count = view.getUint32(8)
  if (count <= 0 || count > 2000000) {
    return []
  }
  const sizes: number[] = []
  if (fixed != 0) {
    for (let i = 0; i < count; i++) {
      sizes.push(fixed)
    }
    return sizes
  }
  let cursor = 12
  for (let i = 0; i < count; i++) {
    if (cursor + 4 > payload.length) {
      return []
    }
    sizes.push(view.getUint32(cursor))
    cursor = cursor + 4
  }
  return sizes
}

function readStsc(payload: Uint8Array): StscEntry[] {
  if (payload.length < 8) {
    return []
  }
  const view = payloadView(payload)
  const count = view.getUint32(4)
  const entries: StscEntry[] = []
  let cursor = 8
  for (let i = 0; i < count; i++) {
    if (cursor + 12 > payload.length) {
      break
    }
    const entry = new StscEntry()
    entry.firstChunk = view.getUint32(cursor)
    entry.samplesPerChunk = view.getUint32(cursor + 4)
    entry.descIndex = view.getUint32(cursor + 8)
    entries.push(entry)
    cursor = cursor + 12
  }
  return entries
}

function readChunkOffsets(payload: Uint8Array, wide: boolean): number[] {
  if (payload.length < 8) {
    return []
  }
  const view = payloadView(payload)
  const count = view.getUint32(4)
  const offsets: number[] = []
  let cursor = 8
  const step = wide ? 8 : 4
  for (let i = 0; i < count; i++) {
    if (cursor + step > payload.length) {
      return []
    }
    if (wide) {
      const hi = view.getUint32(cursor)
      const lo = view.getUint32(cursor + 4)
      if (hi != 0) {
        return []
      }
      offsets.push(lo)
    } else {
      offsets.push(view.getUint32(cursor))
    }
    cursor = cursor + step
  }
  return offsets
}

function sampleOffsets(sizes: number[], entries: StscEntry[], chunkOffsets: number[]): number[] {
  if (entries.length == 0 || chunkOffsets.length == 0) {
    return []
  }
  const offsets: number[] = []
  let sampleIndex = 0
  let tableIndex = 0
  for (let chunk = 0; chunk < chunkOffsets.length && sampleIndex < sizes.length; chunk++) {
    const chunkNumber = chunk + 1
    while (tableIndex + 1 < entries.length && entries[tableIndex + 1].firstChunk <= chunkNumber) {
      tableIndex = tableIndex + 1
    }
    const per = entries[tableIndex].samplesPerChunk
    if (per <= 0) {
      return []
    }
    let cursor = chunkOffsets[chunk]
    for (let s = 0; s < per && sampleIndex < sizes.length; s++) {
      offsets.push(cursor)
      cursor = cursor + sizes[sampleIndex]
      sampleIndex = sampleIndex + 1
    }
  }
  return offsets
}

function isSoundTrak(trak: Mp4Span): boolean {
  const mdia = findChild(trak.children, BOX_MDIA)
  if (mdia == null) {
    return false
  }
  const hdlr = findChild(mdia.children, BOX_HDLR)
  if (hdlr == null || hdlr.payload.length < 12) {
    return false
  }
  const view = payloadView(hdlr.payload)
  return view.getUint32(8) == HANDLER_SOUN
}

function readLayout(source: Uint8Array): M4aLayout | null {
  const view = payloadView(source)
  const moov = findTopBox(view, source.length, BOX_MOOV)
  if (moov == null) {
    return null
  }
  const mvhd = findChild(moov.children, BOX_MVHD)
  if (mvhd == null) {
    return null
  }
  let trakIndex = -1
  let trak: Mp4Span | null = null
  let seen = 0
  for (let i = 0; i < moov.children.length; i++) {
    const child = moov.children[i]
    if (child.type != BOX_TRAK) {
      continue
    }
    if (trak == null || isSoundTrak(child)) {
      trak = child
      trakIndex = seen
      if (isSoundTrak(child)) {
        break
      }
    }
    seen = seen + 1
  }
  if (trak == null || trakIndex < 0) {
    return null
  }
  const mdia = findChild(trak.children, BOX_MDIA)
  if (mdia == null) {
    return null
  }
  const mdhd = findChild(mdia.children, BOX_MDHD)
  const minf = findChild(mdia.children, BOX_MINF)
  if (mdhd == null || minf == null) {
    return null
  }
  const stbl = findChild(minf.children, BOX_STBL)
  if (stbl == null) {
    return null
  }
  const stsz = findChild(stbl.children, BOX_STSZ)
  const stts = findChild(stbl.children, BOX_STTS)
  const stsc = findChild(stbl.children, BOX_STSC)
  if (stsz == null || stts == null || stsc == null) {
    return null
  }
  const sizes = readSizes(stsz.payload)
  if (sizes.length == 0) {
    return null
  }
  const deltas = readStts(stts.payload, sizes.length)
  const stscEntries = readStsc(stsc.payload)
  let chunkBox = findChild(stbl.children, BOX_STCO)
  let wide = false
  if (chunkBox == null) {
    chunkBox = findChild(stbl.children, BOX_CO64)
    wide = true
  }
  if (chunkBox == null) {
    return null
  }
  const chunkOffsets = readChunkOffsets(chunkBox.payload, wide)
  const offsets = sampleOffsets(sizes, stscEntries, chunkOffsets)
  if (deltas.length < sizes.length || offsets.length < sizes.length) {
    return null
  }
  for (let i = 0; i < sizes.length; i++) {
    const from = offsets[i]
    const size = sizes[i]
    if (size < 0 || from < 0 || from + size > source.length) {
      return null
    }
  }
  const layout = new M4aLayout()
  layout.moov = moov
  const ftyp = findTopBox(view, source.length, BOX_FTYP)
  if (ftyp != null && ftyp.payload.length >= 8) {
    layout.ftyp = ftyp.payload
  } else {
    layout.ftyp = defaultFtyp()
  }
  layout.sizes = sizes
  layout.deltas = deltas
  layout.offsets = offsets
  layout.mediaScale = readTimescale(mdhd.payload, 12, 20)
  layout.movieScale = readTimescale(mvhd.payload, 12, 20)
  layout.trakIndex = trakIndex
  if (stscEntries.length > 0 && stscEntries[0].descIndex > 0) {
    layout.descIndex = stscEntries[0].descIndex
  }
  if (layout.mediaScale <= 0 || layout.movieScale <= 0) {
    return null
  }
  return layout
}

function sliceRanges(deltas: number[], sampleCount: number, segmentTicks: number): SampleRange[] {
  const ranges: SampleRange[] = []
  let start = 0
  let origin = 0
  let cursor = 0
  const count = sampleCount < deltas.length ? sampleCount : deltas.length
  for (let i = 0; i < count; i++) {
    if (cursor - origin >= segmentTicks && i > start) {
      const range = new SampleRange()
      range.start = start
      range.end = i
      range.mediaDuration = cursor - origin
      ranges.push(range)
      start = i
      origin = cursor
    }
    cursor = cursor + deltas[i]
  }
  if (start < count) {
    const range = new SampleRange()
    range.start = start
    range.end = count
    range.mediaDuration = cursor - origin
    ranges.push(range)
  }
  return ranges
}

function cloneSpan(src: Mp4Span): Mp4Span {
  const out = new Mp4Span()
  out.type = src.type
  out.container = src.container
  if (src.container) {
    for (let i = 0; i < src.children.length; i++) {
      out.children.push(cloneSpan(src.children[i]))
    }
  } else {
    out.payload = copyUint8(src.payload)
  }
  return out
}

function patchFullDuration(payload: Uint8Array, v0: number, v1: number, duration: number): Uint8Array {
  const out = copyUint8(payload)
  if (out.length < 4) {
    return out
  }
  const view = payloadView(out)
  const version = view.getUint8(0)
  const ticks = clampU32(duration)
  if (version == 1) {
    if (out.length >= v1 + 8) {
      view.setUint32(v1, 0)
      view.setUint32(v1 + 4, ticks)
    }
  } else if (out.length >= v0 + 4) {
    view.setUint32(v0, ticks)
  }
  return out
}

function dropType(parent: Mp4Span, type: number): void {
  const kept: Mp4Span[] = []
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i].type != type) {
      kept.push(parent.children[i])
    }
  }
  parent.children = kept
}

function putLeaf(parent: Mp4Span, type: number, payload: Uint8Array): void {
  for (let i = 0; i < parent.children.length; i++) {
    if (parent.children[i].type == type) {
      parent.children[i].container = false
      parent.children[i].children = []
      parent.children[i].payload = payload
      return
    }
  }
  const box = new Mp4Span()
  box.type = type
  box.payload = payload
  parent.children.push(box)
}

function buildStts(deltas: number[], start: number, end: number): Uint8Array {
  const entries: SttsEntry[] = []
  for (let i = start; i < end; i++) {
    const delta = deltas[i]
    if (entries.length > 0 && entries[entries.length - 1].delta == delta) {
      entries[entries.length - 1].count = entries[entries.length - 1].count + 1
    } else {
      const entry = new SttsEntry()
      entry.count = 1
      entry.delta = delta
      entries.push(entry)
    }
  }
  const bytes = new Uint8Array(8 + entries.length * 8)
  const view = payloadView(bytes)
  view.setUint32(4, entries.length)
  let cursor = 8
  for (let i = 0; i < entries.length; i++) {
    view.setUint32(cursor, entries[i].count)
    view.setUint32(cursor + 4, entries[i].delta)
    cursor = cursor + 8
  }
  return bytes
}

function buildStsz(sizes: number[], start: number, end: number): Uint8Array {
  const count = end - start
  const bytes = new Uint8Array(12 + count * 4)
  const view = payloadView(bytes)
  view.setUint32(4, 0)
  view.setUint32(8, count)
  let cursor = 12
  for (let i = start; i < end; i++) {
    view.setUint32(cursor, sizes[i])
    cursor = cursor + 4
  }
  return bytes
}

function buildStsc(sampleCount: number, descIndex: number): Uint8Array {
  const bytes = new Uint8Array(20)
  const view = payloadView(bytes)
  view.setUint32(4, 1)
  view.setUint32(8, 1)
  view.setUint32(12, sampleCount)
  view.setUint32(16, descIndex)
  return bytes
}

function buildStco(offset: number): Uint8Array {
  const bytes = new Uint8Array(12)
  const view = payloadView(bytes)
  view.setUint32(4, 1)
  view.setUint32(8, clampU32(offset))
  return bytes
}

function rewriteStbl(stbl: Mp4Span, range: SampleRange, sizes: number[], deltas: number[], chunkOffset: number, descIndex: number): void {
  dropType(stbl, BOX_STSS)
  dropType(stbl, BOX_CTTS)
  dropType(stbl, BOX_CO64)
  const count = range.end - range.start
  putLeaf(stbl, BOX_STTS, buildStts(deltas, range.start, range.end))
  putLeaf(stbl, BOX_STSC, buildStsc(count, descIndex))
  putLeaf(stbl, BOX_STSZ, buildStsz(sizes, range.start, range.end))
  putLeaf(stbl, BOX_STCO, buildStco(chunkOffset))
}

function rewriteMdia(mdia: Mp4Span, range: SampleRange, sizes: number[], deltas: number[], chunkOffset: number, mediaDuration: number, descIndex: number): void {
  for (let i = 0; i < mdia.children.length; i++) {
    const child = mdia.children[i]
    if (child.type == BOX_MDHD) {
      child.payload = patchFullDuration(child.payload, 16, 24, mediaDuration)
    } else if (child.type == BOX_MINF) {
      const stbl = findChild(child.children, BOX_STBL)
      if (stbl != null) {
        rewriteStbl(stbl, range, sizes, deltas, chunkOffset, descIndex)
      }
    }
  }
}

function dropOtherTraks(moov: Mp4Span, keep: number): void {
  const next: Mp4Span[] = []
  let index = 0
  for (let i = 0; i < moov.children.length; i++) {
    const child = moov.children[i]
    if (child.type != BOX_TRAK) {
      next.push(child)
      continue
    }
    if (index == keep) {
      next.push(child)
    }
    index = index + 1
  }
  moov.children = next
}

function rewriteMoov(source: Mp4Span, layout: M4aLayout, range: SampleRange, chunkOffset: number): Mp4Span {
  const moov = cloneSpan(source)
  dropOtherTraks(moov, layout.trakIndex)
  let movieDuration = range.mediaDuration
  if (layout.mediaScale > 0) {
    movieDuration = Math.floor(range.mediaDuration * layout.movieScale / layout.mediaScale)
  }
  const mediaDuration = clampU32(range.mediaDuration)
  movieDuration = clampU32(movieDuration)
  for (let i = 0; i < moov.children.length; i++) {
    const child = moov.children[i]
    if (child.type == BOX_MVHD) {
      child.payload = patchFullDuration(child.payload, 16, 24, movieDuration)
    } else if (child.type == BOX_TRAK) {
      dropType(child, BOX_EDTS)
      for (let j = 0; j < child.children.length; j++) {
        const part = child.children[j]
        if (part.type == BOX_TKHD) {
          part.payload = patchFullDuration(part.payload, 20, 28, movieDuration)
        } else if (part.type == BOX_MDIA) {
          rewriteMdia(part, range, layout.sizes, layout.deltas, chunkOffset, mediaDuration, layout.descIndex)
        }
      }
    }
  }
  return moov
}

function measure(box: Mp4Span): number {
  if (!box.container) {
    return 8 + box.payload.length
  }
  let size = 8
  for (let i = 0; i < box.children.length; i++) {
    size = size + measure(box.children[i])
  }
  return size
}

function writeBox(box: Mp4Span, target: Uint8Array, offset: number): number {
  const size = measure(box)
  const view = payloadView(target)
  view.setUint32(offset, size)
  view.setUint32(offset + 4, box.type)
  let cursor = offset + 8
  if (box.container) {
    for (let i = 0; i < box.children.length; i++) {
      cursor = writeBox(box.children[i], target, cursor)
    }
  } else {
    const payload = box.payload
    for (let i = 0; i < payload.length; i++) {
      target[cursor + i] = payload[i]
    }
    cursor = cursor + payload.length
  }
  return offset + size
}

function writePiece(source: Uint8Array, layout: M4aLayout, range: SampleRange, path: string): SplitPiece | null {
  const count = range.end - range.start
  if (count <= 0 || layout.moov == null) {
    return null
  }
  let body = 0
  for (let i = range.start; i < range.end; i++) {
    body = body + layout.sizes[i]
  }
  const chunkOffset = layout.ftyp.length + 8
  const moov = rewriteMoov(layout.moov, layout, range, chunkOffset)
  const moovSize = measure(moov)
  const total = layout.ftyp.length + 8 + body + moovSize
  const raw = new ArrayBuffer(total)
  const out = new Uint8Array(raw)
  for (let i = 0; i < layout.ftyp.length; i++) {
    out[i] = layout.ftyp[i]
  }
  const head = payloadView(out)
  head.setUint32(layout.ftyp.length, 8 + body)
  head.setUint32(layout.ftyp.length + 4, BOX_MDAT)
  let cursor = layout.ftyp.length + 8
  for (let i = range.start; i < range.end; i++) {
    const from = layout.offsets[i]
    const size = layout.sizes[i]
    if (from < 0 || size < 0 || from + size > source.length) {
      return null
    }
    for (let j = 0; j < size; j++) {
      out[cursor + j] = source[from + j]
    }
    cursor = cursor + size
  }
  const end = writeBox(moov, out, cursor)
  if (end != total) {
    return null
  }
  if (!writeFileBytes(path, raw)) {
    removeFile(path)
    return null
  }
  let durationMs = 0
  if (layout.mediaScale > 0) {
    durationMs = Math.floor(range.mediaDuration * 1000 / layout.mediaScale)
  }
  if (durationMs <= 0) {
    removeFile(path)
    return null
  }
  const piece = new SplitPiece()
  piece.path = path
  piece.durationMs = durationMs
  return piece
}

async function discardPieces(pieces: SplitPiece[]): Promise<void> {
  for (let i = 0; i < pieces.length; i++) {
    try {
      fs.unlinkSync(pieces[i].path)
    } catch (_eUnlink) {
    }
  }
}
