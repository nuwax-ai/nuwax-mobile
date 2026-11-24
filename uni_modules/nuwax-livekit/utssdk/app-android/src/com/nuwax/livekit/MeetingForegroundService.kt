package com.nuwax.livekit

import android.Manifest
import android.app.*
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/** 只在用户入会且 App 在前台时启动。录屏另由 SDK 的 mediaProjection 服务承载。 */
class MeetingForegroundService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null
  override fun onTaskRemoved(rootIntent: Intent?) {
    super.onTaskRemoved(rootIntent)
    floatingWindow?.onTaskRemoved()
  }

  override fun onDestroy() {
    floatingWindow?.stop()
    super.onDestroy()
  }
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "进行中的会议", NotificationManager.IMPORTANCE_LOW))
    }
    val session = MeetingReturnRequest.begin()
    val launch = Intent(this, MeetingReturnActivity::class.java)
      .putExtra("meetingSession", session)
      .setData(android.net.Uri.parse("nuwax-meeting://resume/" + session))
    val pending = PendingIntent.getActivity(this, NOTIFICATION_ID, launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    val notification = builder.setSmallIcon(android.R.drawable.ic_menu_call)
      .setContentTitle("会议进行中").setContentText("点击返回会议")
      .setCategory(Notification.CATEGORY_CALL).setOngoing(true).setContentIntent(pending).build()
    try {
      if (Build.VERSION.SDK_INT >= 29) {
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        if (Build.VERSION.SDK_INT >= 30 && checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) {
          types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        startForeground(NOTIFICATION_ID, notification, types)
      } else startForeground(NOTIFICATION_ID, notification)
    } catch (_: Exception) { stopSelf() }
    // 不在用户划掉进程后偷偷重建会议或重复录屏授权。
    return START_NOT_STICKY
  }

  companion object {
    // 仅持有当前原生会议入口；Activity 销毁不销毁桌面悬浮窗，服务结束必须移除。
    internal var floatingWindow: MeetingFloatingWindow? = null
    private const val CHANNEL = "NuwaxMeetingOngoing"
    private const val NOTIFICATION_ID = 4712
    fun start(context: Context) {
      try {
        val intent = Intent(context, MeetingForegroundService::class.java)
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent) else context.startService(intent)
      } catch (_: Exception) {
        android.util.Log.w("MeetingBridge", "background meeting service unavailable")
      }
    }
    fun stop(context: Context) {
      MeetingReturnRequest.clear()
      context.stopService(Intent(context, MeetingForegroundService::class.java))
    }
  }
}
