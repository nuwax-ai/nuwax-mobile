package com.nuwax.voip

import org.json.JSONObject

/** The push is only a locator. Native incoming() still verifies the message and its parties. */
object VoipPushPayload {
    private const val NATIVE = "android-native"
    private val callId = Regex("[A-Za-z0-9_-]{1,128}")

    @JvmStatic fun invitation(raw: String): String? {
        if (raw.length > 8192) return null
        return runCatching { find(JSONObject(raw), 0)?.toString() }.getOrNull()
    }

    private fun id(value: Any?): String? {
        // Do not silently accept IDs already rounded by a floating-point JSON producer.
        if (value !is String && value !is Long && value !is Int) return null
        val text = value.toString()
        return text.takeIf { it.matches(Regex("[1-9][0-9]{0,18}")) && it.toLongOrNull() != null }
    }

    private fun find(value: JSONObject, depth: Int): JSONObject? {
        if (depth > 4) return null
        if (value.optString("type") == "voip" || value.optString("kind") == "voip.invite") {
            val conv = id(value.opt("convId")) ?: return null
            val message = id(value.opt("msgId")) ?: return null
            val meeting = value.optString("scene") == "meeting"
            // Do not forward tokens, URLs or unrelated notification fields to the call bridge.
            val locator = JSONObject().put("type", "voip").put("convId", conv).put("msgId", message)
            if (value.has("pushEnvironment")) {
                val environment = value.opt("pushEnvironment")
                if (environment != "test" && environment != "production") return null
                locator.put("pushEnvironment", environment)
            }
            if (meeting) locator.put("scene", "meeting")
            if (!value.has("delivery")) return locator
            if (!isNative(value) || value.opt("convId") !is String || value.opt("msgId") !is String) return null
            val call = (value.opt("callId") as? String)?.takeIf(callId::matches) ?: return null
            val callee = (value.opt("calleeId") as? String)?.takeIf(callId::matches) ?: return null
            val media = (value.opt("mediaType") as? String)?.takeIf { it == "audio" || it == "video" } ?: return null
            val expiry = integer(value.opt("expiresAt")) ?: return null
            val invitation = locator.put("delivery", NATIVE).put("callId", call).put("calleeId", callee)
                .put("mediaType", media).put("expiresAt", expiry)
            if (meeting) {
                val invite = (value.opt("inviteId") as? String)
                    ?.takeIf { it.matches(Regex("[A-Za-z0-9._-]{1,128}")) } ?: return null
                val room = (value.opt("roomName") as? String)
                    ?.takeIf { it.matches(Regex("[A-Za-z0-9._-]{1,128}")) } ?: return null
                invitation.put("inviteId", invite).put("roomName", room)
                (value.opt("title") as? String)?.takeIf { it.isNotBlank() }
                    ?.let { invitation.put("title", it.take(80)) }
            }
            return invitation
        }
        for (key in listOf("payload", "data")) {
            val child = value.opt(key)
            val objectValue = when (child) {
                is JSONObject -> child
                is String -> runCatching { JSONObject(child) }.getOrNull()
                else -> null
            }
            if (objectValue != null) find(objectValue, depth + 1)?.let { return it }
        }
        return null
    }

    private fun integer(value: Any?): Long? = when (value) {
        is Long -> value
        is Int -> value.toLong()
        else -> null
    }

    fun isNative(invitation: JSONObject): Boolean = invitation.opt("delivery") == NATIVE

    internal fun isSilentMeeting(body: JSONObject): Boolean = body.optBoolean("silent")

    fun eligible(invitation: JSONObject, user: String, now: Long): Boolean =
        isNative(invitation) && user.isNotEmpty() && invitation.opt("calleeId") == user &&
            invitation.optLong("expiresAt") in (now + 1)..(now + 65_000)

    fun matches(invitation: JSONObject, message: JSONObject, user: String, now: Long): Boolean {
        if (!eligible(invitation, user, now)) return false
        val body = message.optJSONObject("body") ?: return false
        val sent = integer(message.opt("sendTime")) ?: return false
        val sameLocator = id(message.opt("convId")) == invitation.opt("convId") &&
            id(message.opt("msgId")) == invitation.opt("msgId")
        if (invitation.optString("scene") == "meeting") {
            return message.opt("msgType") == "meeting_invite" && !isSilentMeeting(body) &&
                message.optInt("senderType", 1) == 1 && message.optInt("msgStatus", 1) == 1 && sameLocator &&
                body.opt("inviteId") == invitation.opt("inviteId") &&
                body.opt("roomName") == invitation.opt("roomName") &&
                sent > 0 && sent <= now + 5_000 && invitation.optLong("expiresAt") <= sent + 60_000
        }
        return message.opt("msgType") == "voip" && sameLocator &&
            body.opt("callId") == invitation.opt("callId") && body.opt("mediaType") == invitation.opt("mediaType") &&
            sent > 0 && sent <= now + 5_000 && invitation.optLong("expiresAt") <= sent + 60_000
    }
}
