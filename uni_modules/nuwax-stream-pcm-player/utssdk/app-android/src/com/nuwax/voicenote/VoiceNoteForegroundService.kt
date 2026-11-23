package com.nuwax.voicenote

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import java.io.File

/**
 * 伙伴页录音退后台继续采集。
 * Android 9 起后台麦克风必须挂 microphone 类型的前台服务，否则系统会停掉录音。
 * 写在 Kotlin 里：UTS 的 `extends Service` 会生成不带构造调用的父类声明，Release 编译直接失败。
 */
class VoiceNoteForegroundService : Service() {
    override fun onBind(intent: Intent?): IBinder? {
        return null
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val manager = getSystemService(NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(CHANNEL, "录音", NotificationManager.IMPORTANCE_DEFAULT)
            channel.description = "伙伴页录音在后台继续"
            manager.createNotificationChannel(channel)
        }
        var iconId = 17301659
        val info = applicationInfo
        if (info.icon > 0) {
            iconId = info.icon
        }
        val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification.Builder(this, CHANNEL)
                .setContentTitle("正在录音")
                .setContentText("退到后台后会继续录音，直到你停止")
                .setSmallIcon(iconId)
                .setOngoing(true)
                .build()
        } else {
            @Suppress("DEPRECATION")
            Notification.Builder(this)
                .setContentTitle("正在录音")
                .setContentText("退到后台后会继续录音，直到你停止")
                .setSmallIcon(iconId)
                .setOngoing(true)
                .build()
        }
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(
                NOTIFY_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE,
            )
        } else {
            startForeground(NOTIFY_ID, notification)
        }
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) {
        VoiceNoteM4aBridge.stopActive()
        VoiceNoteExitMark.mark(this)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        stopSelf()
        super.onTaskRemoved(rootIntent)
    }

    companion object {
        private const val CHANNEL = "nuwax_voice_note"
        private const val NOTIFY_ID = 24011
    }
}

/** 用户从最近任务划掉应用。进程不一定马上退出，回前台时凭这个标记结束本次录音。 */
object VoiceNoteExitMark {
    private const val NAME = "voice-note-task-removed"

    @JvmStatic
    fun mark(context: android.content.Context) {
        try {
            File(context.filesDir, NAME).writeText("1")
        } catch (_e: Exception) {
        }
    }

    @JvmStatic
    fun consume(context: android.content.Context): Boolean {
        val file = File(context.filesDir, NAME)
        if (!file.exists()) {
            return false
        }
        return file.delete()
    }
}
