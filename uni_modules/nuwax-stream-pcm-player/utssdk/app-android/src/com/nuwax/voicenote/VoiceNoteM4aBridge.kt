package com.nuwax.voicenote

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.media.MediaMuxer
import android.media.MediaRecorder
import android.os.Build
import android.os.SystemClock
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer

/**
 * 伙伴页录音。一次会话只用一个 AudioRecord，分段只换 AAC 编码器和 m4a。
 * 不使用 MediaRecorder，也不走聊天页的 StreamPcmRecorder。
 */
class VoiceNoteM4aBridge {
    init {
        active = this
    }

    private val lock = Object()
    private var audioRecord: AudioRecord? = null
    private var readThread: Thread? = null
    @Volatile private var running: Boolean = false
    @Volatile private var paused: Boolean = false

    private var codec: MediaCodec? = null
    private var muxer: MediaMuxer? = null
    private var trackIndex: Int = -1
    private var muxerStarted: Boolean = false
    private var segmentSamples: Long = 0
    private var lastClosedDurationMs: Int = 0
    private var currentPath: String = ""
    private var frameLog: FileOutputStream? = null
    private var frameLogPath: String = ""
    private var framesSinceSync: Int = 0
    private var audioManager: AudioManager? = null
    private var focusRequest: AudioFocusRequest? = null
    private var interruptHold: Boolean = false
    private var interruptBeganAt: Long = 0
    private val pendingEvents = mutableListOf<String>()
    @Volatile private var inputLevel: Int = 0

    private val focusListener = AudioManager.OnAudioFocusChangeListener { change ->
        if (
            change == AudioManager.AUDIOFOCUS_LOSS ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT ||
            change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK
        ) {
            if (!callConnected()) {
                return@OnAudioFocusChangeListener
            }
            synchronized(lock) {
                pauseForConnectedCallLocked()
            }
            return@OnAudioFocusChangeListener
        }
        if (change == AudioManager.AUDIOFOCUS_GAIN) {
            synchronized(lock) {
                if (!interruptHold || otherCallActive() || !interruptGraceDone()) {
                    return@synchronized
                }
                pushEventLocked("ended")
            }
        }
    }

    fun startSegment(context: Context, localId: String, indexName: String): String {
        val opened = synchronized(lock) {
            val path = preparePath(context, localId, indexName) ?: return@synchronized ""
            if (audioRecord == null && !startCapture()) {
                return@synchronized ""
            }
            if (!openEncoder(path)) {
                return@synchronized ""
            }
            paused = false
            ensureRecording()
            currentPath
        }
        if (opened.isNotEmpty()) {
            requestFocus(context)
        }
        return opened
    }

    /** 封上当前 m4a，立刻打开下一段。AudioRecord 不停、不释放。 */
    fun rotateSegment(context: Context, localId: String, indexName: String): String {
        synchronized(lock) {
            if (audioRecord == null) {
                return ""
            }
            val path = preparePath(context, localId, indexName) ?: return ""
            closeEncoder()
            if (!openEncoder(path)) {
                return ""
            }
            return currentPath
        }
    }

    fun pauseSegment(): String {
        synchronized(lock) {
            val current = audioRecord ?: return "0"
            paused = true
            try {
                if (current.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                    current.stop()
                }
            } catch (_e: Exception) {
                // 停不住采集时只是不再往文件里写，录音器对象仍在。
            }
            return "1"
        }
    }

    fun resumeSegment(): String {
        synchronized(lock) {
            if (audioRecord == null || codec == null) {
                return "0"
            }
            paused = false
            val ok = ensureRecording()
            if (!ok) {
                paused = true
                return "0"
            }
            interruptHold = false
            pendingEvents.clear()
            return "1"
        }
    }

    fun stopSegment(): String {
        val thread = synchronized(lock) {
            val joined = readThread
            running = false
            paused = false
            interruptHold = false
            pendingEvents.clear()
            closeEncoder()
            val current = audioRecord
            audioRecord = null
            try {
                current?.stop()
            } catch (_e: Exception) {
            }
            try {
                current?.release()
            } catch (_e: Exception) {
            }
            joined
        }
        try {
            thread?.join(800)
        } catch (_e: Exception) {
        }
        abandonFocus()
        return "1"
    }

