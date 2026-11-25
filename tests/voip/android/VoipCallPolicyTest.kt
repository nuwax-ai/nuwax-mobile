package com.nuwax.voip

object VoipCallPolicyTest {
    @JvmStatic fun main(args: Array<String>) {
        explicitCallIdMustMatch(); onlyAUserRejectionProducesDeclined()
        staleRingingSignalsCannotTerminateAnAcceptedCall(); userHangupIsDistinctFromCancelAndReject()
        standaloneQaCannotRestoreProductionIdentity()
        releaseOriginRequiresAnExplicitMatchingHttpsPin()
        incomingSoundHonorsSilenceAndExplicitChoices()
        presentedNotificationRingsOnlyWhenAllowedAndTheServiceIsNotRinging()
        unlockedBackgroundUiOpensForAudioAndVideo()
        notificationAnswerPreservesTheInvitationMedia()
        duplicatedInvitationsCannotRestartOrStopTheRingingNotification()
        showingTheCallUiReplacesTheAlertWithoutRearmingIt()
        endingOrAnsweringReleasesTheIncomingNotificationSlot()
        ringTimeStartsAfterInvitationAcknowledgement(); activeHangupDoesNotSendLegacyCancel()
        reconnectMustNotLookLikeRemoteHangup(); authFailuresAreSeparateFromNotificationFailures()
        println("17 Kotlin call policy cases passed")
    }
    private fun ringTimeStartsAfterInvitationAcknowledgement() {
        check(VoipCallPolicy.ringDeadline(120000, 120500) == 180000L)
        check(VoipCallPolicy.ringDeadline(0, 120500) == 180500L)
        check(VoipCallPolicy.ringDeadline(1000000, 120500) == 180500L) // no clock-skew extension
        check(VoipCallPolicy.ringDeadline(1000, 120500) < 120500) // stale idempotent response
        check(VoipCallPolicy.PREPARE_TIMEOUT_MS == 30000L)
    }
    private fun activeHangupDoesNotSendLegacyCancel() {
        check(VoipCallPolicy.businessEndAction(true, "active", "ended") == null)
        check(VoipCallPolicy.businessEndAction(true, "connecting", "cancelled") == "ended")
        check(VoipCallPolicy.businessEndAction(true, "ringing", "timeout") == "ended")
        check(VoipCallPolicy.businessEndAction(false, "ringing", "rejected") == "declined")
        check(VoipCallPolicy.businessEndAction(false, "connecting", "rejected") == null)
        check(VoipCallPolicy.businessEndAction(true, "ringing", "remoteEnded") == null)
    }
    private fun reconnectMustNotLookLikeRemoteHangup() {
        check(!VoipCallPolicy.shouldFinishRemoteLeft(true, 0, true, true))
        check(!VoipCallPolicy.shouldFinishRemoteLeft(true, 1, false, true))
        check(!VoipCallPolicy.shouldFinishRemoteLeft(false, 0, false, true))
        check(!VoipCallPolicy.shouldFinishRemoteLeft(true, 0, false, false))
        check(VoipCallPolicy.shouldFinishRemoteLeft(true, 0, false, true))
    }
    private fun authFailuresAreSeparateFromNotificationFailures() {
        check(VoipCallPolicy.isAuthenticationFailure(401)); check(VoipCallPolicy.isAuthenticationFailure(403))
        check(!VoipCallPolicy.isAuthenticationFailure(500)); check(!VoipCallPolicy.isAuthenticationFailure(404))
    }
    private fun incomingSoundHonorsSilenceAndExplicitChoices() {
        val notification = "default-notification"; val ringtone = "default-ringtone"; val bundled = "bundled-ringtone"
        fun sound(exists: Boolean, old: String?, chosen: Boolean?) =
            VoipCallPolicy.invitationSound(exists, old, chosen, setOf(notification, ringtone), bundled)
        check(sound(false, null, null) == bundled)
        check(sound(true, notification, false) == bundled)
        check(sound(true, ringtone, false) == bundled)
        check(sound(true, ringtone, true) == ringtone)
        check(sound(true, ringtone, null) == ringtone)
        check(sound(true, notification, true) == notification)
        check(sound(true, notification, null) == notification) // old OS cannot inspect user choice
        check(sound(true, "custom", false) == "custom")
        check(sound(true, "custom", true) == "custom")
        check(sound(true, null, false) == null)
        check(sound(true, null, true) == null)
    }
    private fun presentedNotificationRingsOnlyWhenAllowedAndTheServiceIsNotRinging() {
        check(VoipCallPolicy.notificationRings(incoming = true, presentedSoundAllowed = null, serviceRings = false))
        check(!VoipCallPolicy.notificationRings(incoming = true, presentedSoundAllowed = true, serviceRings = true))
        check(VoipCallPolicy.notificationRings(incoming = true, presentedSoundAllowed = true, serviceRings = false))
        check(!VoipCallPolicy.notificationRings(incoming = true, presentedSoundAllowed = false, serviceRings = false))
        check(!VoipCallPolicy.notificationRings(incoming = false, presentedSoundAllowed = null, serviceRings = false))
    }
    private fun duplicatedInvitationsCannotRestartOrStopTheRingingNotification() {
        val gate = VoipIncomingNotificationGate()
        check(gate.publish("call-a", true))
        repeat(5) { check(!gate.publish("call-a", true)) }
        check(gate.publish("call-b", true))
        check(!gate.publish("call-b", true))
    }
    private fun unlockedBackgroundUiOpensForAudioAndVideo() {
        check(VoipCallPolicy.shouldOpenBackgroundCallUi(locked = false, mediaType = "audio"))
        check(VoipCallPolicy.shouldOpenBackgroundCallUi(locked = false, mediaType = "video"))
        check(!VoipCallPolicy.shouldOpenBackgroundCallUi(locked = false, mediaType = ""))
        check(VoipCallPolicy.shouldOpenBackgroundCallUi(locked = true, mediaType = "audio"))
        check(!VoipCallPolicy.shouldOpenBackgroundCallUi(locked = true, mediaType = "video"))
    }
    private fun notificationAnswerPreservesTheInvitationMedia() {
        check(VoipCallPolicy.answerMediaType(invited = "video", requested = null) == "video")
        check(VoipCallPolicy.answerMediaType(invited = "audio", requested = null) == "audio")
        check(VoipCallPolicy.answerMediaType(invited = "video", requested = "video") == "video")
        check(VoipCallPolicy.answerMediaType(invited = "video", requested = "audio") == "audio")
        check(VoipCallPolicy.answerMediaType(invited = "audio", requested = "video") == "audio")
    }
    private fun showingTheCallUiReplacesTheAlertWithoutRearmingIt() {
        val gate = VoipIncomingNotificationGate()
        check(gate.publish("direct", incoming = true, uiVisible = true))
        check(gate.wasPresented("direct"))
        check(gate.wasPresentedFirst("direct"))
        check(!gate.publish("direct", incoming = true, uiVisible = false))
        check(gate.publish("fallback", incoming = true))
        check(!gate.wasPresented("fallback"))
        check(gate.publish("fallback", incoming = true, uiVisible = true))
        check(gate.wasPresented("fallback"))
        check(!gate.wasPresentedFirst("fallback"))
        check(!gate.publish("fallback", incoming = true, uiVisible = true))
        check(!gate.publish("fallback", incoming = true, uiVisible = false))
        gate.reset()
        check(!gate.wasPresented("fallback"))
    }
    private fun endingOrAnsweringReleasesTheIncomingNotificationSlot() {
        val gate = VoipIncomingNotificationGate()
        check(gate.publish("call-a", true, uiVisible = true))
        check(gate.wasPresentedFirst("call-a"))
        check(gate.publish("call-a", false)) // silent connecting notification must replace the alert
        check(!gate.wasPresentedFirst("call-a"))
        check(gate.publish("call-a", false))
        check(gate.publish("call-b", true))
        gate.reset() // hangup/logout/media failure must not leave a notification owner
        check(gate.publish("call-c", true))
        gate.reset() // failed publication may retry
        check(gate.publish("call-c", true))
    }
    private fun standaloneQaCannotRestoreProductionIdentity() {
        check(VoipCallPolicy.originAllowed(null, "https://agent.nuwax.com"))
        check(VoipCallPolicy.originAllowed("https://testagent.xspaceagi.com", "https://testagent.xspaceagi.com"))
        check(!VoipCallPolicy.originAllowed("https://testagent.xspaceagi.com", "https://agent.nuwax.com"))
        check(!VoipCallPolicy.originAllowed("https://testagent.xspaceagi.com", "https://testagent.xspaceagi.com.evil.example"))
    }
    private fun releaseOriginRequiresAnExplicitMatchingHttpsPin() {
        val origin = "https://release.example"
        check(!VoipCallPolicy.releaseOriginAllowed(null, origin))
        check(!VoipCallPolicy.releaseOriginAllowed(origin, "https://test.example"))
        check(!VoipCallPolicy.releaseOriginAllowed("http://release.example", "http://release.example"))
        check(VoipCallPolicy.releaseOriginAllowed(origin, origin))
    }
    private fun explicitCallIdMustMatch() {
        check(!VoipCallPolicy.matches("old", "m1", "new", "m1"))
        check(VoipCallPolicy.matches("", "m1", "new", "m1"))
        check(!VoipCallPolicy.matches("", "", "new", ""))
    }
    private fun onlyAUserRejectionProducesDeclined() {
        for (reason in listOf("timeout", "systemFailed", "mediaFailed", "busy", "ended")) check(!VoipCallPolicy.canDecline(reason, "ringing")) { reason }
        check(VoipCallPolicy.canDecline("rejected", "ringing"))
        check(!VoipCallPolicy.canDecline("rejected", "active"))
    }
    private fun staleRingingSignalsCannotTerminateAnAcceptedCall() {
        for (state in listOf("connecting", "active")) {
            check(VoipCallPolicy.signalEndReason("voip:decline", state) == null)
            check(VoipCallPolicy.signalEndReason("voip:timeout", state) == null)
            check(VoipCallPolicy.signalEndReason("voip:cancel", state) == "remoteEnded")
        }
    }
    private fun userHangupIsDistinctFromCancelAndReject() {
        check(VoipCallPolicy.endReason("active", true) == "ended")
        check(VoipCallPolicy.endReason("ringing", false) == "cancelled")
        check(VoipCallPolicy.endReason("ringing", true) == "rejected")
    }
}
