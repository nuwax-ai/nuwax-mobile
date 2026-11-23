/**
 * 伙伴页录音。鸿蒙 ArkTS 的 MediaKit 没有可用的音频编码器类（AudioEncoder 只是旧枚举），
 * 因此整段录音共用一个 AVRecorder：切段时 stop + reset 后换文件再 prepare，不 release、不新建。
 * 不走聊天页的 StreamPcmRecorder。
 */
import { media } from '@kit.MediaKit'
import { fileIo as fs } from '@kit.CoreFileKit'

export class VoiceNoteM4aBridge {
  private recorder: media.AVRecorder | null = null
  private file: fs.File | null = null
  private currentPath: string = ''
  private fileOpen: boolean = false
  private segmentStartedAt: number = 0
  private pausedAccumMs: number = 0
  private pauseBeganAt: number = 0
  private lastClosedDurationMs: number = 0

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
    const av = this.recorder
    if (av == null || !this.fileOpen) {
      return '0'
    }
    try {
      await av.pause()
      this.pauseBeganAt = Date.now()
      return '1'
    } catch (ePause) {
      // 模拟器经常拒绝 pause。改为封口当前文件并 reset，同一个 AVRecorder 还在。
      console.warn('[voice-note] m4a pause failed', ePause)
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
    const av = this.recorder
    if (av == null || !this.fileOpen) {
      return '0'
    }
    try {
      await av.resume()
      if (this.pauseBeganAt > 0) {
        this.pausedAccumMs = this.pausedAccumMs + (Date.now() - this.pauseBeganAt)
        this.pauseBeganAt = 0
      }
      return '1'
    } catch (eResume) {
      console.warn('[voice-note] m4a resume failed', eResume)
      return '0'
    }
  }

  async stopSegment(): Promise<string> {
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

  private async ensureRecorder(): Promise<media.AVRecorder | null> {
    if (this.recorder != null) {
      return this.recorder
    }
    try {
      this.recorder = await media.createAVRecorder()
      return this.recorder
    } catch (eCreate) {
      console.warn('[voice-note] m4a create failed', eCreate)
      return null
    }
  }

  private async openFile(av: media.AVRecorder, path: string): Promise<boolean> {
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
      await av.prepare(config)
      await av.start()
      this.file = opened
      this.currentPath = path
      this.fileOpen = true
      this.segmentStartedAt = Date.now()
      this.pausedAccumMs = 0
      this.pauseBeganAt = 0
      return true
    } catch (eStart) {
      console.warn('[voice-note] m4a start failed', eStart)
      try {
        fs.closeSync(opened)
      } catch (_eClose) {
      }
      return false
    }
  }

  private async finishFile(): Promise<void> {
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