    /** 最近一小段输入的音量，0 到 100。面板用来画左侧音波。 */
    fun takeLevel(): String {
        return inputLevel.toString()
    }

    private fun noteLevel(buf: ByteArray, size: Int) {
        var sum = 0L
        var count = 0
        var i = 0
        while (i + 1 < size) {
            val lo = buf[i].toInt() and 0xff
            val hi = buf[i + 1].toInt()
            val sample = (lo or (hi shl 8)).toShort().toInt()
            sum += sample.toLong() * sample.toLong()
            count += 1
            i += 32
        }
        if (count == 0) {
            return
        }
        val rms = Math.sqrt((sum / count).toDouble())
        var level = (rms / 2800.0 * 100.0).toInt()
        if (level < 0) {
            level = 0
        }
        if (level > 100) {
            level = 100
        }
        inputLevel = level
    }

    fun takeInterruption(): String {
        if (callConnected()) {
            synchronized(lock) {
                pauseForConnectedCallLocked()
            }
        }
        val probe = synchronized(lock) {
            interruptHold && interruptGraceDone()
        }
        if (probe && focusAvailable()) {
            synchronized(lock) {
                if (interruptHold && interruptGraceDone() && !otherCallActive()) {
                    pushEventLocked("ended")
                }
            }
        }
        synchronized(lock) {
            if (pendingEvents.isEmpty()) {
                return ""
            }
            return pendingEvents.removeAt(0)
        }
    }

    /** 响铃不算接通。只有电话已接起，或微信等语音通话已建立，才暂停。 */
    private fun callConnected(): Boolean {
        val manager = audioManager ?: return false
        val mode = manager.mode
        return mode == AudioManager.MODE_IN_CALL || mode == AudioManager.MODE_IN_COMMUNICATION
    }

    private fun pauseForConnectedCallLocked() {
        if (!running || paused || !callConnected()) {
            return
        }
        paused = true
        if (!interruptHold) {
            interruptBeganAt = SystemClock.elapsedRealtime()
        }
        interruptHold = true
        pushEventLocked("began")
        try {
            if (audioRecord?.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
                audioRecord?.stop()
            }
        } catch (_e: Exception) {
        }
    }

    /** 电话、微信语音、飞书语音结束后系统经常不回调 AUDIOFOCUS_GAIN。麦克风空出来就补一次结束。 */
    private fun interruptGraceDone(): Boolean {
        return SystemClock.elapsedRealtime() - interruptBeganAt >= 800
    }

    private fun otherCallActive(): Boolean {
        val manager = audioManager ?: return false
        val mode = manager.mode
        return mode == AudioManager.MODE_IN_CALL ||
            mode == AudioManager.MODE_IN_COMMUNICATION ||
            mode == AudioManager.MODE_RINGTONE
    }

    private fun focusAvailable(): Boolean {
        val manager = audioManager ?: return false
        if (otherCallActive()) {
            return false
        }
        if (Build.VERSION.SDK_INT >= 26) {
            val request = focusRequest ?: return false
            return manager.requestAudioFocus(request) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
        }
        @Suppress("DEPRECATION")
        val result = manager.requestAudioFocus(
            focusListener,
            AudioManager.STREAM_MUSIC,
            AudioManager.AUDIOFOCUS_GAIN
        )
        return result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }

    private fun pushEventLocked(event: String) {
        val size = pendingEvents.size
        if (size > 0 && pendingEvents[size - 1] == event) {
            return
        }
        pendingEvents.add(event)
        if (pendingEvents.size > 4) {
            pendingEvents.removeAt(0)
        }
    }

