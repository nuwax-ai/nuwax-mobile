package com.nuwax.voip

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import android.widget.Toast
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat

/** A real notification destination, available before the UTS page resumes.
 * Intents contain only a business call ID. State, identity and actions stay in the singleton.
 */
class VoipIncomingActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var callId = ""
    private var pendingAnswer: String? = null
    private var actionPending = false
    private var lastRenderedSnapshot: String? = null
    private var lastRenderedSecond = -1L
    private var lastRenderedAnswering = false
    private lateinit var callView: VoipNativeCallView
    private val refresh = object : Runnable {
        override fun run() { render(); if (!isFinishing) handler.postDelayed(this, 250) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = VoipNativeCallView.BACKDROP_TOP
        window.navigationBarColor = VoipNativeCallView.BACKDROP_BOTTOM
        callId = intent.getStringExtra("callId") ?: ""
        callView = VoipNativeCallView(this, ::answer, ::endCall, ::toggleMedia, ::finish) {
            VoipBridge.uiCommand(callId, "switchCamera")
        }
        setContentView(callView)
        render()
    }

    override fun onNewIntent(value: Intent) {
        super.onNewIntent(value)
        intent = value
        lastRenderedSnapshot = null
        val nextCallId = value.getStringExtra("callId") ?: ""
        if (nextCallId != callId) {
            callId = nextCallId
            pendingAnswer = null; actionPending = false
        }
        render()
    }
    override fun onResume() {
        super.onResume()
        if (isFinishing) return
        lastRenderedSnapshot = null
        VoipBridge.nativeVisible(callId, true)
        handler.removeCallbacks(refresh); handler.post(refresh)
        consumeAnswerIntent()
    }
    override fun onPause() {
        handler.removeCallbacks(refresh)
        VoipBridge.nativeVisible(callId, false)
        super.onPause()
    }
    override fun onDestroy() {
        handler.removeCallbacks(refresh)
        callView.release()
        super.onDestroy()
    }
    private fun consumeAnswerIntent() {
        if (!intent.getBooleanExtra("answer", false)) return
        intent.removeExtra("answer")
        answer()
    }
    private fun answer(requestedType: String? = null) {
        val value = VoipBridge.uiSnapshot(callId) ?: return
        if (!value.optBoolean("incoming") || value.optString("state") != "ringing" || actionPending) return
        val type = VoipCallPolicy.answerMediaType(value.optString("mediaType"), requestedType)
        // 会议接听只负责打开会议页，麦克风/摄像头由会议页按需申请，不在锁屏强行弹权限。
        if (value.optString("scene") == "meeting") {
            val keyguard = getSystemService(KeyguardManager::class.java)
            actionPending = true
            if (keyguard.isKeyguardLocked) {
                keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                    override fun onDismissSucceeded() { actionPending = false; answer(type) }
                    override fun onDismissCancelled() { actionPending = false; render() }
                    override fun onDismissError() { actionPending = false; render() }
                })
            } else {
                // 显式拉起主 App，业务层等前台恢复后消费入会路由。
                packageManager.getLaunchIntentForPackage(packageName)?.let { launch ->
                    launch.flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    startActivity(launch)
                }
                VoipBridge.uiCommand(callId, "action", mediaType = type)
                finish()
            }
            return
        }
        // Video and runtime permission prompts require the user to unlock. Audio with an
        // existing grant can be accepted on the lockscreen, without dismissing the keyguard.
        val missing = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.RECORD_AUDIO)
        if (type == "video" && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.CAMERA)
        val keyguard = getSystemService(KeyguardManager::class.java)
        if ((type == "video" || missing.isNotEmpty()) && keyguard.isKeyguardLocked) {
            val pendingCallId = callId
            keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() {
                    if (!isFinishing && callId == pendingCallId) answer(type)
                }
            })
            return
        }
        if (missing.isNotEmpty()) { pendingAnswer = type; requestPermissions(missing.toTypedArray(), 901); return }
        actionPending = true
        VoipBridge.uiCommand(callId, "action", mediaType = type)
        handler.postDelayed({ actionPending = false; if (!isFinishing) render() }, 4500)
        render()
    }
    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != 901) return
        val type = pendingAnswer; pendingAnswer = null
        if (type != null && grantResults.isNotEmpty() && grantResults.all { it == PackageManager.PERMISSION_GRANTED }) answer(type)
        else Toast.makeText(this, VoipBridge.label("permissionRequired"), Toast.LENGTH_LONG).show()
    }
    private fun endCall() {
        val value = VoipBridge.uiSnapshot(callId) ?: return
        val action = when {
            value.optString("state") != "ringing" -> "end"
            value.optBoolean("incoming") -> "reject"
            else -> "cancel"
        }
        VoipBridge.receiveAction(callId, action)
    }

    private var requestedAudioRoute = ""
    private var requestedAudioRouteAt = 0L

    private fun toggleMedia(control: String) {
        val value = VoipBridge.uiSnapshot(callId) ?: return
        val enabled = !value.optBoolean(control)
        if (control == "camera" && enabled &&
            ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED
        ) {
            Toast.makeText(this, VoipBridge.label("permissionRequired"), Toast.LENGTH_LONG).show()
            return
        }
        if (control == "speaker") {
            requestedAudioRoute = if (enabled) "speaker" else "earpiece"
            requestedAudioRouteAt = android.os.SystemClock.elapsedRealtime()
        }
        VoipBridge.uiCommand(callId, control, enabled)
    }

    private fun render() {
        val value = VoipBridge.uiSnapshot(callId)
        if (value == null) { finish(); return }
        if (requestedAudioRoute.isNotEmpty()) {
            if (android.os.SystemClock.elapsedRealtime() - requestedAudioRouteAt > 5000) requestedAudioRoute = ""
            else if (value.optString("audioOutput") == requestedAudioRoute) {
                val message = if (requestedAudioRoute == "speaker") "speakerOn" else "switchedToEarpiece"
                requestedAudioRoute = ""
                Toast.makeText(this, VoipBridge.label(message), Toast.LENGTH_SHORT).show()
            }
        }
        val ringing = value.optString("state") == "ringing"
        val hasVideo = value.optString("mediaType") == "video"
        val snapshot = value.toString()
        val showDuration = value.optString("state") == "active" && value.optBoolean("mediaReady") && !value.optBoolean("reconnecting")
        val second = if (showDuration) ((System.currentTimeMillis() - value.optLong("connectedAt", System.currentTimeMillis())) / 1000).coerceAtLeast(0) else -1L
        if (snapshot == lastRenderedSnapshot && second == lastRenderedSecond && actionPending == lastRenderedAnswering) return
        lastRenderedSnapshot = snapshot
        lastRenderedSecond = second
        lastRenderedAnswering = actionPending
        callView.render(value, ringing, hasVideo, actionPending)
        if (!ringing && hasVideo) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    companion object {
        fun intent(context: Context, id: String): Intent = Intent(context, VoipIncomingActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NO_USER_ACTION)
            .setData(Uri.parse("nuwax-voip://call/" + Uri.encode(id)))
            .putExtra("callId", id)
    }
}
