package com.nuwax.pullaction

import android.content.Context
import android.graphics.Color
import android.os.SystemClock
import android.util.Log
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import com.scwang.smart.refresh.layout.SmartRefreshLayout
import com.scwang.smart.refresh.layout.api.RefreshHeader
import com.scwang.smart.refresh.layout.api.RefreshLayout
import com.scwang.smart.refresh.layout.constant.RefreshState
import com.scwang.smart.refresh.layout.constant.SpinnerStyle
import com.scwang.smart.refresh.layout.simple.SimpleComponent
import com.scwang.smart.refresh.layout.simple.SimpleMultiListener
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private const val PULL_ACTION_TRIGGER_RATE = 1.15f
private const val PULL_ACTION_MIN_DRAG_DURATION_MS = 180L

interface PullActionCallback {
    fun onProgress(distance: Double, dragging: Boolean)
    fun onTriggered()
    fun onSettled(triggered: Boolean)
}

/**
 * Android 伙伴页专用下拉动作容器。
 *
 * SmartRefreshLayout 负责完整的触摸截获、阈值判定和回弹动画；业务层不再混用
 * touchend/refresherrefresh/refresherabort/refresherrestore 推断同一次手势。
 */
object PullActionRegistry {
    private const val TAG = "NuwaxPullAction"
    private val sessions = HashMap<String, PullActionSession>()

    @JvmStatic
    fun attach(
        key: String,
        target: View,
        thresholdDp: Number,
        maxDragDp: Number,
        backgroundColor: String,
        enabled: Boolean,
        callback: PullActionCallback
    ): Boolean {
        detach(key)
        val session = PullActionSession(
            key,
            target,
            thresholdDp.toFloat(),
            maxDragDp.toFloat(),
            backgroundColor,
            callback
        )
        return try {
            if (!session.attach(enabled)) return false
            sessions[key] = session
            true
        } catch (error: Throwable) {
            Log.w(TAG, "attach failed for $key", error)
            session.detach()
            false
        }
    }

    @JvmStatic
    fun setEnabled(key: String, enabled: Boolean) {
        sessions[key]?.setEnabled(enabled)
    }

    @JvmStatic
    fun detach(key: String) {
        sessions.remove(key)?.detach()
    }
}

private class PullActionHeader(context: android.content.Context, backgroundColor: Int) :
    SimpleComponent(View(context)), RefreshHeader {
    init {
        mSpinnerStyle = SpinnerStyle.Scale
        view.setBackgroundColor(backgroundColor)
    }
}

/**
 * 冻结消息列表：本轮手势只要拉出过 header，列表既不能跟手滚，也不能在松手瞬间自己甩出去。
 *
 * 真实事件路径（DCloud 的 NestedScrollView 在 ACTION_DOWN 里就 startNestedScroll）：
 * SmartRefreshLayout 走 mNestedInProgress 分支，把真实 DOWN/MOVE/UP **原样转给列表**，
 * 靠 onNestedPreScroll 截走位移来驱动 header。于是有两个口子：
 * 1. 反向上滑越过 0 后，剩余 dy 默认落回列表 → 在 onNestedPreScroll 里全部吃掉；
 * 2. 列表手里有完整的手指速度样本，松手收到 ACTION_UP 会自己 fling；而此时 nested
 *    parent 已在 stopNestedScroll 里结束，父层再也拦不住 → 页面回弹期间列表继续上滑。
 *    所以在松手那一下把 UP 换成 CANCEL 派给列表：CANCEL 只做 springBack（位置没变=
 *    无位移），不会产生惯性，回弹结束前列表就是冻结的。
 *
 * 只在“本轮确实拉出过 header”后生效，ACTION_UP/CANCEL 或下一轮真实 DOWN 立即复位，
 * 不影响正常列表滚动。onInterceptTouchEvent 是给少数走非 nested 路径的机型兜底：
 * 那里 SRL 会给列表合成 DOWN/MOVE/UP，同样会按伪手势起 fling。
 */
private class PullActionRefreshLayout(context: Context) : SmartRefreshLayout(context) {
    private var holdUpwardRemainder = false

    fun markPullStarted() {
        holdUpwardRemainder = true
    }

