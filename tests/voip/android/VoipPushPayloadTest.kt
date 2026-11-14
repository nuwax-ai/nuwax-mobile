package com.nuwax.voip

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class VoipPushPayloadTest {
    private val locator = """{"type":"voip","convId":"1987654321098765432","msgId":"1987654321098765433"}"""

    @Test fun routesForcedNotificationBeforeTheUniPushReceiveCallback() {
        val envelope = JSONObject().put("force_notification", true).put("title", "Call")
            .put("payload", JSONObject(locator).put("token", "fixture-do-not-forward"))
        val call = JSONObject(VoipPushPayload.invitation(envelope.toString())!!)
        assertEquals("1987654321098765432", call.getString("convId"))
        assertEquals("1987654321098765433", call.getString("msgId"))
        assertEquals(3, call.length())
        assertFalse(call.has("token"))
    }

    @Test fun supportsJsonStringPayloadAndNestedDataWithoutLosingInt64Ids() {
        val envelope = JSONObject().put("data", JSONObject().put("payload", locator))
        assertEquals(JSONObject(locator).toString(), JSONObject(VoipPushPayload.invitation(envelope.toString())!!).toString())
        assertNotNull(VoipPushPayload.invitation("""{"kind":"voip.invite","convId":1987654321098765432,"msgId":1987654321098765433}"""))
    }

    @Test fun leavesOrdinaryAndUnrecognizedPushesWithTheSdk() {
        for (raw in listOf("{}", "not-json", "[]", """{"type":"message","convId":"1","msgId":"2"}""", """{"title":"Call","convId":"1","msgId":"2"}""")) {
            assertNull(raw, VoipPushPayload.invitation(raw))
        }
    }

    @Test fun rejectsMissingMalformedAndAlreadyRoundedIds() {
        for (conv in listOf("null", "0", "-1", "1.5", "1e18", "9223372036854775808", "\"../calls\"", "\"001\"")) {
            assertNull(conv, VoipPushPayload.invitation("""{"type":"voip","convId":$conv,"msgId":"2"}"""))
        }
        assertNull(VoipPushPayload.invitation("""{"type":"voip","convId":"1"}"""))
    }

    @Test fun boundsEnvelopeSizeAndRecursion() {
        var value = JSONObject(locator)
        repeat(4) { value = JSONObject().put("payload", value) }
        assertNotNull(VoipPushPayload.invitation(value.toString()))
        assertNull(VoipPushPayload.invitation(JSONObject().put("payload", value).toString()))
        assertNull(VoipPushPayload.invitation(" ".repeat(8193)))
    }
}
