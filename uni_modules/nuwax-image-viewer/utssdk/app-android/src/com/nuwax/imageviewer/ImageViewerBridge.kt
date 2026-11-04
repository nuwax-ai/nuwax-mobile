package com.nuwax.imageviewer

import android.annotation.SuppressLint
import android.app.Activity
import android.app.Dialog
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Path
import android.graphics.PointF
import android.graphics.RectF
import android.graphics.drawable.ColorDrawable
import android.view.GestureDetector
import android.view.Gravity
import android.view.KeyEvent
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
import java.io.File
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val SETTLE_DURATION = 220L
private const val CLOSE_DURATION = 240L
/** 手势/返回键关闭：系统边缘滑动自身已有返回动效，回缩只需一小段就收场，别拖满 240ms。 */
private const val FAST_CLOSE_DURATION = 130L
/** 手势关闭的动画终值：只走到回缩路程的 45%，在贴到缩略图前就 dismiss。 */
private const val FAST_CLOSE_STOP = 0.45f
private const val FAST_FADE_DURATION = 110L
/** 打开转场：黑底从透明渐亮到全黑（底下是会话页），与图片首帧渐显叠在一起，不再硬切出现。 */
private const val OPEN_FADE_DURATION = 300L
/** 图比整层淡入更晚就绪时补一小段渐显（正常情况下图随整层一起浮上来，不会走到这里）。 */
private const val REVEAL_DURATION = 140L

/** UTS 侧长按回调：确认弹窗与保存逻辑都在上层（uni.showActionSheet + savePreviewImageToAlbumInApp）。 */
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
 * Fresco 主磁盘缓存读取（纯优化，失败一律当未命中）。
 *
 * uni-app x Android 端的 `<image>` / `uni.previewImage` 都走 Fresco，图片编码落在
 * 主磁盘缓存（目录 uni-net-cache/image），缓存 key 就是 URL 原串——运行时自己的
 * ImageLoaderAdapter 也是用 `SimpleCacheKey(url)` 查主文件缓存。
 *
 * 因此聊天页缩略图刚展示过的图，点开全屏时可以零网络直接复用这份编码：
 * 首帧不再是黑屏 + 转圈等 downloadFile，而是接近秒开。
 *
 * 走反射而不是直接 import：本插件是独立的 uts 模块，编译 classpath 只有 subscaleview，
 * 不含 Fresco（那是 app 模块的依赖）。运行期 Fresco 一定在（`<image>` 就靠它），
 * 反射拿不到任何一环就当未命中，回落到 downloadFile。
 * 用「方法名 + 参数个数」找方法，避开泛型擦除后的签名差异。
 */
private object FrescoCacheAdapter {
    private fun methodOf(target: Any, name: String, argCount: Int): java.lang.reflect.Method? =
        try {
            target.javaClass.methods.firstOrNull { it.name == name && it.parameterTypes.size == argCount }
        } catch (t: Throwable) {
            null
        }

    fun cachedFile(url: String): File? {
        if (url.isEmpty()) return null
        return try {
            val frescoClass = Class.forName("com.facebook.drawee.backends.pipeline.Fresco")
            val factory = frescoClass.getMethod("getImagePipelineFactory").invoke(null) ?: return null
            val supplier = methodOf(factory, "getDiskCachesStoreSupplier", 0)?.invoke(factory) ?: return null
            val store = methodOf(supplier, "get", 0)?.invoke(supplier) ?: return null
            val cache = methodOf(store, "getMainFileCache", 0)?.invoke(store) ?: return null
            val enabled = methodOf(cache, "isEnabled", 0)?.invoke(cache) as? Boolean ?: false
            if (!enabled) return null
            val keyClass = Class.forName("com.facebook.cache.common.SimpleCacheKey")
            val key = keyClass.getConstructor(String::class.java).newInstance(url)
            val resource = methodOf(cache, "getResource", 1)?.invoke(cache, key) ?: return null
            val file = methodOf(resource, "getFile", 0)?.invoke(resource) as? File ?: return null
            // 空文件当作未命中（异常中断写入可能留下 0 字节条目）
            if (file.exists() && file.length() > 0L) file else null
        } catch (t: Throwable) {
            null
        }
    }
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
    private val originX: Number,
    private val originY: Number,
    private val originW: Number,
    private val originH: Number,
    private val fileProvider: ViewerFileProvider,
    private val saveCb: SaveRequestCallback
) {
    fun show(): Boolean {
        if (urls.isEmpty()) return false
        // 分块解码库（libs 里的 aar）只有自定义基座/正式包才有；标准基座下插件代码照样会被
        // 动态编译加载，但 aar 里的类找不到 → 构造 PageView 时 NoClassDefFoundError 直接崩。
        // 这里先探测，缺失就返回 false 交由上层回退系统 previewImage。
        if (!libAvailable()) return false
        ViewerDialog(
            activity,
            urls,
            startIndex.toInt(),
            // 缩略图在视口内的落点（px）；宽高非正=未测到 → 原生退化为淡出
            RectF(originX.toFloat(), originY.toFloat(),
                originX.toFloat() + originW.toFloat(), originY.toFloat() + originH.toFloat()),
            fileProvider,
            saveCb
        ).show()
        return true
    }

    private fun libAvailable(): Boolean {
        return try {
            Class.forName("com.davemorrissey.labs.subscaleview.SubsamplingScaleImageView", false,
                javaClass.classLoader)
            true
        } catch (t: Throwable) {
            false
        }
    }
}

