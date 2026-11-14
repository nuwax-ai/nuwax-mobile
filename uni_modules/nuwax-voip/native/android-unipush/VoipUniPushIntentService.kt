// Nuwax VoIP UniPush adapter. Copied into the full App by configure_unipush.py.
package com.nuwax.voip

import android.content.Context
import android.content.pm.ApplicationInfo
import android.util.Log
import com.igexin.sdk.message.GTNotificationMessage
import com.igexin.sdk.message.GTTransmitMessage
import uts.sdk.modules.DCloudUniPush.UniPushIntentService

/** Keep the SDK's CID and ordinary-message callbacks. Route calls before force_notification. */
class VoipUniPushIntentService : UniPushIntentService() {
    private fun call(context: Context, raw: String?, source: String): Boolean {
        val invitation = raw?.let { VoipPushPayload.invitation(it) }
        val debug = context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (debug) Log.d("NuwaxVoip", "push received: $source, call=" + (invitation != null))
        return invitation != null && VoipBridge.receiveUniPush(context, invitation)
    }

    override fun onReceiveMessageData(context: Context, message: GTTransmitMessage) {
        val raw = message.payload?.toString(Charsets.UTF_8)
        if (!call(context, raw, "transmission")) super.onReceiveMessageData(context, message)
    }

    override fun onNotificationMessageArrived(context: Context, message: GTNotificationMessage) {
        if (!call(context, message.payload, "notification")) super.onNotificationMessageArrived(context, message)
    }

    override fun onNotificationMessageClicked(context: Context, message: GTNotificationMessage) {
        if (!call(context, message.payload, "click")) super.onNotificationMessageClicked(context, message)
    }
}
