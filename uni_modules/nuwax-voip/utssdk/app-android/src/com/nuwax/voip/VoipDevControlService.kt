package com.nuwax.voip

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/** Declared only by the dedicated Debug test host's generated manifest. */
class VoipDevControlService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!VoipBridge.developmentListenerAllowed(this) || intent?.action == "stop") {
            stopSelf()
            return START_NOT_STICKY
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel(CHANNEL, VoipBridge.label("testListenerTitle"), NotificationManager.IMPORTANCE_LOW))
        val open = packageManager.getLaunchIntentForPackage(packageName)!!
        val content = PendingIntent.getActivity(this, 9093, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val stop = PendingIntent.getService(this, 9094, Intent(this, VoipDevControlService::class.java).setAction("stop"), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val notification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.sym_call_incoming)
            .setContentTitle(VoipBridge.label("testListenerTitle"))
            .setContentText(VoipBridge.label("testListenerNotification"))
            .setContentIntent(content)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(0, VoipBridge.label("testListenerStop"), stop)
            .build()
        if (Build.VERSION.SDK_INT >= 34) startForeground(9093, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        else startForeground(9093, notification)
        running = true
        return START_NOT_STICKY
    }

    override fun onTaskRemoved(rootIntent: Intent?) { stopSelf() }
    override fun onDestroy() {
        running = false
        stopForeground(STOP_FOREGROUND_REMOVE)
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "nuwax-voip-dev-listener"
        var running = false
            private set
    }
}
