package com.nuwax.livekit

import android.app.Activity
import android.app.ActivityManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import java.util.UUID

/** 通知直达 Activity，不能用广播/Service 作为拉起 App 的通知跳板。 */
class MeetingReturnActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    MeetingReturnRequest.open(this, intent.getStringExtra("meetingSession") ?: "")
    finish()
  }
}

/** 仅在内存保存本场会议返回意图；离会后旧通知不能跳入下一场会议。 */
internal object MeetingReturnRequest {
  private var session = ""
  private var pending = false
  private var hostTaskId = -1
  @Synchronized fun rememberTask(taskId: Int) { hostTaskId = taskId }
  @Synchronized fun begin(): String {
    if (session.isEmpty()) session = UUID.randomUUID().toString()
    return session
  }
  @Synchronized fun request(value: String): Boolean {
    if (session.isEmpty() || value != session) return false
    pending = true
    return true
  }
  @Suppress("DEPRECATION")
  fun open(context: Context, value: String) {
    if (MeetingRoomBridge.current()?.isConnected() != true || !request(value)) return
    try {
      val manager = context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val taskId = synchronized(this) { hostTaskId }
      val task = manager.appTasks.firstOrNull {
        val info = it.taskInfo
        // 通知跳板可能已进入同一个 task；只有仍有业务 Activity 时才恢复它。
        info.id == taskId && (info.topActivity?.className != MeetingReturnActivity::class.java.name || info.numActivities > 1)
      }
      if (task != null) {
        task.moveToFront()
        Log.i("MeetingWindow", "restore source=external target=existing_task")
        return
      }
    } catch (error: Exception) {
      Log.w("MeetingWindow", "restore task unavailable: ${error.javaClass.simpleName}")
    }
    // 最近任务确实被移除才冷启。返回请求保留到业务运行时恢复当前 Room 后消费。
    try {
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let { launch ->
        launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP
        context.startActivity(launch)
        Log.i("MeetingWindow", "restore source=external target=new_task")
      }
    } catch (error: Exception) {
      Log.w("MeetingWindow", "restore launch unavailable: ${error.javaClass.simpleName}")
    }
  }
  // Activity / 业务运行时重建期间可重复读取，直到会议页 onShow 确认。
  @Synchronized fun peek(): Boolean = pending
  @Synchronized fun acknowledge() { pending = false }
  @Synchronized fun clear() { session = ""; pending = false; hostTaskId = -1 }
}
