package com.nuwax.imageviewer

import android.annotation.SuppressLint
import android.app.Activity
import android.app.AlertDialog
import android.app.Dialog
import android.content.Context
import android.graphics.Color
import android.graphics.PointF
import android.view.GestureDetector
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.ViewConfiguration
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.widget.FrameLayout
import android.widget.ProgressBar
import android.widget.TextView
import com.davemorrissey.labs.subscaleview.ImageSource
import com.davemorrissey.labs.subscaleview.SubsamplingScaleImageView
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val SETTLE_DURATION = 220L

/** UTS 侧保存回调：鉴权下载与入相册逻辑留在上层（savePreviewImageToAlbumInApp）。 */
interface SaveRequestCallback {
    fun onSaveRequested(url: String)
}

/** 取图结果：path=本地临时文件路径（file:// 前缀可带）。 */
interface FileResultCallback {
    fun onFileReady(url: String, path: String)
    fun onFileFailed(url: String, message: String)
}

/**
 * UTS 侧取图入口：上层用 uni.downloadFile 落临时文件（App 同一网络栈与鉴权规则），
 * 规避 ImageSource.uri 直连的 TLS/UA/相对路径差异（首轮真机直连全数失败）。
 */
interface ViewerFileProvider {
    fun fetchFile(url: String, cb: FileResultCallback)
}

/**
 * 全屏原生图片查看器入口（UTS 桥）。
 * 核心：SubsamplingScaleImageView 分块按需解码——3 万 px 长图 / 80MP 巨图都不会
 * 整张解码上纹理，深放文字不糊、内存恒定（uni.previewImage 按一屏元素解码+CSS
 * 缩放必糊；uni-app x `<image>` 自绘路线上限约 36MP，再大 @load/@error 均不回）。
 */
class ImageViewerBridge(
    private val activity: Activity,
    private val urls: MutableList<String>,
    private val startIndex: Number,
    private val fileProvider: ViewerFileProvider,
    private val saveCb: SaveRequestCallback
) {
    fun show() {
        if (urls.isEmpty()) return
        ViewerDialog(activity, urls, startIndex.toInt(), fileProvider, saveCb).show()
    }
}

