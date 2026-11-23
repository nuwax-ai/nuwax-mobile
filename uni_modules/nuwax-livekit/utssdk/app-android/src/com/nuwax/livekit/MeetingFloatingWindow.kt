package com.nuwax.livekit

import android.app.Activity
import android.app.Application
import android.app.KeyguardManager
import android.app.PictureInPictureParams
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Rational
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewConfiguration
import android.widget.FrameLayout
import android.widget.TextView
import io.livekit.android.renderer.SurfaceViewRenderer

/** 随会议生命周期挂到业务 Activity：App 内小窗 + 退后台系统 PiP。无额外悬浮权限。 */
class MeetingFloatingWindow(private val bridge: MeetingRoomBridge) {
  private var activity: Activity? = null
  private var root: FrameLayout? = null
  private var renderer: SurfaceViewRenderer? = null
  private var pipContent: FrameLayout? = null
  private var edgeHandle: View? = null
  private var edgePosition = 0.68f
  private var leaveListenerAttached = false
  private var pipRequestPending = false
  private var pipStatus = "idle"
  private var pageVisible = true
  private var foreground = true
  private var wasInPip = false
  @Volatile private var restoreRequested = false
  private val handler = Handler(Looper.getMainLooper())
  private val leaveListener = Runnable { requestPip("user_leave") }
  private val lifecycle = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityPaused(host: Activity) {
      // 旧宿主没有 user-leave 监听时，在 onStop / App.onHide 之前请求 PiP。
      if (host === activity && !leaveListenerAttached && Build.VERSION.SDK_INT < 31) requestPip("pause")
    }
    override fun onActivityResumed(host: Activity) {
      if (host !== activity) return
      foreground = true
      pipRequestPending = false
      if (wasInPip && (Build.VERSION.SDK_INT < 26 || !host.isInPictureInPictureMode)) restoreRequested = true
      layout()
    }
    override fun onActivityDestroyed(host: Activity) { if (host === activity) stop() }
    override fun onActivityCreated(host: Activity, state: Bundle?) {}
    override fun onActivityStarted(host: Activity) {}
    override fun onActivityStopped(host: Activity) {}
    override fun onActivitySaveInstanceState(host: Activity, state: Bundle) {}
  }
  private val parentLayoutListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> layout() }
  private val refresh = object : Runnable {
    override fun run() {
      val host = activity ?: return
      if (!bridge.isConnected() || host.isDestroyed) { stop(); return }
      val inPip = Build.VERSION.SDK_INT >= 26 && host.isInPictureInPictureMode
      if (inPip != wasInPip) {
        if (wasInPip && !inPip && foreground) restoreRequested = true
        wasInPip = inPip
        if (inPip) { pipStatus = "active"; pipRequestPending = false }
        layout()
      }
      if (inPip) {
        // PiP 进入和拖动调整尺寸均可晚于生命周期回调，按宿主当前尺寸补布局。
        val parent = root?.parent as? ViewGroup
        if (parent != null && (root?.width != parent.width || root?.height != parent.height)) layout()
      }
      if (inPip) renderer?.let { bridge.updatePipRenderer(it) }
      handler.postDelayed(this, 300)
    }
  }

  fun setPresentation(currentActivity: Activity?, pageVisible: Boolean, foreground: Boolean) {
    val host = currentActivity ?: activity ?: return
    if (activity !== host) {
      stop()
      activity = host
      host.application.registerActivityLifecycleCallbacks(lifecycle)
      // 部分 HX 宿主基于 ComponentActivity；反射让旧宿主无需升级 AndroidX 仍可运行。
      leaveListenerAttached = try {
        host.javaClass.getMethod("addOnUserLeaveHintListener", Runnable::class.java).invoke(host, leaveListener)
        true
      } catch (_: ReflectiveOperationException) { false }
    }
    this.pageVisible = pageVisible
    this.foreground = foreground
    if (root == null) attach(host)
    layout()
    refreshAutoEnter()
    if (!foreground) requestPip("app_hide")
  }

  fun refreshAutoEnter() {
    val host = activity ?: return
    if (Build.VERSION.SDK_INT >= 31 && host.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
      try {
        host.setPictureInPictureParams(PictureInPictureParams.Builder()
          .setAspectRatio(Rational(16, 10)).setAutoEnterEnabled(!bridge.isScreenSharePending()).build())
      } catch (error: Exception) { recordPipFailure(error.javaClass.simpleName) }
    }
  }

  private fun requestPip(reason: String) {
    val host = activity ?: return
    if (!bridge.isConnected() || host.isFinishing || host.isDestroyed || host.isChangingConfigurations ||
        bridge.isScreenSharePending() || pipRequestPending) return
    if (Build.VERSION.SDK_INT < 26 || !host.packageManager.hasSystemFeature(PackageManager.FEATURE_PICTURE_IN_PICTURE)) {
      recordPipFailure("unsupported"); return
    }
    if (host.isInPictureInPictureMode) return
    val keyguard = host.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager
    if (keyguard?.isKeyguardLocked == true) return
    try {
      val entered = host.enterPictureInPictureMode(PictureInPictureParams.Builder().setAspectRatio(Rational(16, 10)).build())
      pipRequestPending = entered
      pipStatus = if (entered) "requested" else "denied"
      Log.i("MeetingPiP", "$reason result=$pipStatus host=${host.javaClass.name}")
      if (entered) layout()
    } catch (error: Exception) { recordPipFailure(error.javaClass.simpleName) }
  }

  private fun recordPipFailure(reason: String) {
    if (pipStatus != reason) Log.w("MeetingPiP", "unavailable=$reason host=${activity?.javaClass?.name}")
    pipStatus = reason
  }

  fun diag(): String = "pip[state=$pipStatus,leaveHook=${if (leaveListenerAttached) 1 else 0}]"

  private class EdgeHandle(context: Context) : View(context) {
    private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE; style = Paint.Style.STROKE; strokeWidth = 2f * resources.displayMetrics.density
      strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      val unit = resources.displayMetrics.density
      for (offset in floatArrayOf(-4.5f, 4.5f)) {
        val x = width / 2f + offset * unit
        canvas.drawPath(Path().apply {
          moveTo(x + 2.5f * unit, height / 2f - 5f * unit)
          lineTo(x - 2.5f * unit, height / 2f)
          lineTo(x + 2.5f * unit, height / 2f + 5f * unit)
        }, pen)
      }
    }
  }

  private fun attach(host: Activity) {
    val parent = host.window.decorView as? ViewGroup ?: return
    val box = FrameLayout(host)
    box.elevation = 32f
    val content = FrameLayout(host).apply { setBackgroundColor(Color.BLACK) }
    content.addView(TextView(host).apply {
      text = "会议进行中"; setTextColor(Color.WHITE); textSize = 13f; gravity = Gravity.CENTER
    }, FrameLayout.LayoutParams(-1, -1))
    renderer = bridge.createPipRenderer(host)
    renderer?.let { content.addView(it, FrameLayout.LayoutParams(-1, -1)) }
    box.addView(content, FrameLayout.LayoutParams(-1, -1))
    pipContent = content
    val handle = EdgeHandle(host).apply {
      val radius = 16f * resources.displayMetrics.density
      background = GradientDrawable().apply {
        setColor(Color.rgb(29, 30, 33))
        cornerRadii = floatArrayOf(radius, radius, 0f, 0f, 0f, 0f, radius, radius)
      }
      contentDescription = "返回会议，可上下拖动"
      isFocusable = true
      isClickable = true
      setOnClickListener { restoreRequested = true }
    }
    edgeHandle = handle
    box.addView(handle, FrameLayout.LayoutParams(-1, -1))
    var downX = 0f
    var downY = 0f
    var initialY = 0f
    var dragged = false
    val touchSlop = ViewConfiguration.get(host).scaledTouchSlop
    handle.setOnTouchListener { view, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX; downY = event.rawY; initialY = box.y; dragged = false
        }
        MotionEvent.ACTION_MOVE -> {
          if (kotlin.math.abs(event.rawX - downX) > touchSlop || kotlin.math.abs(event.rawY - downY) > touchSlop) dragged = true
          if (dragged) {
            val margin = 28f * host.resources.displayMetrics.density
            val available = (parent.height - box.height - 2 * margin).coerceAtLeast(1f)
            edgePosition = ((initialY + event.rawY - downY - margin) / available).coerceIn(0f, 1f)
            layout()
          }
        }
        MotionEvent.ACTION_UP -> {
          if (!dragged) view.performClick()
        }
      }
      true
    }
    parent.addView(box, ViewGroup.LayoutParams(1, 1))
    root = box
    parent.addOnLayoutChangeListener(parentLayoutListener)
    handler.post(refresh)
  }

  private fun layout() {
    val host = activity ?: return
    val box = root ?: return
    val parent = box.parent as? ViewGroup ?: return
    val inPip = Build.VERSION.SDK_INT >= 26 && host.isInPictureInPictureMode
    val show = inPip || !pageVisible
    box.visibility = if (show) View.VISIBLE else View.GONE
    pipContent?.visibility = if (inPip) View.VISIBLE else View.GONE
    edgeHandle?.visibility = if (inPip) View.GONE else View.VISIBLE
    val density = host.resources.displayMetrics.density
    val width = if (inPip) parent.width else (36 * density).toInt()
    val height = if (inPip) parent.height else (64 * density).toInt()
    if (box.layoutParams.width != width || box.layoutParams.height != height) {
      box.layoutParams = box.layoutParams.apply { this.width = width; this.height = height }
    }
    box.x = if (inPip) 0f else (parent.width - width).coerceAtLeast(0).toFloat()
    box.y = if (inPip) 0f else 28 * density + (parent.height - height - 56 * density).coerceAtLeast(0f) * edgePosition
    if (show) box.bringToFront()
  }

  fun consumeRestoreRequest(): Boolean {
    val value = restoreRequested
    restoreRequested = false
    return value
  }

  fun stop() {
    handler.removeCallbacksAndMessages(null)
    val host = activity
    host?.application?.unregisterActivityLifecycleCallbacks(lifecycle)
    if (host != null && leaveListenerAttached) {
      try { host.javaClass.getMethod("removeOnUserLeaveHintListener", Runnable::class.java).invoke(host, leaveListener) }
      catch (_: ReflectiveOperationException) {}
    }
    leaveListenerAttached = false
    pipRequestPending = false
    if (Build.VERSION.SDK_INT >= 31) {
      try { activity?.setPictureInPictureParams(PictureInPictureParams.Builder().setAutoEnterEnabled(false).build()) } catch (_: Exception) {}
    }
    renderer?.let { bridge.releasePipRenderer(it) }
    (root?.parent as? ViewGroup)?.let { it.removeOnLayoutChangeListener(parentLayoutListener); it.removeView(root) }
    pipContent = null
    edgeHandle = null
    root = null
    renderer = null
    activity = null
    restoreRequested = false
    wasInPip = false
    pipStatus = "idle"
  }
}
