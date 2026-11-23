package com.nuwax.livekit

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import java.util.UUID

/** 通知直达 Activity，不能用广播/Service 作为拉起 App 的通知跳板。 */
class MeetingReturnActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    MeetingReturnRequest.request(intent.getStringExtra("meetingSession") ?: "")
    packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
      launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
      startActivity(launch)
    }
    finish()
  }
}

/** 仅在内存保存本场会议返回意图；离会后旧通知不能跳入下一场会议。 */
internal object MeetingReturnRequest {
  private var session = ""
  private var pending = false
  @Synchronized fun begin(): String {
    if (session.isEmpty()) session = UUID.randomUUID().toString()
    return session
  }
  @Synchronized fun request(value: String) {
    if (session.isNotEmpty() && value == session) pending = true
  }
  @Synchronized fun consume(): Boolean {
    val value = pending
    pending = false
    return value
  }
  @Synchronized fun clear() { session = ""; pending = false }
}
