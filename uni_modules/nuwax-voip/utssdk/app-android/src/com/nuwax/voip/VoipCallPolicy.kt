package com.nuwax.voip

/** Business policy, independent from Telecom/media, and executable on the JVM. */
internal object VoipCallPolicy {
    const val PREPARE_TIMEOUT_MS = 30000L
    const val REMOTE_LEFT_GRACE_MS = 3000L
    fun ringDeadline(sendTime: Long, acknowledgedAt: Long): Long =
        (if (sendTime > 0) minOf(sendTime, acknowledgedAt) else acknowledgedAt) + 60000L
    fun isAuthenticationFailure(status: Int) = status == 401 || status == 403
    fun businessEndAction(caller: Boolean, state: String, reason: String): String? = when {
        reason in listOf("remoteEnded", "remoteCancelled", "answeredElsewhere", "sessionChanged") -> null
        caller && state in listOf("ringing", "connecting") -> "ended"
        !caller && canDecline(reason, state) -> "declined"
        else -> null
    }
    fun shouldFinishRemoteLeft(everHadRemote: Boolean, remoteCount: Int, reconnecting: Boolean, graceElapsed: Boolean) =
        everHadRemote && remoteCount == 0 && !reconnecting && graceElapsed
    /** Null userSetSound means pre-30: preserve the existing choice when it cannot be inspected. */
    fun invitationSound(previousExists: Boolean, previousSound: String?, userSetSound: Boolean?,
                        oldDefaults: Set<String>, bundledSound: String): String? =
        if (!previousExists || (userSetSound == false && previousSound in oldDefaults)) bundledSound
        else previousSound

    fun originAllowed(fixedOrigin: String?, origin: String): Boolean = fixedOrigin.isNullOrEmpty() || fixedOrigin == origin
    fun releaseOriginAllowed(fixedOrigin: String?, origin: String): Boolean =
        !fixedOrigin.isNullOrEmpty() && origin == fixedOrigin && origin.startsWith("https://")

    fun shouldOpenBackgroundCallUi(locked: Boolean, mediaType: String): Boolean =
        mediaType == "audio" || (!locked && mediaType == "video")

    fun answerMediaType(invited: String, requested: String?): String =
        if (invited == "video" && (requested == null || requested == "video")) "video" else "audio"

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

/** Allow an alert to move to the notification shade once the call UI has appeared. */
internal class VoipIncomingNotificationGate {
    private var incomingId: String? = null
    private var presented = false
    private var presentedFirst = false

    fun publish(id: String, incoming: Boolean, uiVisible: Boolean = false): Boolean {
        if (!incoming) { reset(); return true }
        if (id == incomingId && (presented || !uiVisible)) return false
        if (id != incomingId) presentedFirst = uiVisible
        incomingId = id
        presented = uiVisible
        return true
    }

    fun wasPresented(id: String) = incomingId == id && presented
    fun wasPresentedFirst(id: String) = incomingId == id && presentedFirst

    fun reset() {
        incomingId = null
        presented = false
        presentedFirst = false
    }
}
