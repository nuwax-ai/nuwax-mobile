package com.nuwax.voip

/** Business policy, independent from Telecom/media, and executable on the JVM. */
internal object VoipCallPolicy {
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
