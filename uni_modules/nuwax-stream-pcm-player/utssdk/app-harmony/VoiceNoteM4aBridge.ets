/**
 * 伙伴页录音。AVRecorder 直接写 m4a（AAC），不写 PCM，也不走 StreamPcmRecorder。
 */
import { media } from '@kit.MediaKit'
import { fileIo as fs } from '@kit.CoreFileKit'

export class VoiceNoteM4aBridge {
  private recorder: media.AVRecorder | null = null
  private file: fs.File | null = null

  async startSegment(filesDir: string, localId: string, indexName: string): Promise<string> {
    await this.stopSegment()
    const safeId = this.sanitize(localId)
    const safeIndex = this.sanitize(indexName)
    if (safeId.length == 0 || safeIndex.length == 0) {
      return ''
    }
    const folder = `${filesDir}/voice-notes/${safeId}`
    try {
      // 父目录 voice-notes 首次不存在。不带递归时 mkdir 失败会被当成已存在，随后 open 直接失败。
      fs.mkdirSync(folder, true)
    } catch (_eMkdir) {
      // 目录已存在时忽略
    }
    const path = `${folder}/${safeIndex}.m4a`
    let opened: fs.File
    try {
      opened = fs.openSync(path, fs.OpenMode.READ_WRITE | fs.OpenMode.CREATE | fs.OpenMode.TRUNC)
    } catch (eOpen) {
      console.warn('[voice-note] m4a open failed', eOpen)
      return ''
    }
    try {
      const av = await media.createAVRecorder()
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
      this.recorder = av
      this.file = opened
      return path
    } catch (eStart) {
      console.warn('[voice-note] m4a start failed', eStart)
      try {
        fs.closeSync(opened)
      } catch (_eClose) {
        // ignore
      }
      return ''
    }
  }

  async pauseSegment(): Promise<string> {
    const av = this.recorder
    if (av == null) {
      return '0'
    }
    try {
      await av.pause()
      return '1'
    } catch (ePause) {
      console.warn('[voice-note] m4a pause failed', ePause)
      return '0'
    }
  }

  async resumeSegment(): Promise<string> {
    const av = this.recorder
    if (av == null) {
      return '0'
    }
    try {
      await av.resume()
      return '1'
    } catch (eResume) {
      console.warn('[voice-note] m4a resume failed', eResume)
      return '0'
    }
  }

  async stopSegment(): Promise<string> {
    const av = this.recorder
    this.recorder = null
    if (av != null) {
      try {
        await av.stop()
      } catch (_eStop) {
        // 未真正开录时 stop 会失败
      }
      try {
        await av.release()
      } catch (_eRelease) {
        // ignore
      }
    }
    const opened = this.file
    this.file = null
    if (opened != null) {
      try {
        fs.closeSync(opened)
      } catch (_eClose) {
        // ignore
      }
    }
    return av != null ? '1' : '0'
  }

  private sanitize(raw: string): string {
    return raw.split('/').join('_').split('..').join('_').trim()
  }
}
