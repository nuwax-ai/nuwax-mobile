package com.nuwax.pullaction

import android.graphics.Color
import android.os.SystemClock
import android.util.Log
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
        val wrapper = SmartRefreshLayout(target.context)
        // 外壳底色 = 下拉灰区同色（业务经 backgroundColor 传入，伙伴页为 #f4f3fb）。
        // 静止下拉由 header 盖住这块；快速甩动到顶后列表的惯性 overscroll 不经过 header，
        // 露出的就是外壳本身，写死白色会在顶部露出一条白边（业务侧列表本体已自铺白底）。
        wrapper.setBackgroundColor(parseColor(backgroundColor))
        wrapper.setEnableLoadMore(false)
        wrapper.setEnableAutoLoadMore(false)
        wrapper.setEnableNestedScroll(true)
        wrapper.setEnableOverScrollBounce(false)
        wrapper.setEnableOverScrollDrag(false)
        wrapper.setEnableHeaderTranslationContent(true)
        wrapper.setEnableScrollContentWhenRefreshed(false)
        wrapper.setEnableClipHeaderWhenFixedBehind(true)
        wrapper.setDragRate(1f)
        wrapper.setReboundDuration(260)
        wrapper.setHeaderHeightPx(thresholdPx)
        wrapper.setHeaderTriggerRate(PULL_ACTION_TRIGGER_RATE)
        wrapper.setHeaderMaxDragRate(max(1f, min(9.9f, maxDragPx.toFloat() / thresholdPx)))
        wrapper.setRefreshHeader(
            PullActionHeader(target.context, parseColor(backgroundColor))
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