    override fun dispatchTouchEvent(event: MotionEvent): Boolean {
        val action = event.actionMasked
        if (action == MotionEvent.ACTION_DOWN) {
            holdUpwardRemainder = false
        }
        if (holdUpwardRemainder && action == MotionEvent.ACTION_UP) {
            // 本轮是下拉手势的松手：不给列表派 UP，改派 CANCEL，掐掉松手自带的 fling。
            holdUpwardRemainder = false
            val cancel = MotionEvent.obtain(event)
            cancel.action = MotionEvent.ACTION_CANCEL
            val handled = try {
                super.dispatchTouchEvent(cancel)
            } finally {
                cancel.recycle()
            }
            return handled
        }
        val handled = super.dispatchTouchEvent(event)
        if (action == MotionEvent.ACTION_UP || action == MotionEvent.ACTION_CANCEL) {
            holdUpwardRemainder = false
        }
        return handled
    }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        // 伪手势的 DOWN 是 SmartRefreshLayout 内部直接派发出来的，不会走本类的
        // dispatchTouchEvent；真实手指的新 DOWN 上面已复位标志，不会被误拦。
        if (holdUpwardRemainder && ev.actionMasked == MotionEvent.ACTION_DOWN) {
            return true
        }
        return super.onInterceptTouchEvent(ev)
    }

    override fun onNestedPreScroll(target: View, dx: Int, dy: Int, consumed: IntArray) {
        super.onNestedPreScroll(target, dx, dy, consumed)
        if (!holdUpwardRemainder || dy <= 0) return
        val remainingY = dy - consumed[1]
        if (remainingY > 0) consumed[1] += remainingY
    }
}

