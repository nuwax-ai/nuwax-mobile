package com.nuwax.voip

import android.Manifest
import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.ContextCompat

/** A real notification destination, available before the UTS page resumes.
 * Intents contain only a business call ID. State, identity and actions stay in the singleton.
 */
class VoipIncomingActivity : Activity() {
    private val handler = Handler(Looper.getMainLooper())
    private var callId = ""
    private var pendingAnswer: String? = null
    private var actionPending = false
    private lateinit var name: TextView
    private lateinit var status: TextView
    private lateinit var audio: Button
    private lateinit var video: Button
    private lateinit var end: Button
    private lateinit var mute: Button
    private lateinit var route: Button
    private lateinit var camera: Button
    private lateinit var flip: Button
    private lateinit var remote: FrameLayout
    private lateinit var local: FrameLayout
    private val refresh = object : Runnable {
        override fun run() { render(); if (!isFinishing) handler.postDelayed(this, 250) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Build.VERSION.SDK_INT >= 27) { setShowWhenLocked(true); setTurnScreenOn(true) }
        else window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
        window.statusBarColor = Color.rgb(20, 24, 36)
        window.navigationBarColor = Color.rgb(20, 24, 36)
        callId = intent.getStringExtra("callId") ?: ""
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL; gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dp(24), dp(40), dp(24), dp(24)); setBackgroundColor(Color.rgb(20, 24, 36))
        }
        fun text(size: Float) = TextView(this).apply { textSize = size; setTextColor(Color.WHITE); gravity = Gravity.CENTER }
        name = text(28f); status = text(17f)
        root.addView(name, LinearLayout.LayoutParams(-1, dp(64)))
        root.addView(status, LinearLayout.LayoutParams(-1, dp(56)))
        val media = FrameLayout(this)
        remote = VoipBridge.createVideoView(this, false)
        local = VoipBridge.createVideoView(this, true)
        media.addView(remote, FrameLayout.LayoutParams(-1, -1))
        media.addView(local, FrameLayout.LayoutParams(dp(100), dp(140), Gravity.TOP or Gravity.END))
        root.addView(media, LinearLayout.LayoutParams(-1, 0, 1f))
        fun button(action: () -> Unit): Button = Button(this).apply {
            isAllCaps = false; textSize = 16f; setOnClickListener { action() }
            root.addView(this, LinearLayout.LayoutParams(-1, dp(52)))
        }
        audio = button { answer("audio") }
        video = button { answer("video") }
        mute = button { VoipBridge.uiSnapshot(callId)?.let { VoipBridge.uiCommand(callId, "microphone", !it.optBoolean("microphone")) } }
        route = button { VoipBridge.uiSnapshot(callId)?.let { VoipBridge.uiCommand(callId, "speaker", !it.optBoolean("speaker")) } }
        camera = button {
            VoipBridge.uiSnapshot(callId)?.let {
                if (!it.optBoolean("camera") && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                    Toast.makeText(this, VoipBridge.label("permissionRequired"), Toast.LENGTH_LONG).show()
                } else VoipBridge.uiCommand(callId, "camera", !it.optBoolean("camera"))
            }
        }
        flip = button { VoipBridge.uiCommand(callId, "switchCamera") }
        end = button {
            VoipBridge.uiSnapshot(callId)?.let {
                val action = if (it.optString("state") == "ringing") (if (it.optBoolean("incoming")) "reject" else "cancel") else "end"
                VoipBridge.receiveAction(callId, action)
            }
        }.apply { setTextColor(Color.rgb(190, 25, 40)) }
        button { finish() }.text = VoipBridge.label("minimize")
        setContentView(root)
        render()
    }

    override fun onNewIntent(value: Intent) {
        super.onNewIntent(value)
        VoipBridge.nativeVisible(callId, false)
        intent = value; callId = value.getStringExtra("callId") ?: ""
        pendingAnswer = null; actionPending = false
        VoipBridge.nativeVisible(callId, true)
        render(); consumeAnswerIntent()
    }
    override fun onResume() {
        super.onResume()
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
        VoipBridge.releaseVideoView(remote); VoipBridge.releaseVideoView(local)
        super.onDestroy()
    }
    private fun consumeAnswerIntent() {
        if (intent.getBooleanExtra("answer", false)) { intent.removeExtra("answer"); answer("audio") }
    }
    private fun answer(type: String) {
        val value = VoipBridge.uiSnapshot(callId) ?: return
        if (!value.optBoolean("incoming") || value.optString("state") != "ringing" || actionPending) return
        // Video and runtime permission prompts require the user to unlock. Audio with an
        // existing grant can be accepted on the lockscreen, without dismissing the keyguard.
        val missing = mutableListOf<String>()
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.RECORD_AUDIO)
        if (type == "video" && ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) missing.add(Manifest.permission.CAMERA)
        val keyguard = getSystemService(KeyguardManager::class.java)
        if ((type == "video" || missing.isNotEmpty()) && keyguard.isKeyguardLocked) {
            keyguard.requestDismissKeyguard(this, object : KeyguardManager.KeyguardDismissCallback() {
                override fun onDismissSucceeded() { answer(type) }
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
    private fun render() {
        val value = VoipBridge.uiSnapshot(callId)
        if (value == null) { finish(); return }
        val ringing = value.optString("state") == "ringing"
        val incoming = value.optBoolean("incoming")
        val hasVideo = value.optString("mediaType") == "video"
        val active = value.optString("state") == "active" && value.optBoolean("mediaReady")
        name.text = value.optString(if (incoming) "callerDisplayName" else "calleeDisplayName", "Nuwax")
        val seconds = ((System.currentTimeMillis() - value.optLong("connectedAt", System.currentTimeMillis())) / 1000).coerceAtLeast(0)
        status.text = if (value.optBoolean("reconnecting")) VoipBridge.label("reconnecting")
            else if (active) "%02d:%02d".format(seconds / 60, seconds % 60)
            else VoipBridge.label(if (ringing) (if (incoming) "incoming" else "dialing") else "connecting")
        fun Button.show(show: Boolean, label: String) { visibility = if (show) View.VISIBLE else View.GONE; text = VoipBridge.label(label) }
        audio.show(ringing && incoming, "answerAudio"); video.show(ringing && incoming && hasVideo, "answerVideo")
        audio.isEnabled = !actionPending; video.isEnabled = !actionPending
        mute.show(!ringing, if (value.optBoolean("microphone")) "mute" else "unmute")
        route.show(!ringing, if (value.optBoolean("speaker")) "earpiece" else "speaker")
        camera.show(!ringing && hasVideo, if (value.optBoolean("camera")) "cameraOff" else "cameraOn")
        flip.show(!ringing && hasVideo, "switchCamera")
        end.text = VoipBridge.label(if (ringing && incoming) "reject" else "hangup")
        remote.visibility = if (!ringing && hasVideo) View.VISIBLE else View.INVISIBLE
        local.visibility = if (!ringing && hasVideo && value.optBoolean("camera")) View.VISIBLE else View.INVISIBLE
        if (!ringing && hasVideo) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()
    companion object {
        fun intent(context: Context, id: String): Intent = Intent(context, VoipIncomingActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData(Uri.parse("nuwax-voip://call/" + Uri.encode(id)))
            .putExtra("callId", id)
    }
}
