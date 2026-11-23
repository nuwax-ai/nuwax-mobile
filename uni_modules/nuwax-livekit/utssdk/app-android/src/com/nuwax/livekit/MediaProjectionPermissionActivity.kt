package com.nuwax.livekit

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.media.projection.MediaProjectionConfig
import android.os.Build
import android.os.Bundle

/** Transparent activity used to obtain a fresh MediaProjection grant per share attempt. */
class MediaProjectionPermissionActivity : Activity() {
  private var owner: MeetingRoomBridge? = null
  private var requestID = 0
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    owner = MeetingRoomBridge.current()
    requestID = intent.getIntExtra("requestID", -1)
    // 系统旋转/重建授权 Activity 时保留原授权请求，不能重复创建录屏会话。
    if (savedInstanceState != null) return
    val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    // 会议共享的是整块屏幕；Android 14+ 显式请求默认显示器，避免误选「仅此应用」。
    val intent = if (Build.VERSION.SDK_INT >= 34) {
      manager.createScreenCaptureIntent(MediaProjectionConfig.createConfigForDefaultDisplay())
    } else {
      manager.createScreenCaptureIntent()
    }
    try {
      startActivityForResult(intent, REQUEST_CODE)
    } catch (_: Exception) {
      owner?.completeScreenCapture(requestID, Activity.RESULT_CANCELED, null)
      finish()
    }
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode == REQUEST_CODE) {
      owner?.completeScreenCapture(requestID, resultCode, data)
      finish()
    }
  }

  companion object {
    private const val REQUEST_CODE = 4711
  }
}