private class ViewerDialog(
    activity: Activity,
    urls: List<String>,
    index: Int,
    fileProvider: ViewerFileProvider,
    saveCb: SaveRequestCallback
) : Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen) {

    private val pager: PagerHost = PagerHost(activity, urls, index, fileProvider, ::dismiss) { url ->
        // 长按先确认再保存（保存期间查看器保持打开）
        AlertDialog.Builder(activity)
            .setItems(arrayOf("保存图片")) { _, _ -> saveCb.onSaveRequested(url) }
            .setNegativeButton("取消", null)
            .show()
    }

    init {
        setContentView(
            pager,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        window?.decorView?.setBackgroundColor(Color.BLACK)
        setOnDismissListener { pager.release() }
    }

    override fun show() {
        super.show()
        window?.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
    }
}

/**
 * 三页窗口连播容器（i-1 / i / i+1 常驻，各自 translationX 停靠整屏宽）：
 * 前后邻页始终保活——回滑零重载零闪动；换页只平移、页实例不动；窗口外的页回收。
 * url→临时文件做会话级缓存，滑远再回来不重复下载。
 * 手势分工：双指缩放/双击/图内平移=子 view 内建；最小缩放档且横移为主时父层拦截接管
 * 翻页；单击关闭/长按保存=子 view 外挂 detector（返回 false 不劫持内建手势）。
 */
private class PagerHost(
    context: Context,
    private val urls: List<String>,
    startIndex: Int,
    private val files: ViewerFileProvider,
    private val close: () -> Unit,
    private val save: (String) -> Unit
) : FrameLayout(context) {

    private var index = startIndex.coerceIn(0, urls.size - 1)
    private val pages = HashMap<Int, PageView>()       // 活动窗口 i-1..i+1
    private val fileCache = HashMap<String, String>()  // url → 已下载临时文件
    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastDx = 0f
    private var dragging = false
    private var settling = false
    private var animator: android.animation.ValueAnimator? = null
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private val flickPx = 25f * resources.displayMetrics.density

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w > 0) rebuild()
    }

    fun release() {
        animator?.cancel()
        animator = null
        for ((_, p) in pages) {
            p.release()
        }
    }

    private fun currentPage(): PageView? = pages[index]

    /** 窗口对齐：只保 i-1..i+1 三页；窗口外页卸载回收。新页延迟 250ms 装载，让当前图先下载。 */
    private fun rebuild() {
        val drop = pages.keys.filter { it < index - 1 || it > index + 1 }
        for (k in drop) {
            val p = pages.remove(k)
            if (p != null) {
                removeView(p)
                p.release()
            }
        }
        val w = width.toFloat()
        for (d in -1..1) {
            val i = index + d
            if (i !in urls.indices) continue
            var p = pages[i]
            if (p == null) {
                val created = PageView(context, close, save, files, fileCache)
                pages[i] = created
                addView(created, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
                val u = urls[i]
                if (d == 0) created.load(u) else postDelayed({ created.load(u) }, 250)
                p = created
            }
            p.translationX = d * w
        }
    }

    private fun canPage(): Boolean {
        val ssiv = currentPage()?.ssiv ?: return true
        if (!ssiv.isReady) return true
        val st = ssiv.state ?: return true
        return st.scale <= ssiv.minScale * 1.02f
    }

    private fun applyDrag(dx: Float) {
        val w = width.toFloat()
        // 拖拽方向无邻页（列表端点）：只有当前页阻尼跟手，其余停原位
        val hasSide = pages.containsKey(index + if (dx > 0) -1 else 1)
        for ((i, p) in pages) {
            p.translationX = if (hasSide) (i - index) * w + dx
                else if (i == index) dx * 0.25f
                else (i - index) * w
        }
    }

    private fun settleDrag(dx: Float) {
        val dir = if (dx > 0) -1 else 1
        val commitOk = pages.containsKey(index + dir) &&
            (abs(dx) > width * 0.25f || abs(lastDx) > flickPx)
        animateSettle(if (commitOk) dir else 0)
    }

    /** commit=0 回弹；±1 收拢换页（页实例不动，只动 translationX=零重载零闪动）。 */
    private fun animateSettle(commit: Int) {
        animator?.cancel()
        settling = true
        val w = width.toFloat()
        val targets = ArrayList<Pair<PageView, Float>>()
        for ((i, p) in pages) {
            targets.add(Pair(p, (i - index - commit) * w))
        }
        val starts = targets.map { it.first.translationX }
        val anim = android.animation.ValueAnimator.ofFloat(0f, 1f)
        anim.duration = SETTLE_DURATION
        anim.interpolator = DecelerateInterpolator(1.6f)
        anim.addUpdateListener { a ->
            val f = a.animatedValue as Float
            for (k in targets.indices) {
                targets[k].first.translationX = starts[k] + (targets[k].second - starts[k]) * f
            }
        }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(a: android.animation.Animator) {
                settling = false
                animator = null
                if (commit != 0) {
                    index += commit
                    rebuild()
                }
            }
        })
        animator = anim
        anim.start()
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = ev.x
                downY = ev.y
                lastX = ev.x
                lastDx = 0f
                if (settling) {
                    animator?.end()                    // 收拢中触摸=跳终态
                    return true
                }
            }
            MotionEvent.ACTION_MOVE -> {
                if (!dragging && !settling) {
                    val dx = ev.x - downX
                    val dy = ev.y - downY
                    if (abs(dx) > slop * 2 && abs(dx) > abs(dy) * 1.5f && canPage()) {
                        dragging = true
                        applyDrag(dx)
                        return true
                    }
                }
            }
        }
        return false
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(ev: MotionEvent): Boolean {
        when (ev.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                downX = ev.x
                downY = ev.y
                lastX = ev.x
                lastDx = 0f
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (!dragging && !settling) {
                    val dx = ev.x - downX
                    val dy = ev.y - downY
                    if (abs(dx) > slop * 2 && abs(dx) > abs(dy) * 1.5f && canPage()) {
                        dragging = true
                    }
                }
                if (dragging) {
                    lastDx = ev.x - lastX
                    lastX = ev.x
                    applyDrag(ev.x - downX)
                }
            }
            MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                if (dragging) {
                    dragging = false
                    settleDrag(ev.x - downX)
                }
            }
        }
        return true
    }
}

