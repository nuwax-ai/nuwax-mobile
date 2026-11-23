package com.nuwax.livekit

import android.app.Activity
import android.app.PictureInPictureParams
import android.graphics.Color
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.TextView
import io.livekit.android.renderer.SurfaceViewRenderer

/** 随会议生命周期挂到业务 Activity：App 内小窗 + 退后台系统 PiP。无额外悬浮权限。 */
class MeetingFloatingWindow(private val bridge: MeetingRoomBridge) {
  private var activity: Activity? = null
  private var root: FrameLayout? = null
  private var renderer: SurfaceViewRenderer? = null
  private var pageVisible = true
  private var foreground = true
  private var wasInPip = false
  @Volatile private var restoreRequested = false
  private val handler = Handler(Looper.getMainLooper())
  private val refresh = object : Runnable {
    override fun run() {
      val host = activity ?: return
      if (!bridge.isConnected() || host.isDestroyed) { stop(); return }
      val inPip = Build.VERSION.SDK_INT >= 26 && host.isInPictureInPictureMode
      if (inPip != wasInPip) {
        if (wasInPip && !inPip && foreground) restoreRequested = true
        wasInPip = inPip
        layout()
      }
      if (inPip) {
        // PiP 进入和拖动调整尺寸均可晚于生命周期回调，按宿主当前尺寸补布局。
        val parent = root?.parent as? ViewGroup
        if (parent != null && (root?.width != parent.width || root?.height != parent.height)) layout()
      }
      renderer?.let { bridge.updatePipRenderer(it) }
      handler.postDelayed(this, 300)
    }
  }

  fun setPresentation(host: Activity, pageVisible: Boolean, foreground: Boolean) {
    if (activity !== host) {
      stop()
      activity = host
    }
    this.pageVisible = pageVisible
    this.foreground = foreground
    if (root == null) attach(host)
    layout()
    if (Build.VERSION.SDK_INT >= 31) {
      try {
        host.setPictureInPictureParams(PictureInPictureParams.Builder()
          .setAspectRatio(Rational(16, 10)).setAutoEnterEnabled(true).build())
      } catch (_: Exception) {}
    }
    if (!foreground && Build.VERSION.SDK_INT >= 26 && !host.isInPictureInPictureMode && !bridge.isScreenSharePending()) {
      // 在仍可见的 Activity 离开前请求；失败不重开 Activity、不打断当前会议。
      try {
        host.enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 10)).build())
      } catch (_: Exception) {}
    }
  }

  private fun attach(host: Activity) {
    val parent = host.window.decorView as? ViewGroup ?: return
    val box = FrameLayout(host)
    box.setBackgroundColor(Color.BLACK)
    box.elevation = 32f
    box.addView(TextView(host).apply {
      text = "会议进行中"; setTextColor(Color.WHITE); textSize = 13f; gravity = Gravity.CENTER
    }, FrameLayout.LayoutParams(-1, -1))
    renderer = bridge.createPipRenderer(host)
    renderer?.let { box.addView(it, FrameLayout.LayoutParams(-1, -1)) }
    var downX = 0f
    var downY = 0f
    var initialX = 0f
    var initialY = 0f
    box.setOnTouchListener { _, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX; downY = event.rawY; initialX = box.x; initialY = box.y
        }
        MotionEvent.ACTION_MOVE -> {
          box.x = (initialX + event.rawX - downX).coerceIn(0f, (parent.width - box.width).coerceAtLeast(0).toFloat())
          box.y = (initialY + event.rawY - downY).coerceIn(0f, (parent.height - box.height).coerceAtLeast(0).toFloat())
        }
        MotionEvent.ACTION_UP -> {
          if (kotlin.math.abs(event.rawX - downX) < 10 && kotlin.math.abs(event.rawY - downY) < 10) restoreRequested = true
        }
      }
      true
    }
    parent.addView(box, ViewGroup.LayoutParams(1, 1))
    root = box
    handler.post(refresh)
  }

  private fun layout() {
    val host = activity ?: return
    val box = root ?: return
    val parent = box.parent as? ViewGroup ?: return
    val inPip = Build.VERSION.SDK_INT >= 26 && host.isInPictureInPictureMode
    val show = inPip || !pageVisible || !foreground
    box.visibility = if (show) View.VISIBLE else View.GONE
    val density = host.resources.displayMetrics.density
    val width = if (inPip) parent.width else (160 * density).toInt()
    val height = if (inPip) parent.height else (100 * density).toInt()
    box.layoutParams = box.layoutParams.apply { this.width = width; this.height = height }
    box.x = if (inPip) 0f else (parent.width - width - 16 * density).coerceAtLeast(0f)
    box.y = if (inPip) 0f else (parent.height - height - 110 * density).coerceAtLeast(0f)
    if (show) box.bringToFront()
  }

  fun consumeRestoreRequest(): Boolean {
    val value = restoreRequested
    restoreRequested = false
    return value
  }

  fun stop() {
    handler.removeCallbacksAndMessages(null)
    if (Build.VERSION.SDK_INT >= 31) {
      try { activity?.setPictureInPictureParams(PictureInPictureParams.Builder().setAutoEnterEnabled(false).build()) } catch (_: Exception) {}
    }
    renderer?.let { bridge.releasePipRenderer(it) }
    (root?.parent as? ViewGroup)?.removeView(root)
    root = null
    renderer = null
    activity = null
    restoreRequested = false
    wasInPip = false
  }
}
