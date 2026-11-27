package com.nuwax.voip

import android.content.Context
import android.content.res.ColorStateList
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.text.TextUtils
import android.view.Gravity
import android.view.View
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.Button
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import org.json.JSONObject
import kotlin.math.roundToInt

/** Matches the in-app call screen using only resources available to the native Activity. */
internal class VoipNativeCallView(
    context: Context,
    answer: (String) -> Unit,
    end: () -> Unit,
    toggle: (String) -> Unit,
    minimize: () -> Unit,
    flip: () -> Unit,
) : FrameLayout(context) {
    companion object {
        val BACKDROP_TOP = Color.rgb(70, 83, 79)
        val BACKDROP_BOTTOM = Color.rgb(32, 40, 39)
        private val AVATAR_FILL = Color.rgb(113, 134, 124)
        private val LABEL = Color.argb(179, 255, 255, 255)
        private val NEUTRAL = Color.argb(36, 255, 255, 255)
        private val DANGER = Color.rgb(238, 77, 90)
        private val SUCCESS = Color.rgb(22, 184, 102)
        private val STATUS = Color.rgb(196, 210, 202)
        private val ACTIVE = Color.rgb(50, 214, 138)
    }

    private val compact = resources.configuration.screenHeightDp < 450
    private val remote = VoipBridge.createVideoView(context, false)
    private val local = VoipBridge.createVideoView(context, true)
    private val shade = View(context).apply {
        background = gradient(Color.TRANSPARENT, Color.argb(217, 0, 0, 0))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    private val kind = label(13f, LABEL)
    private val minimizeText = label(12f, LABEL)
    private val initials = label(44f, Color.rgb(240, 245, 242)).apply {
        background = oval(AVATAR_FILL)
    }
    private var avatarUrl = ""
    private var avatarJob: Job? = null
    private val avatarImage = ImageView(context).apply {
        scaleType = ImageView.ScaleType.CENTER_CROP
        background = oval(AVATAR_FILL)
        clipToOutline = true
        visibility = GONE
    }
    private val avatar = FrameLayout(context).apply {
        background = oval(Color.TRANSPARENT).apply { setStroke(dp(1), Color.argb(26, 255, 255, 255)) }
        setPadding(dp(6), dp(6), dp(6), dp(6))
        addView(initials, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(avatarImage, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS
    }
    private val name = label(28f).apply {
        typeface = Typeface.create("sans-serif-medium", Typeface.NORMAL)
        maxLines = 2
    }
    private val status = label(15f, LABEL).apply { maxLines = 2 }
    private val meetingNumber = label(15f, LABEL).apply { visibility = GONE }
    private val statusDot = View(context).apply { importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO }
    private val identity = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        gravity = Gravity.CENTER_HORIZONTAL
        val size = dp(if (compact) 64 else 116)
        addView(avatar, LinearLayout.LayoutParams(size, size))
        addView(name, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
        addView(LinearLayout(context).apply {
            gravity = Gravity.CENTER
            minimumHeight = dp(24)
            addView(statusDot, LinearLayout.LayoutParams(dp(5), dp(5)).apply { marginEnd = dp(9) })
            addView(status)
        }, LinearLayout.LayoutParams(LayoutParams.WRAP_CONTENT, LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) })
        addView(meetingNumber, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { topMargin = dp(12) })
    }

    private val reject = control("hangup", large = true, action = end)
    private val audio = control("phone", large = true) { answer("audio") }
    private val video = control("video", large = true) { answer("video") }
    private val ringActions = row(reject, audio, video)
    private val microphone = control("microphone") { toggle("microphone") }
    private val hangup = control("hangup", large = true, action = end)
    private val speaker = control("speaker") { toggle("speaker") }
    private val audioActions = row(microphone, hangup, speaker)
    private val videoMicrophone = control("microphone", dense = true) { toggle("microphone") }
    private val camera = control("video", dense = true) { toggle("camera") }
    private val switchCamera = control("switch_camera", dense = true, action = flip)
    private val videoSpeaker = control("speaker", dense = true) { toggle("speaker") }
    private val videoHangup = control("hangup", large = true, action = end)
    private val videoActions = LinearLayout(context).apply {
        orientation = LinearLayout.VERTICAL
        addView(row(videoMicrophone, camera, switchCamera, videoSpeaker))
        addView(row(videoHangup))
    }

    init {
        background = gradient(BACKDROP_TOP, BACKDROP_BOTTOM)
        addView(remote, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        addView(shade, LayoutParams(LayoutParams.MATCH_PARENT, dp(320), Gravity.BOTTOM))
        val content = FrameLayout(context)
        addView(content, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
        ViewCompat.setOnApplyWindowInsetsListener(this) { _, insets ->
            val safeArea = insets.getInsetsIgnoringVisibility(
                WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout()
            )
            content.setPadding(safeArea.left, safeArea.top, safeArea.right, safeArea.bottom)
            insets
        }
        local.background = rounded(Color.rgb(61, 73, 67), 14)
        local.clipToOutline = true
        content.addView(local, LayoutParams(dp(94), dp(138), Gravity.TOP or Gravity.END).apply {
            topMargin = dp(64)
            marginEnd = dp(16)
        })
        content.addView(LinearLayout(context).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            addView(header(minimize), LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, dp(48)))
            addView(identity, LinearLayout.LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT))
            addView(View(context), LinearLayout.LayoutParams(1, 0, 1f))
            val dockWidth = resources.configuration.screenWidthDp.coerceIn(1, 420)
            addView(LinearLayout(context).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(dp(16), 0, dp(16), dp(if (compact) 12 else 28))
                addView(ringActions)
                addView(audioActions)
                addView(videoActions)
            }, LinearLayout.LayoutParams(dp(dockWidth), LayoutParams.WRAP_CONTENT))
        }, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    private fun header(minimize: () -> Unit) = FrameLayout(context).apply {
        setPadding(dp(16), 0, dp(16), 0)
        val minimizeControl = LinearLayout(context).apply {
            gravity = Gravity.CENTER_VERTICAL
            addView(icon("minimize"), LinearLayout.LayoutParams(dp(20), dp(20)))
            val text = minimizeText
            text.text = VoipBridge.label("minimize")
            text.maxLines = 2
            text.importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
            addView(text, LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f).apply { marginStart = dp(7) })
            contentDescription = text.text
            isFocusable = true
            setOnClickListener { minimize() }
        }
        addView(kind, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT).apply {
            marginStart = dp(104)
            marginEnd = dp(104)
        })
        addView(minimizeControl, LayoutParams(dp(104), dp(44), Gravity.START or Gravity.CENTER_VERTICAL))
    }

    fun render(value: JSONObject, ringing: Boolean, hasVideo: Boolean, answering: Boolean) {
        val incoming = value.optBoolean("incoming")
        val meeting = value.optString("scene") == "meeting"
        minimizeText.text = VoipBridge.label(if (meeting) "meetingMinimize" else "minimize")
        (minimizeText.parent as? View)?.contentDescription = minimizeText.text
        val active = value.optString("state") == "active" && value.optBoolean("mediaReady")
        val reconnecting = value.optBoolean("reconnecting")
        val displayName = value.optString(if (incoming) "callerDisplayName" else "calleeDisplayName").trim()
            .ifEmpty { VoipBridge.label("title") }
        val kindKey = if (meeting) "meetingInvitation" else if (hasVideo) "video" else "audio"
        val mediaLabel = VoipBridge.label(kindKey)
        kind.text = if (mediaLabel == kindKey) VoipBridge.label("title") else mediaLabel
        name.text = if (meeting) value.optString("title").ifBlank { VoipBridge.label("meetingInvitation") } else displayName
        meetingNumber.visibility = if (meeting) VISIBLE else GONE
        val room = value.optString("roomName")
        val formattedRoom = if (room.matches(Regex("[0-9]{9}"))) room.chunked(3).joinToString(" ") else room
        meetingNumber.text = if (meeting) "${VoipBridge.label("meetingNumber")} $formattedRoom" else ""
        initials.text = displayName.substring(0, Character.charCount(displayName.codePointAt(0)))
        updateAvatar((value.opt(if (incoming) "callerAvatar" else "calleeAvatar") as? String)?.trim().orEmpty())
        val connectedAt = value.optLong("connectedAt", System.currentTimeMillis())
        val seconds = ((System.currentTimeMillis() - connectedAt) / 1000).coerceAtLeast(0)
        status.text = when {
            meeting && answering -> VoipBridge.label("meetingJoining")
            meeting -> VoipBridge.label("meetingInvitedBy").replace("{name}", displayName)
            reconnecting -> VoipBridge.label("reconnecting")
            active -> "%02d:%02d".format(seconds / 60, seconds % 60)
            ringing -> VoipBridge.label(if (incoming) "incoming" else "dialing")
            else -> VoipBridge.label("connecting")
        }
        val showVideo = !meeting && !ringing && hasVideo
        val showRemoteVideo = showVideo && value.optBoolean("remoteVideo")
        val cameraOn = value.optBoolean("camera")
        updateIdentity(showRemoteVideo, active && !reconnecting)
        remote.visibility = if (showRemoteVideo) VISIBLE else INVISIBLE
        local.visibility = if (showVideo && cameraOn) VISIBLE else INVISIBLE
        shade.visibility = if (showRemoteVideo) VISIBLE else GONE
        ringActions.visibility = if (ringing) VISIBLE else GONE
        audioActions.visibility = if (!ringing && !hasVideo) VISIBLE else GONE
        videoActions.visibility = if (showVideo) VISIBLE else GONE
        if (ringing) {
            reject.update(if (meeting) "meetingIgnore" else if (incoming) "reject" else "hangup", color = DANGER)
            audio.visibility = if (incoming) VISIBLE else GONE
            video.visibility = if (incoming && hasVideo && !meeting) VISIBLE else GONE
            audio.update(if (meeting) "meetingJoin" else "answerAudio", iconName = if (meeting) "meeting" else "phone", color = if (hasVideo && !meeting) NEUTRAL else SUCCESS)
            video.update("answerVideo", color = SUCCESS)
            audio.isEnabled = !answering
            video.isEnabled = !answering
        } else {
            val muted = !value.optBoolean("microphone")
            val loudspeaker = value.optBoolean("speaker")
            val routePending = value.optBoolean("defaultAudioRoutePending")
            val mic = if (hasVideo) videoMicrophone else microphone
            val route = if (hasVideo) videoSpeaker else speaker
            val end = if (hasVideo) videoHangup else hangup
            mic.update(if (muted) "unmute" else "mute", if (muted) "microphone_off" else "microphone", selected = muted)
            val outputLabel = value.optString("audioOutput").ifEmpty { if (loudspeaker) "speaker" else "earpiece" }
            val outputIcon = if (outputLabel == "earpiece") "speaker_off" else "speaker"
            val outputCaption = when (outputLabel) { "earpiece" -> "speakerOff"; "speaker" -> "speakerOn"; else -> outputLabel }
            route.update(if (routePending) "connecting" else outputCaption, iconName = outputIcon, selected = !routePending && loudspeaker)
            route.isEnabled = !routePending
            end.update("hangup", color = DANGER)
            if (hasVideo) {
                camera.update(if (cameraOn) "cameraOff" else "cameraOn", if (cameraOn) "video" else "video_off", selected = !cameraOn)
                switchCamera.update("switchCamera")
                switchCamera.isEnabled = cameraOn && !value.optBoolean("cameraSwitching")
            }
        }
    }

    private fun updateIdentity(showVideo: Boolean, active: Boolean) {
        val newVisibility = if (showVideo) GONE else VISIBLE
        if (identity.paddingTop == 0 || avatar.visibility != newVisibility) {
            avatar.visibility = newVisibility
            identity.gravity = if (showVideo) Gravity.START else Gravity.CENTER_HORIZONTAL
            identity.setPadding(dp(if (showVideo) 16 else 28), dp(if (showVideo || compact) 14 else 48),
                dp(if (showVideo) 128 else 28), 0)
            name.gravity = if (showVideo) Gravity.START else Gravity.CENTER
            name.textSize = if (showVideo) 20f else 28f
            val params = name.layoutParams as LinearLayout.LayoutParams
            params.topMargin = dp(if (showVideo) 0 else 25)
            name.layoutParams = params
        }
        val dotColor = if (active) ACTIVE else STATUS
        if (statusDot.backgroundTintList?.defaultColor != dotColor) {
            statusDot.background = rounded(Color.WHITE, 3)
            statusDot.backgroundTintList = ColorStateList.valueOf(dotColor)
            status.setTextColor(if (active) Color.WHITE else LABEL)
            status.textSize = if (active) 20f else 15f
        }
    }

    private fun updateAvatar(url: String) {
        if (url == avatarUrl) return
        avatarUrl = url
        avatarJob?.cancel()
        avatarImage.setImageDrawable(null)
        avatarImage.visibility = GONE
        initials.visibility = VISIBLE
        if (url.isEmpty()) return
        avatarJob = CoroutineScope(Dispatchers.Main.immediate).launch {
            val bitmap = VoipBridge.loadPeerAvatar(url, dp(104)) ?: return@launch
            avatarImage.setImageBitmap(bitmap)
            initials.visibility = GONE
            avatarImage.visibility = VISIBLE
        }
    }

    fun hideVideoForExit() {
        remote.visibility = INVISIBLE
        local.visibility = INVISIBLE
        shade.visibility = INVISIBLE
    }

    fun release() {
        avatarJob?.cancel()
        VoipBridge.releaseVideoView(remote)
        VoipBridge.releaseVideoView(local)
    }

    private fun row(vararg controls: Control) = LinearLayout(context).apply {
        gravity = Gravity.CENTER
        for (button in controls) addView(button, LinearLayout.LayoutParams(0, LayoutParams.WRAP_CONTENT, 1f))
    }

    private fun control(icon: String, large: Boolean = false, dense: Boolean = false, action: () -> Unit) =
        Control(icon, if (compact) 48 else if (large) 72 else if (dense) 56 else 62, action)

    private inner class Control(
        private val defaultIcon: String,
        size: Int,
        action: () -> Unit,
    ) : LinearLayout(this@VoipNativeCallView.context) {
        private val picture = icon(defaultIcon)
        private val disc = FrameLayout(context).apply {
            isDuplicateParentStateEnabled = true
            val iconSize = dp(if (compact) 24 else 30)
            addView(picture, LayoutParams(iconSize, iconSize, Gravity.CENTER))
        }
        private val caption = label(13f).apply {
            maxLines = 2
            importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
        }
        private var shownIcon = defaultIcon
        private var shownColor = Color.TRANSPARENT
        private var shownSelected = false

        init {
            orientation = VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            minimumHeight = dp(if (compact) 76 else size + 44)
            isFocusable = true
            addView(disc, LayoutParams(dp(size), dp(size)))
            addView(caption, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.WRAP_CONTENT).apply { topMargin = dp(8) })
            setOnClickListener { action() }
        }

        override fun onInitializeAccessibilityNodeInfo(info: AccessibilityNodeInfo) {
            super.onInitializeAccessibilityNodeInfo(info)
            info.className = Button::class.java.name
        }

        override fun setEnabled(enabled: Boolean) {
            super.setEnabled(enabled)
            alpha = if (enabled) 1f else 0.55f
        }

        fun update(labelKey: String, iconName: String = defaultIcon, color: Int = NEUTRAL, selected: Boolean = false) {
            val text = VoipBridge.label(labelKey)
            if (caption.text != text) {
                caption.text = text
                contentDescription = text
            }
            if (shownIcon != iconName) {
                picture.setImageResource(iconId(iconName))
                shownIcon = iconName
            }
            val fill = if (selected) Color.WHITE else color
            if (shownColor != fill || shownSelected != selected) {
                val mask = rounded(Color.WHITE, 40)
                disc.background = rounded(fill, 40)
                disc.foreground = RippleDrawable(ColorStateList.valueOf(0x33000000), null, mask)
                picture.imageTintList = ColorStateList.valueOf(if (selected) BACKDROP_BOTTOM else Color.WHITE)
                shownColor = fill
                shownSelected = selected
            }
        }
    }

    private fun icon(id: String) = ImageView(context).apply {
        setImageResource(iconId(id))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    private fun iconId(name: String) = resources.getIdentifier("nuwax_voip_$name", "drawable", context.packageName)

    private fun label(size: Float, color: Int = Color.WHITE) = TextView(context).apply {
        textSize = size
        setTextColor(color)
        gravity = Gravity.CENTER
        ellipsize = TextUtils.TruncateAt.END
    }

    private fun rounded(color: Int, radius: Int) = GradientDrawable().apply {
        setColor(color)
        cornerRadius = dp(radius).toFloat()
    }

    private fun oval(color: Int) = GradientDrawable().apply {
        shape = GradientDrawable.OVAL
        setColor(color)
    }

    private fun gradient(top: Int, bottom: Int) =
        GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(top, bottom))

    private fun dp(value: Int) = (value * resources.displayMetrics.density).roundToInt()
}