/** 单页：SubsamplingScaleImageView + 居中 loading + 错误重试文案。 */
private class PageView(
    context: Context,
    private val close: () -> Unit,
    private val save: (String) -> Unit,
    private val files: ViewerFileProvider,
    private val fileCache: MutableMap<String, String>
) : FrameLayout(context) {

    val ssiv = SubsamplingScaleImageView(context)
    private val spinner = ProgressBar(context)
    private val errText = TextView(context)
    private var url = ""
    private var fileUrl = ""

    init {
        setBackgroundColor(Color.BLACK)
        ssiv.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        ssiv.setOrientation(SubsamplingScaleImageView.ORIENTATION_USE_EXIF)
        ssiv.setOnImageEventListener(object : SubsamplingScaleImageView.DefaultOnImageEventListener() {
            override fun onReady() {
                spinner.visibility = View.GONE      // 预览位图已上屏，清晰瓦片稍后流入
                val sW = ssiv.sWidth
                val sH = ssiv.sHeight
                if (sW <= 0 || sH <= 0 || width <= 0 || height <= 0) return
                // 与屏幕动态比：图比屏瘦长 → 全宽顶对齐+竖向滚动（微信同款，杜绝左右黑边）；
                // 否则整图可见居中（横图上下留黑属正常观感）
                if (sH.toFloat() / sW.toFloat() > height.toFloat() / width.toFloat()) {
                    val fitW = width.toFloat() / sW.toFloat()
                    val maxS = max(fitW * 8f, 3f)
                    ssiv.setMinimumScaleType(SubsamplingScaleImageView.SCALE_TYPE_CUSTOM)
                    ssiv.setMinScale(fitW)
                    ssiv.setMaxScale(maxS)
                    ssiv.setDoubleTapZoomScale(min(fitW * 3f, maxS))
                    val cy = (height / 2f) / fitW   // 顶对齐：视图中心对应的源坐标 y
                    ssiv.setScaleAndCenter(fitW, PointF(0f, cy))
                } else {
                    val mn = ssiv.minScale
                    if (mn > 0f) {
                        ssiv.setMaxScale(mn * 4f)
                        ssiv.setDoubleTapZoomScale(mn * 2.5f)
                    }
                }
            }

            override fun onImageLoadError(e: Exception?) {
                spinner.visibility = View.GONE
                errText.visibility = View.VISIBLE
            }

            override fun onPreviewLoadError(e: Exception?) {
                spinner.visibility = View.GONE
                errText.visibility = View.VISIBLE
            }
        })
        addView(ssiv)

        spinner.layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        addView(spinner)

        errText.text = "加载失败，点击重试"
        errText.setTextColor(Color.WHITE)
        errText.textSize = 15f
        errText.gravity = Gravity.CENTER
        val pad = (16f * resources.displayMetrics.density).toInt()
        errText.setPadding(pad * 2, pad, pad * 2, pad)
        errText.layoutParams = LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT, Gravity.CENTER)
        errText.visibility = View.GONE
        errText.setOnClickListener { if (url.isNotEmpty()) load(url) }
        addView(errText)

        // 单击关闭/长按保存：外挂 detector 只在手势成立时消费，其余回落 ssv 内建处理
        val gd = GestureDetector(context, object : GestureDetector.SimpleOnGestureListener() {
            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                close()
                return true
            }

            override fun onLongPress(e: MotionEvent) {
                if (url.isNotEmpty()) save(url)
            }
        })
        ssiv.setOnTouchListener { _, e -> gd.onTouchEvent(e) }
    }

    fun load(newUrl: String) {
        if (newUrl == url && errText.visibility != View.VISIBLE) return   // 已载或下载中
        url = newUrl
        fileUrl = ""
        errText.visibility = View.GONE
        spinner.visibility = View.VISIBLE
        ssiv.recycle()
        val cached = fileCache[newUrl]
        if (cached != null) {
            applyFile(cached)
            return
        }
        files.fetchFile(url, object : FileResultCallback {
            override fun onFileReady(u: String, path: String) {
                if (u != url) return                                         // 已换目标的过期回调
                fileCache[u] = path
                applyFile(path)
            }

            override fun onFileFailed(u: String, message: String) {
                if (u != url) return
                spinner.visibility = View.GONE
                errText.text = if (message.isEmpty()) "加载失败，点击重试" else "加载失败，点击重试\n$message"
                errText.visibility = View.VISIBLE
            }
        })
    }

    private fun applyFile(path: String) {
        fileUrl = path
        // 库无 uri(File) 工厂：统一转 file:// 字符串（库内 FILE_SCHEME 分支直读本地文件）
        val p = if (path.startsWith("file://")) path else "file://$path"
        ssiv.setMinimumScaleType(SubsamplingScaleImageView.SCALE_TYPE_CENTER_INSIDE)
        ssiv.setImage(ImageSource.uri(p))
    }

    fun release() {
        ssiv.recycle()
    }
}
