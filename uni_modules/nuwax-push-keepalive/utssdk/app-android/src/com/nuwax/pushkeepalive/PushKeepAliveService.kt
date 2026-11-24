package com.nuwax.pushkeepalive

import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log

/**
 * 推送链路保活锚点（仅 Android，且仅在没有厂商推送通道的设备上启用）。
 *
 * 背景（详见 docs/engineering/push-swipe-kill-sticky-keepalive.md）：
 * 三星 One UI 从最近任务划掉 App 时，ActivityTaskSupervisor.killTaskProcessesIfPossible
 * 会按「包名」遍历全系统进程表，把同 uid 的所有进程一起 kill（reason = "remove task"），
 * :pushservice 也不例外。而 uni-push 的 UniPushService 继承的 com.igexin.sdk.PushService
 * 的 onStartCommand 里硬编码 return START_NOT_STICKY，AMS 不会重启它 —— 长连接断了就再也回不来。
 *
 * 本服务只做一件事：作为 START_STICKY 的锚点，被 kill 后由 AMS 自动重新拉起
 * :pushservice 进程，然后在进程里把 UniPushService 重新 start 起来，让个推 SDK 自己重连，
 * 服务端缓存的离线消息就能正常下发。
 *
 * 三条硬约束（改之前先读文档）：
 * 1. onStartCommand 必须返回 START_STICKY —— 这是整个方案生效的唯一原因。
 * 2. 不能对 UniPushService 用 startForegroundService：它不会在 5 秒内调 startForeground，
 *    会触发 RemoteServiceException 直接把进程崩掉。
 * 3. 不调用 startForeground：产品上不挂常驻通知（钉钉同样没有前台服务，靠的也是 STICKY）。
 */
class PushKeepAliveService : Service() {

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        ensureGeTuiOnline("onCreate")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        ensureGeTuiOnline("onStartCommand")
        return START_STICKY
    }

    /**
     * 对「走 stopService 而不是直接 kill 进程」的 ROM 兜底。
     * 三星这条路径不会走到这里（它是直接 killLocked），保留不影响。
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        super.onTaskRemoved(rootIntent)
        ensureGeTuiOnline("onTaskRemoved")
    }

    /**
     * 恢复个推在线状态。
     *
     * ★两步缺一不可（2026-11-24 真机实测）：
     *   只调 startService(UniPushService) 时，Android 会创建该 Service 对象，
     *   但 com.igexin.sdk.PushService.onCreate 内部先判 com.igexin.push.g.f.a()，
     *   返回 false 就跳过 PushCoreLoader.init —— 表现为进程活着、服务也绑上了，
     *   但一条个推日志都没有、长连接没建立、离线推送收不到。
     *   个推的完整初始化入口是 PushManager.getInstance().initialize(context)，
     *   平时由 uni-push 的 JS 层（uni.getPushClientId）触发；进程被拉活时 JS 没跑，
     *   所以必须在这里显式补上。
     *
     * 反射调用而不是直接引用：避免本模块编译期依赖 uni-push 的 aar。
     * 两个调用都是幂等的，重复执行无副作用。
     */
    private fun ensureGeTuiOnline(tag: String) {
        // ① 官方初始化入口：装载 PushCore（建长连接的前提）
        try {
            val cls = Class.forName("com.igexin.sdk.PushManager")
            val instance = cls.getMethod("getInstance").invoke(null)
            cls.getMethod("initialize", Context::class.java)
                .invoke(instance, applicationContext)
            Log.i(TAG, "$tag: Getui PushManager.initialize ok")
        } catch (t: Throwable) {
            Log.w(TAG, "$tag: Getui PushManager.initialize failed: ${t.message}")
        }
        // ② 显式拉起长连接服务（initialize 内部通常也会启动，这里兜底）
        try {
            val intent = Intent()
            intent.setClassName(packageName, GETUI_SERVICE)
            startService(intent)
            Log.i(TAG, "$tag: start Getui PushService ok")
        } catch (t: Throwable) {
            // 后台启动限制（BackgroundServiceStartNotAllowedException）或服务不存在时静默失败，
            // 绝不能因为保活服务抖动影响推送主链路。
            Log.w(TAG, "$tag: start Getui PushService failed: ${t.message}")
        }
    }

    companion object {
        private const val TAG = "NuwaxPushKeepAlive"
        private const val GETUI_SERVICE = "uts.sdk.modules.DCloudUniPush.UniPushService"
    }
}
