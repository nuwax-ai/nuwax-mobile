package com.nuwax.voip

object VoipCallPolicyTest {
    @JvmStatic fun main(args: Array<String>) {
        explicitCallIdMustMatch(); onlyAUserRejectionProducesDeclined()
        staleRingingSignalsCannotTerminateAnAcceptedCall(); userHangupIsDistinctFromCancelAndReject()
        standaloneQaCannotRestoreProductionIdentity()
        println("5 Kotlin call policy cases passed")
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
