package com.nuwax.voip

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.igexin.sdk.VivoPushMessageReceiver
import com.vivo.push.model.UnvarnishedMessage
import java.util.concurrent.atomic.AtomicBoolean
import kotlinx.coroutines.Job
import org.json.JSONObject

/** Keep the existing Getui registration in :pushservice and relay vivo calls to the app process. */
class VivoVoipPushMessageReceiver : VivoPushMessageReceiver() {
    override fun onTransmissionMessage(context: Context, message: UnvarnishedMessage) {
        super.onTransmissionMessage(context, message)
        if (!message.isCallMessage) return
        val payload = message.message ?: return
        context.sendBroadcast(Intent(context, VivoVoipCallReceiver::class.java).putExtra(CALL_PAYLOAD, payload))
    }
}

internal const val CALL_PAYLOAD = "com.nuwax.voip.VIVO_CALL_PAYLOAD"

/** Internal only, compiled into the signed test-environment package. */
class VivoVoipCallReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val payload = intent.getStringExtra(CALL_PAYLOAD)?.let(VoipPushPayload::invitation) ?: return
        if (!VoipPushPayload.isNative(JSONObject(payload))) return

        val pending = goAsync()
        val handler = Handler(Looper.getMainLooper())
        val finished = AtomicBoolean()
        val finish = Runnable { if (finished.compareAndSet(false, true)) pending.finish() }
        handler.postDelayed(finish, 8_000)
        var verification: Job? = null
        try {
            VoipBridge.receiveUniPush(context, payload, "vivo-transmission") { verification = it }
        } finally {
            val complete = {
                handler.removeCallbacks(finish)
                finish.run()
            }
            verification?.invokeOnCompletion { complete() } ?: complete()
        }
    }
}
