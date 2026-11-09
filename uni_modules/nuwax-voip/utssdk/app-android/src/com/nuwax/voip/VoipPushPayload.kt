package com.nuwax.voip

import org.json.JSONObject

/** The push is only a locator. Native incoming() still verifies the message and its parties. */
object VoipPushPayload {
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
            // Do not forward tokens, URLs or unrelated notification fields to the call bridge.
            return JSONObject().put("type", "voip").put("convId", conv).put("msgId", message)
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
}