private class ViewerDialog(
    activity: Activity,
    urls: List<String>,
    index: Int,
    exitRect: RectF,
    fileProvider: ViewerFileProvider,
    saveCb: SaveRequestCallback
) : Dialog(activity, android.R.style.Theme_Black_NoTitleBar_Fullscreen) {

    private val pager: PagerHost = PagerHost(activity, urls, index, exitRect, fileProvider, ::dismiss) { url ->
        // 长按即上报：确认弹窗在上层（uni.showActionSheet，dialogPage 为独立 Activity 窗口，
        // 可叠在本查看器之上），文案/i18n 随上层走，原生侧不再自带菜单（保存期间查看器保持打开）
        saveCb.onSaveRequested(url)
    }

    init {
        // 返回键/侧滑返回不直接 dismiss：先播「图片缩回缩略图原位置」的转场
        setCancelable(false)
        setContentView(
            pager,
            ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        )
        // 黑底改由 PagerHost 内的 scrim 承担（关闭时要单独渐隐，window 背景无法分层）
        window?.decorView?.setBackgroundColor(Color.TRANSPARENT)
        window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
        window?.setDimAmount(0f)
        // key 路径（含手势导航的返回）先到这里；onBackPressed 兜住其余派发路径
        setOnKeyListener { _, keyCode, event ->
            if (keyCode == KeyEvent.KEYCODE_BACK && event.action == KeyEvent.ACTION_UP) {
                pager.closeWithTransition(true)
                true
            } else {
                false
            }
        }
        setOnDismissListener { pager.release() }
    }

    override fun onBackPressed() {
        pager.closeWithTransition(true)
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
    private val exitRect: RectF,
    private val files: ViewerFileProvider,
    private val close: () -> Unit,
    private val save: (String) -> Unit
) : FrameLayout(context) {

    /** 打开时的那张图：翻页看过别的图后关闭就不再回缩（缩略图已不在当前视野）。 */
    private val openedIndex = startIndex.coerceIn(0, urls.size - 1)
    private var index = openedIndex
    private val pages = HashMap<Int, PageView>()       // 活动窗口 i-1..i+1
    private val fileCache = HashMap<String, String>()  // url → 已下载临时文件
    /** 黑底遮罩（独立一层）：关闭转场时只渐隐它，图片层才能缩小露到底下的会话页。 */
    private val scrim = View(context)
    private var closing = false
    private var opened = false
    private var downX = 0f
    private var downY = 0f
    private var lastX = 0f
    private var lastDx = 0f
    private var dragging = false
    private var settling = false
    private var animator: android.animation.ValueAnimator? = null
    private val slop = ViewConfiguration.get(context).scaledTouchSlop
    private val flickPx = 25f * resources.displayMetrics.density
    /** 关闭转场裁剪框（本地坐标）：终态裁到缩略图方框，与列表里 aspectFill 的裁切缩略图对齐。 */
    private val clipRect = RectF(0f, 0f, 0f, 0f)
    private val clipPath = Path()
    private var clipping = false
    /** 缩略图圆角（列表里 6px 逻辑 px）：转场中逐步收成圆角，终态才和缩略图严丝合缝。 */
    private val cornerPx = 6f * resources.displayMetrics.density

    init {
        setBackgroundColor(Color.TRANSPARENT)
        scrim.setBackgroundColor(Color.BLACK)
        alpha = 0f             // 整层从透明淡入（含黑底与图），见 playOpenTransition
        addView(scrim, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    /** 打开转场：整层（黑底 + 图）一起线性淡入，对齐 uni.previewImage。
     *
     *  DCloud 的 previewImage 不是自绘弹窗，而是
     *  `openDialogPage(url = "uni:previewImage", animationType = "fade-in")`——
     *  由框架做**整层一次性淡入**，并不存在「黑底先渐入、图片再单独渐显」两段。
     *  这里照着做：动的是 PagerHost 自身的 alpha，黑底与页内图片一起浮上来。
     */
    private fun playOpenTransition() {
        if (closing) {
            alpha = 1f
            return
        }
        val anim = android.animation.ValueAnimator.ofFloat(0f, 1f)
        anim.duration = OPEN_FADE_DURATION
        anim.interpolator = android.view.animation.LinearInterpolator()
        anim.addUpdateListener { a -> alpha = a.animatedValue as Float }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(a: android.animation.Animator) {
                alpha = 1f
                if (animator === a) animator = null
            }
        })
        animator = anim
        anim.start()
    }

    /** 只裁图片页，黑底不裁（否则黑背景只剩一小块方框）。 */
    override fun drawChild(canvas: Canvas, child: View, drawingTime: Long): Boolean {
        if (!clipping || child === scrim) return super.drawChild(canvas, child, drawingTime)
        val save = canvas.save()
        canvas.clipPath(clipPath)
        val drawn = super.drawChild(canvas, child, drawingTime)
        canvas.restoreToCount(save)
        return drawn
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        if (w > 0) {
            rebuild()
            // 首帧排版好后再起渐入，避免动画抢在窗口出现前跑完（等于没播）
            if (!opened) {
                opened = true
                post { playOpenTransition() }
            }
        }
    }

    fun release() {
        animator?.cancel()
        animator = null
        for ((_, p) in pages) {
            p.release()
        }
    }

    /**
     * 关闭转场：当前页的「可见图区」整体缩放+平移到缩略图落点（exitRect），同时黑底渐隐。
     * 放大态（不在最小缩放档）、图未就绪、未测到落点时退化为整体淡出；
     * 已翻页看过别的图则直接关闭（缩略图不在当前视野，回缩无处可去）。
     * 任何一种都是渐变，不再是改动前的硬切消失。
     *
     * @param fast 手势边缘滑动返回/返回键：只播一小段回缩就 dismiss（不必真落到缩略图上，
     *             系统返回手势自己已给了位移动效，拖满全程会明显发慢）；单击关闭仍走完整转场。
     */
    fun closeWithTransition(fast: Boolean = false) {
        if (closing) return
        closing = true
        animator?.cancel()
        alpha = 1f      // 打开淡入没跑完就被关闭：先补足，避免回缩/淡出全程半透明
        dragging = false
        // 已翻页看过别的图：缩略图不在当前视野，回缩无处可去 → 直接关，不做任何转场
        if (index != openedIndex) {
            close()
            return
        }
        val page = currentPage()
        val visible = page?.visibleImageRect()
        if (page == null || visible == null ||
            exitRect.width() < 1f || exitRect.height() < 1f || !canPage()
        ) {
            fadeOutAndClose(fast)
            return
        }
        // 落点来自 JS boundingClientRect＝逻辑 px(dp)，本层坐标是物理 px：
        // 先按 density 换算，再减窗口在屏幕上的原点（页面视口与屏幕同原点，窗口本身可能不从 (0,0) 起）
        val dm = resources.displayMetrics
        val loc = IntArray(2)
        getLocationOnScreen(loc)
        val target = RectF(
            exitRect.left * dm.density,
            exitRect.top * dm.density,
            exitRect.right * dm.density,
            exitRect.bottom * dm.density
        )
        target.offset(-loc[0].toFloat(), -loc[1].toFloat())
        // 邻页先藏（回缩只针对当前这张，否则边缘会带出半页邻图）
        for ((i, p) in pages) {
            if (i != index) p.visibility = View.INVISIBLE
        }
        val startCX = visible.centerX()
        val startCY = visible.centerY()
        val dx = target.centerX() - startCX
        val dy = target.centerY() - startCY
        // 等比缩放到「铺满」落点（cover）：列表缩略图是 aspectFill 方框裁切，
        // 若按各自轴向缩放会把横图压扁成方块，终态与缩略图对不上。
        val cover = max(target.width() / visible.width(), target.height() / visible.height())
        val viewW = width.toFloat()
        val viewH = height.toFloat()
        page.pivotX = startCX
        page.pivotY = startCY
        scrim.alpha = 1f
        // 先铺一版整屏裁剪路径再开裁剪：否则首帧（动画还没回填时）会裁成空路径，图片闪没一下
        clipRect.set(0f, 0f, viewW, viewH)
        clipPath.reset()
        clipPath.addRoundRect(clipRect, 0f, 0f, Path.Direction.CW)
        clipping = true
        // fast 只走到 FAST_CLOSE_STOP：图片缩到半路就消失，不等贴齐缩略图
        val endF = if (fast) FAST_CLOSE_STOP else 1f
        val anim = android.animation.ValueAnimator.ofFloat(0f, endF)
        anim.duration = if (fast) FAST_CLOSE_DURATION else CLOSE_DURATION
        anim.interpolator = DecelerateInterpolator(1.6f)
        anim.addUpdateListener { a ->
            val f = a.animatedValue as Float
            val s = 1f + (cover - 1f) * f
            page.scaleX = s
            page.scaleY = s
            page.translationX = dx * f
            page.translationY = dy * f
            // 裁剪框同步从整屏收到落点方框，圆角也从 0 收到缩略图圆角：
            // 终态与列表缩略图（150px + radius 6px）同形，dismiss 时才不会跳一下
            clipRect.set(
                target.left * f,
                target.top * f,
                viewW + (target.right - viewW) * f,
                viewH + (target.bottom - viewH) * f
            )
            val r = cornerPx * f
            clipPath.reset()
            clipPath.addRoundRect(clipRect, r, r, Path.Direction.CW)
            // 按归一化进度淡出黑底：fast 半途收场时黑底已归零，dismiss 时不会整块跳掉
            scrim.alpha = 1f - f / endF
        }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(a: android.animation.Animator) {
                animator = null
                // 终态那一帧要先真正绘出来再 dismiss，否则最后一帧被吃掉 → 落点瞬间跳一下
                postDelayed({ close() }, if (fast) 16 else 32)
            }
        })
        animator = anim
        anim.start()
    }

    /** 兜底关闭：整层淡出（放大态、图未就绪、测量不到落点）。 */
    private fun fadeOutAndClose(fast: Boolean = false) {
        val anim = android.animation.ValueAnimator.ofFloat(alpha, 0f)
        // 与打开同一条口径：uni.previewImage 关闭走 closeDialogPage(animationType = "fade-out")，
        // 是整层淡出，时长取与 fade-in 相同的 300ms、同样的线性曲线。
        anim.duration = if (fast) FAST_FADE_DURATION else OPEN_FADE_DURATION
        anim.interpolator = android.view.animation.LinearInterpolator()
        anim.addUpdateListener { a ->
            alpha = a.animatedValue as Float
        }
        anim.addListener(object : android.animation.AnimatorListenerAdapter() {
            override fun onAnimationEnd(a: android.animation.Animator) {
                animator = null
                close()
            }
        })
        animator = anim
        anim.start()
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
                // 单击关闭与返回手势同一转场（缩放回缩略图原位），不再硬切
                val created = PageView(context, { closeWithTransition() }, save, files, fileCache)
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
        if (closing) return false                        // 关闭转场中不再接管手势
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
        if (closing) return true
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
    /** 当前图取自 Fresco 磁盘缓存（不是我们下载的临时文件）：解码失败时可回落整段下载重试一次。 */
    private var frescoBacked = false
    /** 首帧渐显只播一次（相邻页预加载时也会走到 onReady，此时页面在屏外，播了也无感）。 */
    private var revealed = false

    init {
        setBackgroundColor(Color.TRANSPARENT)   // 黑底由 PagerHost 的 scrim 承担（关闭时要单独渐隐）
        ssiv.layoutParams = LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT)
        ssiv.setOrientation(SubsamplingScaleImageView.ORIENTATION_USE_EXIF)
        ssiv.setOnImageEventListener(object : SubsamplingScaleImageView.DefaultOnImageEventListener() {
            override fun onReady() {
                spinner.visibility = View.GONE      // 预览位图已上屏，清晰瓦片稍后流入
                revealFirstFrame()
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
                if (retryFromDownloadIfFresco()) return
                spinner.visibility = View.GONE
                errText.visibility = View.VISIBLE
            }

            override fun onPreviewLoadError(e: Exception?) {
                if (retryFromDownloadIfFresco()) return
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
        frescoBacked = false
        errText.visibility = View.GONE
        spinner.visibility = View.VISIBLE
        ssiv.recycle()
        // 上一张的渐显可能没跑完：一律拉回终态，新图重新从 onReady 起一段渐显
        ssiv.animate().cancel()
        ssiv.alpha = 1f
        revealed = false
        val cached = fileCache[newUrl]
        if (cached != null) {
            applyFile(cached)
            return
        }
        // 缩略图阶段 <image> 已把同一 URL 的原图编码写进 Fresco 主磁盘缓存：直接拿来解码，
        // 省掉一次分块解码前的整段下载（这条是「点开先黑屏再出图」的主要消除手段）。
        // 不写进 fileCache：那份缓存会随 Fresco LRU 淘汰，记下来早晚指向一个不存在的文件。
        val frescoCached = FrescoCacheAdapter.cachedFile(newUrl)
        if (frescoCached != null) {
            frescoBacked = true
            applyFile(frescoCached.getAbsolutePath())
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

    /** 首帧渐显（兜底）：图比整层淡入更晚就绪时，补一小段线性淡入，免得图「啪」地出现。
     *  图若在整层淡入期间就绪，直接返回——让 PagerHost 的整体 fade 带着图一起浮上来，
     *  与 previewImage 的一次整层 fade 保持一致（不再给图叠第二段动画）。 */
    private fun revealFirstFrame() {
        if (revealed) return
        revealed = true
        // 父层（PagerHost）仍在淡入中：这一次由整层负责
        if (((parent as? View)?.alpha ?: 1f) < 0.99f) return
        ssiv.alpha = 0f
        ssiv.animate()
            .alpha(1f)
            .setDuration(REVEAL_DURATION)
            .setInterpolator(android.view.animation.LinearInterpolator())
            .start()
    }

    /** Fresco 缓存文件解码失败（被 LRU 淘汰 / 写入半截）→ 丢掉它改走整段下载重试一次。
     *  成功接管返回 true；下载也失败则照常落到「加载失败，点击重试」。 */
    private fun retryFromDownloadIfFresco(): Boolean {
        if (!frescoBacked) return false
        frescoBacked = false
        val retryUrl = url
        spinner.visibility = View.VISIBLE
        errText.visibility = View.GONE
        post {
            if (url != retryUrl) return@post   // 期间已翻到别的图
            url = ""
            load(retryUrl)
        }
        return true
    }

    private fun applyFile(path: String) {
        fileUrl = path
        // 库无 uri(File) 工厂：统一转 file:// 字符串（库内 FILE_SCHEME 分支直读本地文件）
        val p = if (path.startsWith("file://")) path else "file://$path"
        ssiv.setMinimumScaleType(SubsamplingScaleImageView.SCALE_TYPE_CENTER_INSIDE)
        ssiv.setImage(ImageSource.uri(p))
    }

    /**
     * 当前可见图区（本页坐标=窗口坐标：页铺满且停靠 translationX=0）。
     * 关闭转场的起点：与屏幕求交，长图只取屏幕上真正看得见的那段。
     */
    fun visibleImageRect(): RectF? {
        if (!ssiv.isReady) return null
        // ImageState 只公开 getScale()（centerX/centerY 是私有字段），
        // 视图中心对应的源坐标走库的公开换算 API
        val s = ssiv.state?.scale ?: return null
        if (s <= 0f) return null
        val vw = width.toFloat()
        val vh = height.toFloat()
        if (vw <= 0f || vh <= 0f || ssiv.sWidth <= 0 || ssiv.sHeight <= 0) return null
        val halfW = vw / 2f
        val halfH = vh / 2f
        val center = ssiv.viewToSourceCoord(PointF(halfW, halfH)) ?: return null
        val left = (0f - center.x) * s + halfW
        val top = (0f - center.y) * s + halfH
        val right = (ssiv.sWidth.toFloat() - center.x) * s + halfW
        val bottom = (ssiv.sHeight.toFloat() - center.y) * s + halfH
        val l = max(0f, left)
        val t = max(0f, top)
        val r = min(vw, right)
        val b = min(vh, bottom)
        if (r - l < 1f || b - t < 1f) return null
        return RectF(l, t, r, b)
    }

    fun release() {
        ssiv.recycle()
    }
}
