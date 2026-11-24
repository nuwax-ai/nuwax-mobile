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
        try {
            if (muxerStarted) {
                muxer?.stop()
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

    companion object {
        private const val SAMPLE_RATE = 16000

        @Volatile
        private var active: VoiceNoteM4aBridge? = null

        /** 用户划掉任务时由前台服务调用，把正在写的 m4a 封口并放开麦克风。 */
        @JvmStatic
        fun stopActive() {
            active?.stopSegment()
        }
    }
}
