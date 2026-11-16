package com.nuwax.voicenote

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import java.io.File

/**
 * 伙伴页录音。MediaRecorder 直接写 MPEG-4 / AAC，不经过 PCM 文件，也不走 StreamPcmRecorder。
 */
class VoiceNoteM4aBridge {
    private var recorder: MediaRecorder? = null

    fun startSegment(context: Context, localId: String, indexName: String): String {
        stopQuiet()
        val safeId = sanitize(localId)
        val safeIndex = sanitize(indexName)
        if (safeId.isEmpty() || safeIndex.isEmpty()) {
            return ""
        }
        val dir = File(context.filesDir, "voice-notes/$safeId")
        if (!dir.exists() && !dir.mkdirs()) {
            return ""
        }
        val file = File(dir, "$safeIndex.m4a")
        if (file.exists()) {
            file.delete()
        }
        val created = try {
            if (Build.VERSION.SDK_INT >= 31) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
        } catch (_e: Exception) {
            return ""
        }
        try {
            created.setAudioSource(MediaRecorder.AudioSource.MIC)
            created.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            created.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            created.setAudioSamplingRate(16000)
            created.setAudioChannels(1)
            created.setAudioEncodingBitRate(64000)
            created.setOutputFile(file.absolutePath)
            created.prepare()
            created.start()
            recorder = created
            return file.absolutePath
        } catch (_e: Exception) {
            try {
                created.reset()
            } catch (_reset: Exception) {
            }
            created.release()
            return ""
        }
    }

    fun stopSegment(): String {
        val current = recorder ?: return "0"
        recorder = null
        return try {
            current.stop()
            current.release()
            "1"
        } catch (_e: Exception) {
            try {
                current.reset()
            } catch (_reset: Exception) {
            }
            try {
                current.release()
            } catch (_release: Exception) {
            }
            "0"
        }
    }

    private fun stopQuiet() {
        val current = recorder ?: return
        recorder = null
        try {
            current.stop()
        } catch (_e: Exception) {
        }
        try {
            current.release()
        } catch (_e: Exception) {
        }
    }

    private fun sanitize(raw: String): String {
        val cleaned = raw.replace("/", "_").replace("\\", "_").replace("..", "_")
        return cleaned.trim()
    }
}
