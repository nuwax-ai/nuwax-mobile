package com.nuwax.voip

/** Business policy, independent from Telecom/media, and executable on the JVM. */
internal object VoipCallPolicy {
    /** Null userSetSound means pre-30: preserve the existing choice when it cannot be inspected. */
    fun incomingSound(legacyExists: Boolean, legacySound: String?, userSetSound: Boolean?,
                      defaultNotification: String, defaultRingtone: String?): String? =
        if (legacyExists && (legacySound == null || legacySound != defaultNotification || userSetSound != false)) legacySound
        else defaultRingtone

    fun originAllowed(fixedOrigin: String?, origin: String): Boolean = fixedOrigin.isNullOrEmpty() || fixedOrigin == origin

    fun matches(signalId: String, messageId: String, callId: String, callMessageId: String): Boolean =
        if (signalId.isNotEmpty()) signalId == callId else messageId.isNotEmpty() && callMessageId.isNotEmpty() && messageId == callMessageId

    fun canDecline(reason: String, state: String) = reason == "rejected" && state == "ringing"
    fun endReason(state: String, callee: Boolean) = if (state != "ringing") "ended" else if (callee) "rejected" else "cancelled"
    fun signalEndReason(type: String, state: String): String? = when {
        type == "voip:cancel" -> if (state == "ringing") "remoteCancelled" else "remoteEnded"
        type == "voip:timeout" && state == "ringing" -> "timeout"
        type == "voip:decline" && state == "ringing" -> "rejected"
        else -> null
    }
}

/** One incoming notification per call: reposting ONLY_ALERT_ONCE would stop an ongoing ringtone. */
internal class VoipIncomingNotificationGate {
    private var incomingId: String? = null
    fun publish(id: String, incoming: Boolean): Boolean {
        if (!incoming) { incomingId = null; return true }
        if (id == incomingId) return false
        incomingId = id
        return true
    }
    fun reset() { incomingId = null }
}