private class PullActionSession(
    private val key: String,
    private val target: View,
    private val thresholdDp: Float,
    private val maxDragDp: Float,
    private val backgroundColor: String,
    private val callback: PullActionCallback
) {
    private var originalParent: ViewGroup? = null
    private var originalIndex = -1
    private var originalLayoutParams: ViewGroup.LayoutParams? = null
    private var refreshLayout: SmartRefreshLayout? = null
    private var gestureStarted = false
    private var gestureTriggered = false
    private var settledReported = true
    private var gestureStartedAtMs = 0L
    private var gestureMaxDistanceDp = 0.0
    private var lastProgressAtMs = 0L
    private var lastProgressDistanceDp = -1.0
    private var lastProgressDragging = false

    private fun dispatchProgress(
        distanceDp: Double,
        dragging: Boolean,
        force: Boolean = false
    ) {
        val normalized = max(0.0, distanceDp)
        val now = SystemClock.uptimeMillis()
        val draggingChanged = dragging != lastProgressDragging
        val distanceChanged = abs(normalized - lastProgressDistanceDp) >= 0.5

        if (
            !force &&
            !draggingChanged &&
            (now - lastProgressAtMs < 16L || !distanceChanged)
        ) {
            return
        }

        lastProgressAtMs = now
        lastProgressDistanceDp = normalized
        lastProgressDragging = dragging
        callback.onProgress(normalized, dragging)
    }

    fun attach(enabled: Boolean): Boolean {
        val parent = target.parent as? ViewGroup ?: return false
        val index = parent.indexOfChild(target)
        if (index < 0) return false

        originalParent = parent
        originalIndex = index
        originalLayoutParams = target.layoutParams

        target.animate().cancel()
        target.clearAnimation()
        target.translationY = 0f
        target.translationX = 0f

        val density = target.resources.displayMetrics.density
        val thresholdPx = max(1, (thresholdDp * density).toInt())
        val maxDragPx = max(thresholdPx + 1, (maxDragDp * density).toInt())
        val wrapper = PullActionRefreshLayout(target.context)
        // 外壳底色 = 下拉灰区同色（业务经 backgroundColor 传入，伙伴页为 #f4f3fb）。
        // 静止下拉由 header 盖住这块；快速甩动到顶后列表的惯性 overscroll 不经过 header，
        // 露出的就是外壳本身，写死白色会在顶部露出一条白边（业务侧列表本体已自铺白底）。
        wrapper.setBackgroundColor(parseColor(backgroundColor))
        wrapper.setEnableLoadMore(false)
        wrapper.setEnableAutoLoadMore(false)
        wrapper.setEnableNestedScroll(true)
        wrapper.setEnableOverScrollBounce(false)
        wrapper.setEnableOverScrollDrag(false)
        // ★关闭内容位移：列表由业务侧整页合成层（tab-shell 的 translateY）统一推动。
        //   开着的话 SmartRefreshLayout 会给 scroll-view 设 translationY，而 uvue 侧给
        //   同一个元素写 style.transform 会**覆盖**（不是叠加）这个值，两边每帧抢同一个
        //   属性 —— 实测表现就是列表和顶部错位 + 拖动抖动。关闭后位移只有一个来源。
        wrapper.setEnableHeaderTranslationContent(false)
        wrapper.setEnableScrollContentWhenRefreshed(false)
        wrapper.setEnableClipHeaderWhenFixedBehind(true)
        wrapper.setDragRate(1f)
        wrapper.setReboundDuration(260)
        wrapper.setHeaderHeightPx(thresholdPx)
        wrapper.setHeaderTriggerRate(PULL_ACTION_TRIGGER_RATE)
        wrapper.setHeaderMaxDragRate(max(1f, min(9.9f, maxDragPx.toFloat() / thresholdPx)))
        // header 必须透明：整页下移后顶部露出的是下层会话页预览，不能盖一层灰底。
        wrapper.setRefreshHeader(
            PullActionHeader(target.context, Color.TRANSPARENT)
        )
        wrapper.setOnMultiListener(object : SimpleMultiListener() {
            override fun onHeaderMoving(
                header: RefreshHeader,
                isDragging: Boolean,
                percent: Float,
                offset: Int,
                headerHeight: Int,
                maxDragHeight: Int
            ) {
                val distanceDp = offset.toDouble() / density
                if (offset > 0 && isDragging && !gestureStarted) {
                    gestureStarted = true
                    gestureTriggered = false
                    settledReported = false
                    gestureStartedAtMs = SystemClock.uptimeMillis()
                    gestureMaxDistanceDp = 0.0
                    wrapper.markPullStarted()
                }
                if (isDragging) {
                    gestureMaxDistanceDp = max(gestureMaxDistanceDp, distanceDp)
                }
                dispatchProgress(distanceDp, isDragging)
            }

            override fun onHeaderReleased(
                header: RefreshHeader,
                headerHeight: Int,
                maxDragHeight: Int
            ) {
                val now = SystemClock.uptimeMillis()
                val dragDurationMs = max(0L, now - gestureStartedAtMs)
                val triggerDistanceDp =
                    headerHeight.toDouble() / density * PULL_ACTION_TRIGGER_RATE
                val releaseQualified =
                    gestureStarted &&
                        !gestureTriggered &&
                        gestureMaxDistanceDp >= triggerDistanceDp &&
                        dragDurationMs >= PULL_ACTION_MIN_DRAG_DURATION_MS

                if (releaseQualified) {
                    gestureTriggered = true
                    settledReported = false
                    callback.onTriggered()
                }
            }

            override fun onRefresh(layout: RefreshLayout) {
                if (!gestureStarted) {
                    gestureStarted = true
                    gestureStartedAtMs = SystemClock.uptimeMillis()
                }
                settledReported = false
                // 动作不是网络刷新：松手判定已在 onHeaderReleased 完成，这里只启动回弹。
                layout.finishRefresh(0)
            }

            override fun onStateChanged(
                layout: RefreshLayout,
                oldState: RefreshState,
                newState: RefreshState
            ) {
                if (newState == RefreshState.None && gestureStarted && !settledReported) {
                    settledReported = true
                    target.translationY = 0f
                    dispatchProgress(0.0, false, true)
                    callback.onSettled(gestureTriggered)
                    gestureStarted = false
                    gestureTriggered = false
                    gestureStartedAtMs = 0L
                    gestureMaxDistanceDp = 0.0
                }
            }
        })

        parent.removeViewAt(index)
        val contentParams = ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT
        )
        wrapper.addView(target, contentParams)
        val outerParams = originalLayoutParams
            ?: ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
        parent.addView(wrapper, index, outerParams)
        refreshLayout = wrapper
        setEnabled(enabled)
        return true
    }

    fun setEnabled(enabled: Boolean) {
        val wrapper = refreshLayout ?: return
        wrapper.setEnableRefresh(enabled)
        if (!enabled) {
            wrapper.closeHeaderOrFooter()
        }
    }

    fun detach() {
        // Reset any content translation left by an interrupted rebound before
        // returning the scroll view to its original parent.
        try {
            refreshLayout?.finishRefresh(0)
            target.animate().cancel()
            target.clearAnimation()
            target.translationY = 0f
            target.translationX = 0f
        } catch (_: Throwable) {
            // Continue with structural detach even if the refresh state is stale.
        }
        val wrapper = refreshLayout ?: return
        refreshLayout = null
        try {
            wrapper.setOnMultiListener(null)
            wrapper.closeHeaderOrFooter()
            val parent = wrapper.parent as? ViewGroup
            if (parent != null) {
                wrapper.removeView(target)
                val index = parent.indexOfChild(wrapper)
                parent.removeView(wrapper)
                val restoreIndex = if (originalIndex >= 0) {
                    min(originalIndex, parent.childCount)
                } else {
                    max(0, index)
                }
                val params = originalLayoutParams
                    ?: ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT)
                parent.addView(target, restoreIndex, params)
            }
        } catch (error: Throwable) {
            Log.w("NuwaxPullAction", "detach failed for $key", error)
        } finally {
            target.translationY = 0f
            target.translationX = 0f
            gestureStarted = false
            gestureTriggered = false
            settledReported = true
            gestureStartedAtMs = 0L
            gestureMaxDistanceDp = 0.0
            lastProgressAtMs = 0L
            lastProgressDistanceDp = -1.0
            lastProgressDragging = false
            originalParent = null
            originalLayoutParams = null
        }
    }

    private fun parseColor(value: String): Int = try {
        Color.parseColor(value)
    } catch (_: Throwable) {
        Color.rgb(244, 243, 251)
    }
}
