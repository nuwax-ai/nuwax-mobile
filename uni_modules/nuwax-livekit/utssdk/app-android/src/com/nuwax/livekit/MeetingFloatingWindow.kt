package com.nuwax.livekit

import android.app.Activity
import android.app.AlertDialog
import android.app.Application
import android.app.KeyguardManager
import android.app.PictureInPictureParams
import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.ViewConfiguration
import android.view.WindowManager

/** App 内与桌面使用同一个边沿入口；桌面窗口不依赖被最近任务移除的 Activity。 */
class MeetingFloatingWindow(private val bridge: MeetingRoomBridge) {
  private var application: Application? = null
  private var activity: Activity? = null
  private var root: View? = null
  private var overlay: View? = null
  private var overlayParams: WindowManager.LayoutParams? = null
  private var permissionDialog: AlertDialog? = null
  private var edgePosition = 0.68f
  private var pageVisible = true
  private var foreground = true
  private var overlayStatus = "idle"
  private val visibleActivities = mutableSetOf<Activity>()
  @Volatile private var restoreRequested = false
  private val handler = Handler(Looper.getMainLooper())
  private val lifecycle = object : Application.ActivityLifecycleCallbacks {
    override fun onActivityPaused(host: Activity) {}
    override fun onActivityResumed(host: Activity) {
      foreground = true
      hideOverlay()
      // uni-app x 页面可能属于不同宿主 Activity。跟随当前业务宿主迁移入口，
      // 不挂到通知跳板或录屏权限 Activity 上。
      if (isBusinessActivity(host)) {
        if (activity !== host) {
          detachActivity()
          activity = host
          attach(host)
        }
        refreshAutoEnter()
        layout()
      }
    }
    override fun onActivityDestroyed(host: Activity) {
      visibleActivities.remove(host)
      if (host === activity) {
        detachActivity()
        activity = null
      }
      scheduleBackground()
    }
    override fun onActivityCreated(host: Activity, state: Bundle?) {}
    override fun onActivityStarted(host: Activity) {
      visibleActivities.add(host)
      foreground = true
      hideOverlay()
    }
    override fun onActivityStopped(host: Activity) {
      visibleActivities.remove(host)
      scheduleBackground()
    }
    override fun onActivitySaveInstanceState(host: Activity, state: Bundle) {}
  }
  private val parentLayoutListener = View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> layout() }
  private val refresh = object : Runnable {
    override fun run() {
      if (!bridge.isConnected()) { stop(); return }
      syncOverlay()
      // 新页面原生视图可能晚于 onResume 加入 decor；保持入口位于业务内容上方。
      if (foreground) layout()
      if (foreground && pageVisible) activity?.let { host ->
        if (!host.isFinishing && !host.isDestroyed) explainOverlayPermission(host)
      }
      handler.postDelayed(this, 500)
    }
  }

  fun setPresentation(currentActivity: Activity?, pageVisible: Boolean, foreground: Boolean) {
    // 页面切换时 UTS 的 currentActivity 可能仍是旧页面；优先使用已恢复且有焦点的宿主。
    val resumed = activity?.takeIf { foreground && !it.isDestroyed && !it.isFinishing && it.hasWindowFocus() }
    val host = resumed ?: currentActivity?.takeUnless { it.isDestroyed || it.isFinishing || !isBusinessActivity(it) }
    if (application == null && host != null) {
      application = host.application
      host.application.registerActivityLifecycleCallbacks(lifecycle)
      visibleActivities.add(host)
      MeetingForegroundService.floatingWindow = this
      handler.post(refresh)
    }
    if (host != null && activity !== host) {
      detachActivity()
      activity = host
      attach(host)
    }
    this.pageVisible = pageVisible
    // onHide 也可能是权限页/页面跳转，后台以所有 Activity 的可见性为准。
    if (foreground) this.foreground = true
    layout()
    refreshAutoEnter()
    if (!foreground) scheduleBackground() else hideOverlay()
    if (foreground && pageVisible && host != null) explainOverlayPermission(host)
  }

  private fun isBusinessActivity(host: Activity): Boolean {
    var type: Class<*>? = host.javaClass
    while (type != null) {
      // 首页与普通页面不是父子关系：详情页/会议页继承 UniPageActivity。
      if (type.name == "io.dcloud.uniapp.UniAppActivity" ||
          type.name == "io.dcloud.uniapp.appframe.activity.UniPageActivity") return true
      type = type.superclass
    }
    return false
  }

  private fun scheduleBackground() {
    handler.postDelayed({
      foreground = visibleActivities.isNotEmpty()
      layout()
      syncOverlay()
    }, 250)
  }

  /** 仍有前台服务/原生 Room 时，移除任务不能销毁桌面入口。 */
  fun onTaskRemoved() {
    visibleActivities.clear()
    foreground = false
    layout()
    syncOverlay()
  }

  /** 保留桥接调用入口，但会议不再自动进入黑色系统画中画。 */
  fun refreshAutoEnter() {
    if (Build.VERSION.SDK_INT >= 31) {
      try { activity?.setPictureInPictureParams(PictureInPictureParams.Builder().setAutoEnterEnabled(false).build()) }
      catch (_: Exception) {}
    }
  }

  private fun overlayAllowed(context: Context): Boolean = Build.VERSION.SDK_INT < 23 || Settings.canDrawOverlays(context)

  private fun explainOverlayPermission(host: Activity) {
    if (overlayAllowed(host) || bridge.isScreenSharePending() || !host.hasWindowFocus()) return
    val prefs = host.getSharedPreferences("meeting_window", Context.MODE_PRIVATE)
    if (prefs.getBoolean("overlay_explained", false) || permissionDialog != null) return
    // 仅首次说明；拒绝后不反复打断入会，仍可从系统通知返回会议。
    val dialog = AlertDialog.Builder(host)
      .setTitle("开启会议悬浮窗")
      .setMessage("允许“显示在其他应用上层”后，切到桌面或其他应用时也能看到会议图标，点击即可返回会议。不开启也可通过通知返回会议。")
      .setNegativeButton("暂不开启", null)
      .setPositiveButton("去设置") { _, _ ->
        try { host.startActivity(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + host.packageName))) }
        catch (_: Exception) { Log.w("MeetingWindow", "overlay settings unavailable") }
      }.create()
    dialog.setOnDismissListener { permissionDialog = null }
    try {
      dialog.show()
      permissionDialog = dialog
      prefs.edit().putBoolean("overlay_explained", true).apply()
    } catch (_: Exception) { Log.w("MeetingWindow", "permission explanation unavailable") }
  }

  fun diag(): String = "window[state=$overlayStatus,page=$pageVisible,foreground=$foreground,overlay=${overlay != null}]"

  private class EdgeHandle(context: Context) : View(context) {
    private val pen = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.rgb(128, 128, 128); style = Paint.Style.STROKE; strokeWidth = 1.8f
      strokeCap = Paint.Cap.ROUND; strokeJoin = Paint.Join.ROUND
    }
    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      val size = 22f * resources.displayMetrics.density
      canvas.save()
      canvas.translate((width - size) / 2f, (height - size) / 2f)
      canvas.scale(size / 24f, size / 24f)
      canvas.drawCircle(9f, 7f, 4f, pen)
      canvas.drawPath(Path().apply {
        moveTo(16f, 21f); lineTo(16f, 19f)
        cubicTo(16f, 16.79f, 14.21f, 15f, 12f, 15f); lineTo(6f, 15f)
        cubicTo(3.79f, 15f, 2f, 16.79f, 2f, 19f); lineTo(2f, 21f)
        moveTo(22f, 21f); lineTo(22f, 19f)
        cubicTo(22f, 17.17f, 20.77f, 15.58f, 19f, 15.13f)
        moveTo(16f, 3.13f); cubicTo(20f, 4.16f, 20f, 9.84f, 16f, 10.87f)
      }, pen)
      canvas.restore()
    }
  }

  private fun makeHandle(context: Context, restore: () -> Unit): View {
    val handle = EdgeHandle(context).apply {
      val radius = 16f * resources.displayMetrics.density
      background = GradientDrawable().apply {
        setColor(Color.WHITE)
        setStroke((resources.displayMetrics.density).toInt().coerceAtLeast(1), Color.rgb(232, 232, 232))
        cornerRadii = floatArrayOf(radius, radius, 0f, 0f, 0f, 0f, radius, radius)
      }
      contentDescription = "返回会议，可上下拖动"
      isFocusable = true
      isClickable = true
      elevation = 8f * resources.displayMetrics.density
      setOnClickListener { restore() }
    }
    var downX = 0f
    var downY = 0f
    var initialPosition = 0f
    var dragged = false
    val touchSlop = ViewConfiguration.get(context).scaledTouchSlop
    handle.setOnTouchListener { view, event ->
      when (event.actionMasked) {
        MotionEvent.ACTION_DOWN -> {
          downX = event.rawX; downY = event.rawY; initialPosition = edgePosition; dragged = false
        }
        MotionEvent.ACTION_MOVE -> {
          if (kotlin.math.abs(event.rawX - downX) > touchSlop || kotlin.math.abs(event.rawY - downY) > touchSlop) dragged = true
          if (dragged) {
            val density = context.resources.displayMetrics.density
            val height = (view.parent as? ViewGroup)?.height ?: context.resources.displayMetrics.heightPixels
            val available = (height - 120 * density).coerceAtLeast(1f)
            edgePosition = (initialPosition + (event.rawY - downY) / available).coerceIn(0f, 1f)
            layout()
            updateOverlayPosition()
          }
        }
        MotionEvent.ACTION_UP -> if (!dragged) view.performClick()
      }
      true
    }
    return handle
  }

  private fun attach(host: Activity) {
    val parent = host.window.decorView as? ViewGroup ?: return
    MeetingReturnRequest.rememberTask(host.taskId)
    Log.i("MeetingWindow", "attach host=${host.javaClass.simpleName} task=${host.taskId}")
    val handle = makeHandle(host) {
      restoreRequested = true
      Log.i("MeetingWindow", "restore source=in_app host=${host.javaClass.simpleName}")
    }
    handle.visibility = View.GONE
    parent.addView(handle, ViewGroup.LayoutParams(1, 1))
    root = handle
    parent.addOnLayoutChangeListener(parentLayoutListener)
  }

  private fun layout() {
    val box = root ?: return
    val parent = box.parent as? ViewGroup ?: return
    box.visibility = if (foreground && !pageVisible) View.VISIBLE else View.GONE
    val density = box.resources.displayMetrics.density
    val width = (36 * density).toInt()
    val height = (64 * density).toInt()
    if (box.layoutParams.width != width || box.layoutParams.height != height) {
      box.layoutParams = box.layoutParams.apply { this.width = width; this.height = height }
    }
    box.x = (parent.width - width).coerceAtLeast(0).toFloat()
    box.y = 28 * density + (parent.height - height - 56 * density).coerceAtLeast(0f) * edgePosition
    if (box.visibility == View.VISIBLE) box.bringToFront()
  }

  private fun syncOverlay() {
    val app = application ?: return
    val locked = (app.getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.isKeyguardLocked == true
    if (foreground || !bridge.isConnected() || locked || bridge.isScreenSharePending() || !overlayAllowed(app)) {
      hideOverlay()
      overlayStatus = if (!overlayAllowed(app)) "permission_required" else "hidden"
      return
    }
    if (overlay != null) { updateOverlayPosition(); return }
    val session = MeetingReturnRequest.begin()
    val handle = makeHandle(app) {
      // 优先恢复原任务，不启动 Launcher 重排到消息首页；通知复用同一入口。
      if (bridge.isConnected()) MeetingReturnRequest.open(app, session)
    }
    val density = app.resources.displayMetrics.density
    @Suppress("DEPRECATION")
    val type = if (Build.VERSION.SDK_INT >= 26) WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY else WindowManager.LayoutParams.TYPE_PHONE
    val params = WindowManager.LayoutParams((36 * density).toInt(), (64 * density).toInt(), type,
      WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
      PixelFormat.TRANSLUCENT).apply { gravity = Gravity.TOP or Gravity.RIGHT }
    try {
      (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager).addView(handle, params)
      overlay = handle
      overlayParams = params
      overlayStatus = "visible"
      updateOverlayPosition()
    } catch (error: Exception) {
      if (overlayStatus != "denied") Log.w("MeetingWindow", "overlay unavailable: " + error.javaClass.simpleName)
      overlayStatus = "denied"
    }
  }

  private fun updateOverlayPosition() {
    val app = application ?: return
    val view = overlay ?: return
    val params = overlayParams ?: return
    val metrics = app.resources.displayMetrics
    val y = (28 * metrics.density + (metrics.heightPixels - 120 * metrics.density).coerceAtLeast(0f) * edgePosition).toInt()
    if (params.y == y) return
    params.y = y
    try { (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager).updateViewLayout(view, params) }
    catch (_: Exception) { hideOverlay() }
  }

  private fun hideOverlay() {
    val app = application
    val view = overlay
    if (app != null && view != null) {
      try { (app.getSystemService(Context.WINDOW_SERVICE) as WindowManager).removeViewImmediate(view) }
      catch (_: Exception) {}
    }
    overlay = null
    overlayParams = null
  }

  private fun detachActivity() {
    permissionDialog?.dismiss()
    permissionDialog = null
    (root?.parent as? ViewGroup)?.let { it.removeOnLayoutChangeListener(parentLayoutListener); it.removeView(root) }
    root = null
  }

  fun consumeRestoreRequest(): Boolean {
    val value = restoreRequested
    restoreRequested = false
    return value
  }

  fun stop() {
    handler.removeCallbacksAndMessages(null)
    refreshAutoEnter()
    hideOverlay()
    detachActivity()
    application?.unregisterActivityLifecycleCallbacks(lifecycle)
    application = null
    activity = null
    visibleActivities.clear()
    restoreRequested = false
    overlayStatus = "idle"
    if (MeetingForegroundService.floatingWindow === this) MeetingForegroundService.floatingWindow = null
  }
}
