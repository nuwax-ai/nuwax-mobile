package com.nuwax.livekit

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle

/** Transparent activity used to obtain a fresh MediaProjection grant per share attempt. */
class MediaProjectionPermissionActivity : Activity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val manager = getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
    startActivityForResult(manager.createScreenCaptureIntent(), REQUEST_CODE)
  }

  override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.onActivityResult(requestCode, resultCode, data)
    if (requestCode == REQUEST_CODE) {
      MeetingRoomBridge.completeScreenCapture(resultCode, data)
      finish()
    }
  }

  companion object {
    private const val REQUEST_CODE = 4711
  }
}
