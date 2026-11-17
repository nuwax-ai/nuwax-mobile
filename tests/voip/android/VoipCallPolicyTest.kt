package com.nuwax.voip

object VoipCallPolicyTest {
    @JvmStatic fun main(args: Array<String>) {
        explicitCallIdMustMatch(); onlyAUserRejectionProducesDeclined()
        staleRingingSignalsCannotTerminateAnAcceptedCall(); userHangupIsDistinctFromCancelAndReject()
        standaloneQaCannotRestoreProductionIdentity()
        incomingSoundHonorsSilenceAndExplicitChoices()
        duplicatedInvitationsCannotRestartOrStopTheRingingNotification()
        endingOrAnsweringReleasesTheIncomingNotificationSlot()
        println("8 Kotlin call policy cases passed")
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
    private fun duplicatedInvitationsCannotRestartOrStopTheRingingNotification() {
        val gate = VoipIncomingNotificationGate()
        check(gate.publish("call-a", true))
        repeat(5) { check(!gate.publish("call-a", true)) }
        check(gate.publish("call-b", true))
        check(!gate.publish("call-b", true))
    }
    private fun endingOrAnsweringReleasesTheIncomingNotificationSlot() {
        val gate = VoipIncomingNotificationGate()
        check(gate.publish("call-a", true))
        check(gate.publish("call-a", false)) // silent connecting notification must replace the alert
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