    private fun requestFocus(context: Context) {
        if (audioManager != null) {
            return
        }
        val manager = context.applicationContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        audioManager = manager
        if (Build.VERSION.SDK_INT >= 26) {
            val request = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setOnAudioFocusChangeListener(focusListener)
                .setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                )
                .build()
            focusRequest = request
            manager.requestAudioFocus(request)
        } else {
            @Suppress("DEPRECATION")
            manager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN)
        }
    }

    private fun abandonFocus() {
        val manager = audioManager
        audioManager = null
        if (manager == null) {
            return
        }
        if (Build.VERSION.SDK_INT >= 26) {
            val request = focusRequest
            focusRequest = null
            if (request != null) {
                manager.abandonAudioFocusRequest(request)
            }
        } else {
            @Suppress("DEPRECATION")
            manager.abandonAudioFocus(focusListener)
        }
    }

    fun takeClosedDurationMs(): String {
        synchronized(lock) {
            val duration = lastClosedDurationMs
            lastClosedDurationMs = 0
            return duration.toString()
        }
    }

    private fun startCapture(): Boolean {
        val minBuf = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )
        if (minBuf <= 0) {
            return false
        }
        val bufferSize = if (minBuf < 4096) 4096 else minBuf
        val created = try {
            AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                bufferSize
            )
        } catch (_e: Exception) {
            return false
        }
        if (created.state != AudioRecord.STATE_INITIALIZED) {
            created.release()
            return false
        }
        audioRecord = created
        running = true
        val worker = Thread({ readLoop(bufferSize) }, "voice-note-m4a")
        worker.isDaemon = true
        readThread = worker
        worker.start()
        return true
    }

    private fun ensureRecording(): Boolean {
        val current = audioRecord ?: return false
        if (current.recordingState == AudioRecord.RECORDSTATE_RECORDING) {
            return true
        }
        return try {
            current.startRecording()
            current.recordingState == AudioRecord.RECORDSTATE_RECORDING
        } catch (_e: Exception) {
            false
        }
    }

    private fun readLoop(bufferSize: Int) {
        val buf = ByteArray(bufferSize)
        while (running) {
            if (paused) {
                try {
                    Thread.sleep(20)
                } catch (_e: Exception) {
                }
                continue
            }
            val current = audioRecord
            if (current == null) {
                break
            }
            val read = try {
                current.read(buf, 0, buf.size)
            } catch (_e: Exception) {
                -1
            }
            if (read <= 0) {
                try {
                    Thread.sleep(10)
                } catch (_e: Exception) {
                }
                continue
            }
            noteLevel(buf, read)
            synchronized(lock) {
                if (!paused && codec != null) {
                    feed(buf, read)
                }
            }
        }
    }

    private fun openEncoder(path: String): Boolean {
        closeEncoder()
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 1)
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        format.setInteger(MediaFormat.KEY_BIT_RATE, 64000)
        format.setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 8192)
        val created = try {
            MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        } catch (_e: Exception) {
            return false
        }
        val createdMuxer = try {
            created.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            created.start()
            MediaMuxer(path, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        } catch (_e: Exception) {
            try {
                created.release()
            } catch (_release: Exception) {
            }
            return false
        }
        codec = created
        muxer = createdMuxer
        trackIndex = -1
        muxerStarted = false
        segmentSamples = 0
        currentPath = path
        openFrameLog(path)
        return true
    }

    private fun feed(data: ByteArray, size: Int) {
        val current = codec ?: return
        var offset = 0
        var spins = 0
        while (offset < size && spins < 8) {
            spins += 1
            val inIndex = current.dequeueInputBuffer(10000)
            if (inIndex < 0) {
                drain(false)
                continue
            }
            val input = current.getInputBuffer(inIndex) ?: return
            input.clear()
            val count = minOf(size - offset, input.capacity())
            input.put(data, offset, count)
            val pts = segmentSamples * 1000000L / SAMPLE_RATE
            current.queueInputBuffer(inIndex, 0, count, pts, 0)
            segmentSamples += count / 2
            offset += count
        }
        drain(false)
    }

    private fun drain(waitEos: Boolean) {
        val current = codec ?: return
        val info = MediaCodec.BufferInfo()
        while (true) {
            val outIndex = current.dequeueOutputBuffer(info, if (waitEos) 10000 else 0)
            if (outIndex == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                startMuxer(current.outputFormat)
                continue
            }
            if (outIndex < 0) {
                break
            }
            val output = current.getOutputBuffer(outIndex)
            val config = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
            if (output != null && info.size > 0 && muxerStarted && !config) {
                output.position(info.offset)
                output.limit(info.offset + info.size)
                try {
                    muxer?.writeSampleData(trackIndex, output, info)
                    noteFrameSize(info.size)
                } catch (_e: Exception) {
                }
            }
            current.releaseOutputBuffer(outIndex, false)
            if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) {
                break
            }
        }
    }

    private fun startMuxer(format: MediaFormat) {
        if (muxerStarted) {
            return
        }
        val current = muxer ?: return
        trackIndex = current.addTrack(format)
        current.start()
        muxerStarted = true
        rememberCsd(format)
    }

    /** 编码器自己的 AudioSpecificConfig。补封口必须用这份，写死的参数解出来是静音。 */
    private fun rememberCsd(format: MediaFormat) {
        if (!format.containsKey("csd-0")) {
            return
        }
        val buf = format.getByteBuffer("csd-0") ?: return
        val dup = buf.duplicate()
        dup.position(0)
        if (dup.remaining() <= 0) {
            return
        }
        val bytes = ByteArray(dup.remaining())
        dup.get(bytes)
        if (currentPath.isEmpty()) {
            return
        }
        try {
            File("$currentPath.csd").writeBytes(bytes)
        } catch (_e: Exception) {
        }
    }

    private fun closeEncoder() {
        val current = codec
        if (current != null) {
            val inIndex = try {
                current.dequeueInputBuffer(10000)
            } catch (_e: Exception) {
                -1
            }
            if (inIndex >= 0) {
                val pts = segmentSamples * 1000000L / SAMPLE_RATE
                try {
                    current.queueInputBuffer(inIndex, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                } catch (_e: Exception) {
                }
            }
            try {
                drain(true)
            } catch (_e: Exception) {
            }
            lastClosedDurationMs = (segmentSamples * 1000L / SAMPLE_RATE).toInt()
        }
        var sealedByStop = false
        try {
            if (muxerStarted) {
                muxer?.stop()
                sealedByStop = true
            }
        } catch (_e: Exception) {
        }
        try {
            muxer?.release()
        } catch (_e: Exception) {
        }
        try {
            current?.stop()
        } catch (_e: Exception) {
        }
        try {
            current?.release()
        } catch (_e: Exception) {
        }
        codec = null
        muxer = null
        trackIndex = -1
        muxerStarted = false
        segmentSamples = 0
        currentPath = ""
        closeFrameLog(sealedByStop)
    }

    /** 每帧长度另写一份。进程被杀掉时 mdat 里没有长度表，靠这份把每一帧原样封回去。 */
    private fun openFrameLog(path: String) {
        closeFrameLog(false)
        val logPath = "$path.frames"
        frameLogPath = logPath
        framesSinceSync = 0
        frameLog = try {
            File(logPath).delete()
            FileOutputStream(logPath, false)
        } catch (_e: Exception) {
            null
        }
    }

    private fun noteFrameSize(size: Int) {
        val out = frameLog ?: return
        if (size <= 0) {
            return
        }
        try {
            out.write(
                byteArrayOf(
                    (size ushr 24).toByte(),
                    (size ushr 16).toByte(),
                    (size ushr 8).toByte(),
                    size.toByte(),
                ),
            )
            framesSinceSync += 1
            if (framesSinceSync >= 8) {
                out.fd.sync()
                framesSinceSync = 0
            }
        } catch (_e: Exception) {
        }
    }

    private fun closeFrameLog(delete: Boolean) {
        val out = frameLog
        val path = frameLogPath
        frameLog = null
        frameLogPath = ""
        framesSinceSync = 0
        if (out != null) {
            try {
                out.fd.sync()
            } catch (_e: Exception) {
            }
            try {
                out.close()
            } catch (_e: Exception) {
            }
        }
        if (delete && path.isNotEmpty()) {
            File(path).delete()
            val stem = if (path.endsWith(".frames")) path.removeSuffix(".frames") else path
            File("$stem.csd").delete()
        }
    }

    private fun preparePath(context: Context, localId: String, indexName: String): String? {
        val safeId = sanitize(localId)
        val safeIndex = sanitize(indexName)
        if (safeId.isEmpty() || safeIndex.isEmpty()) {
            return null
        }
        val dir = File(context.filesDir, "voice-notes/$safeId")
        if (!dir.exists() && !dir.mkdirs()) {
            return null
        }
        val file = File(dir, "$safeIndex.m4a")
        if (file.exists()) {
            file.delete()
        }
        return file.absolutePath
    }

    private fun sanitize(raw: String): String {
        return raw.replace("/", "_").replace("\\", "_").replace("..", "_").trim()
    }

    /**
     * 进程被杀掉时 MediaMuxer.stop() 没跑到，m4a 只有 ftyp 和 mdat。
     * 已经有 moov 的文件原样返回，不再按固定帧长重写。
     * 没有 moov 时用录制时记下的每帧长度补封口。
     */
    fun sealFile(path: String): String {
        val source = File(path)
        if (!source.isFile || source.length() < 16) {
            return "0:unreadable"
        }
        // 正常的录音文件 stop() 已经写过 moov，只读头尾确认一下就返回，
        // 绝不读整文件、更不重写，保证正常文件不会被再封一次。
        if (fileHasMoov(source)) {
            File("$path.frames").delete()
            File("$path.csd").delete()
            return "1"
        }
        // 补封口要把整个文件读进内存。太长的会话直接拒绝，避免 OOM 把进程拖垮
        // （OOM 是 Error 不是 Exception，下面的 catch 抓不住，会一路冒到引擎里变成裸 "0"）。
        if (source.length() > MAX_SEAL_BYTES) {
            return "0:toolarge"
        }
        val bytes = try {
            source.readBytes()
        } catch (_e: Throwable) {
            return "0:unreadable"
        }
        // 头尾没扫到 moov，再按完整 box 链兜一次底。
        if (mp4HasMoov(bytes) || mp4ContainsMoov(bytes)) {
            File("$path.frames").delete()
            File("$path.csd").delete()
            return "1"
        }
        val payload = mp4MdatPayload(bytes) ?: return "0:layout"
        if (payload.isEmpty()) {
            return "0:nomdat"
        }
        val sizes = readFrameSizes("$path.frames")
        if (sizes.isEmpty()) {
            return "0:nosizes"
        }
        // 帧日志每秒都 fsync，mdat 却是 MediaMuxer 内部缓冲、被 kill 时通常只剩一个前缀。
        // 残片不到预期的一半，说明音频基本没落盘，补出来只会是一段没有声音的 m4a。
        // 这种情况直接判失败，交给引擎重试/丢弃，绝不能当成补封口成功上传。
        var expected = 0
        for (size in sizes) {
            expected += size
        }
        if (expected <= 0) {
            return "0:nosizes"
        }
        if (payload.size * 2 < expected) {
            return "0:partial"
        }
        val csd = readCsd("$path.csd")
        val tmp = File("$path.sealed")
        if (tmp.exists()) {
            tmp.delete()
        }
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, SAMPLE_RATE, 1)
        format.setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        format.setInteger(MediaFormat.KEY_BIT_RATE, 64000)
        format.setInteger(MediaFormat.KEY_SAMPLE_RATE, SAMPLE_RATE)
        format.setInteger(MediaFormat.KEY_CHANNEL_COUNT, 1)
        format.setByteBuffer("csd-0", ByteBuffer.wrap(csd))
        val muxer = try {
            MediaMuxer(tmp.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)
        } catch (_e: Exception) {
            return "0:create"
        }
        try {
            val track = muxer.addTrack(format)
            muxer.start()
            val info = MediaCodec.BufferInfo()
            var offset = 0
            var index = 0
            while (index < sizes.size) {
                val size = sizes[index]
                if (size <= 0 || offset + size > payload.size) {
                    break
                }
                val packet = ByteBuffer.allocateDirect(size)
                packet.put(payload, offset, size)
                packet.flip()
                info.set(0, size, index * 1024L * 1000000L / SAMPLE_RATE, 0)
                muxer.writeSampleData(track, packet, info)
                offset += size
                index += 1
            }
            if (index <= 0) {
                throw IllegalStateException("no frame")
            }
            muxer.stop()
        } catch (_e: Exception) {
            try {
                muxer.release()
            } catch (_release: Exception) {
            }
            tmp.delete()
            return "0:write"
        }
        try {
            muxer.release()
        } catch (_e: Exception) {
        }
        val sealed = try {
            tmp.readBytes()
        } catch (_e: Throwable) {
            tmp.delete()
            return "0:verify"
        }
        if (!mp4HasMoov(sealed) && !mp4ContainsMoov(sealed)) {
            tmp.delete()
            return "0:verify"
        }
        val backup = File("$path.unsealed")
        if (backup.exists()) {
            backup.delete()
        }
        if (!source.renameTo(backup)) {
            tmp.delete()
            return "0:replace"
        }
        if (!tmp.renameTo(source)) {
            backup.renameTo(source)
            tmp.delete()
            return "0:replace"
        }
        backup.delete()
        File("$path.frames").delete()
        File("$path.csd").delete()
        return "1"
    }

    private fun readCsd(path: String): ByteArray {
        val file = File(path)
        if (!file.isFile || file.length() <= 0L || file.length() > 64L) {
            return byteArrayOf(0x14, 0x08)
        }
        return try {
            file.readBytes()
        } catch (_e: Exception) {
            byteArrayOf(0x14, 0x08)
        }
    }

    private fun readFrameSizes(path: String): IntArray {
        val file = File(path)
        if (!file.isFile || file.length() < 4) {
            return IntArray(0)
        }
        val raw = try {
            file.readBytes()
        } catch (_e: Exception) {
            return IntArray(0)
        }
        val count = raw.size / 4
        val sizes = IntArray(count)
        var kept = 0
        while (kept < count) {
            val pos = kept * 4
            val size = ((raw[pos].toInt() and 0xff) shl 24) or
                ((raw[pos + 1].toInt() and 0xff) shl 16) or
                ((raw[pos + 2].toInt() and 0xff) shl 8) or
                (raw[pos + 3].toInt() and 0xff)
            if (size <= 0 || size > 8192) {
                break
            }
            sizes[kept] = size
            kept += 1
        }
        if (kept <= 0) {
            return IntArray(0)
        }
        return sizes.copyOf(kept)
    }

    /**
     * 只读头尾判断 m4a 是否已经写过 moov，避免为了确认封口把整个文件读进内存。
     * MediaMuxer 的 moov 落在文件末尾；faststart 的落在开头。两段都扫，覆盖正常录音文件。
     */
    private fun fileHasMoov(file: File): Boolean {
        val size = file.length()
        if (size < 16) {
            return false
        }
        val raf = try {
            RandomAccessFile(file, "r")
        } catch (_e: Throwable) {
            return false
        }
        try {
            val headLen = if (size < 65536L) size.toInt() else 65536
            val head = ByteArray(headLen)
            raf.seek(0)
            val headGot = readFully(raf, head, headLen)
            if (headGot > 0 && mp4WindowHasMoov(head, 0, headGot)) {
                return true
            }
            val tailLen = if (size > 4194304L) 4194304 else size.toInt()
            val tail = ByteArray(tailLen)
            raf.seek(size - tailLen)
            val tailGot = readFully(raf, tail, tailLen)
            return tailGot > 0 && mp4WindowHasMoov(tail, 0, tailGot)
        } catch (_e: Throwable) {
            return false
        } finally {
            try {
                raf.close()
            } catch (_e: Throwable) {
            }
        }
    }

    /** 尽量读满 length 字节，返回实际读到的数量。 */
    private fun readFully(raf: RandomAccessFile, buffer: ByteArray, length: Int): Int {
        var got = 0
        while (got < length) {
            val n = try {
                raf.read(buffer, got, length - got)
            } catch (_e: Throwable) {
                break
            }
            if (n <= 0) {
                break
            }
            got += n
        }
        return got
    }

    private fun mp4HasMoov(bytes: ByteArray): Boolean {
        var pos = 0
        var steps = 0
        while (pos + 8 <= bytes.size && steps < 64) {
            steps += 1
            if (bytes[pos + 4] == 0x6d.toByte() && bytes[pos + 5] == 0x6f.toByte() &&
                bytes[pos + 6] == 0x6f.toByte() && bytes[pos + 7] == 0x76.toByte()
            ) {
                return true
            }
            val boxSize = mp4BoxSize(bytes, pos) ?: return false
            if (boxSize < 8 || pos + boxSize > bytes.size) {
                return false
            }
            pos += boxSize
        }
        return false
    }

    /** 走完仍没有 mdat 时返回空数组。尺寸读断、还没见到 mdat 时返回 null，不能当成没有音频。 */
    private fun mp4MdatPayload(bytes: ByteArray): ByteArray? {
        var pos = 0
        var steps = 0
        var broke = false
        while (pos + 8 <= bytes.size && steps < 64) {
            steps += 1
            val typeM = bytes[pos + 4] == 0x6d.toByte() && bytes[pos + 5] == 0x64.toByte() &&
                bytes[pos + 6] == 0x61.toByte() && bytes[pos + 7] == 0x74.toByte()
            val size32 = mp4Be32(bytes, pos)
            var header = 8
            var boxSize = size32
            if (size32 == 1) {
                if (pos + 16 > bytes.size || mp4Be32(bytes, pos + 8) != 0) {
                    if (typeM && pos + header < bytes.size) {
                        return bytes.copyOfRange(pos + header, bytes.size)
                    }
                    return null
                }
                boxSize = mp4Be32(bytes, pos + 12)
                header = 16
            } else if (size32 == 0 || size32 == -1) {
                boxSize = bytes.size - pos
            }
            if (typeM) {
                val start = pos + header
                var end = pos + boxSize
                if (boxSize < header || end > bytes.size) {
                    end = bytes.size
                }
                if (end <= start) {
                    return ByteArray(0)
                }
                return bytes.copyOfRange(start, end)
            }
            if (boxSize < 8 || pos + boxSize > bytes.size) {
                broke = true
                break
            }
            pos += boxSize
        }
        if (broke) {
            return null
        }
        return ByteArray(0)
    }

    /** mdat 长度写成 0 时，顺序扫描到不了末尾的 moov。只在头尾找带 mvhd 的 moov，避免把音频字节误认成索引。 */
    private fun mp4ContainsMoov(bytes: ByteArray): Boolean {
        if (mp4WindowHasMoov(bytes, 0, minOf(65536, bytes.size))) {
            return true
        }
        val tail = if (bytes.size > 4 * 1024 * 1024) bytes.size - 4 * 1024 * 1024 else 0
        return mp4WindowHasMoov(bytes, tail, bytes.size)
    }

    private fun mp4WindowHasMoov(bytes: ByteArray, from: Int, endAt: Int): Boolean {
        var pos = if (from < 0) 0 else from
        val end = if (endAt > bytes.size) bytes.size else endAt
        while (pos + 20 <= end) {
            val isMoov = bytes[pos + 4] == 0x6d.toByte() && bytes[pos + 5] == 0x6f.toByte() &&
                bytes[pos + 6] == 0x6f.toByte() && bytes[pos + 7] == 0x76.toByte()
            if (isMoov) {
                val header = if (mp4Be32(bytes, pos) == 1) 16 else 8
                val typeAt = pos + header + 4
                val isMvhd = typeAt + 4 <= bytes.size &&
                    bytes[typeAt] == 0x6d.toByte() && bytes[typeAt + 1] == 0x76.toByte() &&
                    bytes[typeAt + 2] == 0x68.toByte() && bytes[typeAt + 3] == 0x64.toByte()
                if (isMvhd) {
                    return true
                }
            }
            pos += 4
        }
        return false
    }

    private fun mp4BoxSize(bytes: ByteArray, pos: Int): Int? {
        val size32 = mp4Be32(bytes, pos)
        if (size32 == 1) {
            if (pos + 16 > bytes.size || mp4Be32(bytes, pos + 8) != 0) {
                return null
            }
            return mp4Be32(bytes, pos + 12)
        }
        if (size32 == 0) {
            return bytes.size - pos
        }
        return size32
    }

    private fun mp4Be32(bytes: ByteArray, pos: Int): Int {
        return ((bytes[pos].toInt() and 0xff) shl 24) or
            ((bytes[pos + 1].toInt() and 0xff) shl 16) or
            ((bytes[pos + 2].toInt() and 0xff) shl 8) or
            (bytes[pos + 3].toInt() and 0xff)
    }

    companion object {
        private const val SAMPLE_RATE = 16000
        /** 补封口整文件读进内存的上限。超过就不补，避免 OOM。 */
        private const val MAX_SEAL_BYTES = 256L * 1024L * 1024L

        @Volatile
        private var active: VoiceNoteM4aBridge? = null

        /** 用户划掉任务时由前台服务调用，把正在写的 m4a 封口并放开麦克风。 */
        @JvmStatic
        fun stopActive() {
            active?.stopSegment()
        }
    }
}
