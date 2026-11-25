package com.nuwax.pushkeepalive

import android.app.Service
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import com.igexin.sdk.PushManager

/**
 * 非厂商通道的恢复入口。STICKY 只请求系统重建服务，不保证重启时间或联网。
 * 在主进程调用官方初始化入口；无 Activity 收包/展示由 DCloud 回调桥处理。
 * 不使用 PushCoreLoader 等私有入口，不把普通 UniPushService 当作前台服务启动。
 */
class PushKeepAliveService : Service() {
    private val handler = Handler(Looper.getMainLooper())
    private var lastRequestedAt = 0L
    private var retryCount = 0
    private val retry = Runnable { requestPushConnection("retry") }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!PushDeliverySession.isEnabled(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        requestPushConnection(if (intent == null) "sticky-restart" else "start")
        return START_STICKY
    }

    // 这是任务移除回调，不是 stopService/force-stop 的通用兜底。
    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        requestPushConnection("task-removed")
    }

    override fun onDestroy() {
        handler.removeCallbacks(retry)
        super.onDestroy()
    }

    private fun requestPushConnection(reason: String) {
        if (!PushDeliverySession.isEnabled(this)) {
            handler.removeCallbacks(retry)
            stopSelf()
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (lastRequestedAt > 0 && now - lastRequestedAt < 10_000L) return
        if (reason != "retry") retryCount = 0
        handler.removeCallbacks(retry)
        try {
            PushRuntime.installDCloudBridge(applicationContext)
            PushManager.getInstance().initialize(applicationContext)
            val service = startService(Intent().setClassName(packageName, GETUI_SERVICE))
            check(service != null) { "Getui service was not resolved" }
            lastRequestedAt = now
            retryCount = 0
        } catch (error: Exception) {
            Log.w(TAG, "connection request failed reason=$reason type=${error.javaClass.simpleName}")
            // 仅重试明确失败；不无限拉活、不轮询 SDK 私有状态。下次前台调用仍可再试。
            if (retryCount < 3) {
                retryCount++
                handler.postDelayed(retry, retryCount * 5_000L)
            }
        }
    }

    companion object {
        private const val TAG = "NuwaxPushKeepAlive"
        private const val GETUI_SERVICE = "uts.sdk.modules.DCloudUniPush.UniPushService"
    }
}
