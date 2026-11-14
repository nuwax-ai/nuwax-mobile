package com.nuwax.voip

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.telecom.DisconnectCause
import android.widget.FrameLayout
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.telecom.*
import io.livekit.android.LiveKit
import io.livekit.android.LiveKitOverrides
import io.livekit.android.AudioOptions
import io.livekit.android.audio.NoAudioHandler
import io.livekit.android.events.collect
import io.livekit.android.events.RoomEvent
import io.livekit.android.room.Room
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.renderer.TextureViewRenderer
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.lang.ref.WeakReference
import java.security.KeyStore
import java.util.UUID
import java.util.concurrent.ConcurrentLinkedQueue
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import android.util.Base64
import android.util.Log

/** Singleton survives the UTS page. Cold-start push integrations call incoming() directly. */
object VoipBridge {
    @JvmStatic fun isTestPackage(ctx: Context): Boolean {
        if ((ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) return false
        return runCatching { ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA).metaData?.getBoolean("nuwax.voip.deviceTest", false) == true }.getOrDefault(false)
    }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val queue = ConcurrentLinkedQueue<JSONObject>()
    private val http = OkHttpClient.Builder().callTimeout(4, TimeUnit.SECONDS).build()
    private val streamHttp = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
    private var context: Context? = null
    private var config = JSONObject()
    private var generation = 0
    private var current: JSONObject? = null
    private var imSocket: WebSocket? = null
    private var streamCall: Call? = null
    private fun business() = config.optString("protocol") == "im-voip-v1"
    private var streamJob: Job? = null
    private var mediaJob: Job? = null
    private var expiryJob: Job? = null
    private var telecomJob: Job? = null
    private var telecomReady: CompletableDeferred<CallControlScope?>? = null
    private var telecomCleanup: Job? = null
    private var control: CallControlScope? = null
    private var calls: CallsManager? = null
    private var room: Room? = null
    private var mediaId = ""
    private var peerReady = false
    private var connected = false
    private var reconnecting = false
    private var readySent = false
    private var microphone = true
    private var camera = false
    private var hidden = false
    private var nativeUiId = ""
    private var speaker = false
    private val terminal = LinkedHashSet<String>()
    private val views = mutableMapOf<FrameLayout, String>()
    private val renderers = mutableMapOf<FrameLayout, TextureViewRenderer>()
    private val bindings = mutableMapOf<FrameLayout, VideoTrack>()
    private var activity = WeakReference<Activity>(null)
    private const val PREFIX = "/api/instant-message/calls"

    /** Only lifecycle stages: never log invitations, identities, URLs or credentials. */
    private fun trace(stage: String) {
        if (((context?.applicationInfo?.flags ?: 0) and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0) Log.d("NuwaxVoip", stage)
    }

    @JvmStatic fun setActivity(value: Activity) { activity = WeakReference(value) }
    private fun cameraVisible() = !hidden || nativeUiId == current?.optString("callId")
    @JvmStatic fun presentationStatus(ctx: Context): String {
        val manager = ctx.getSystemService(NotificationManager::class.java)
        val channel = manager.getNotificationChannel("nuwax-voip")
        return JSONObject().put("supported", true)
            .put("bundleId", ctx.packageName)
            .put("developmentListener", VoipDevControlService.running)
            .put("uniPushConfigured", ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA).metaData?.getBoolean("nuwax.voip.uniPush", false) == true)
            .put("notificationsAllowed", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
            .put("fullScreenAllowed", Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent())
            .put("channelEnabled", channel == null || channel.importance >= NotificationManager.IMPORTANCE_HIGH).toString()
    }
    @JvmStatic fun openPresentationSettings(ctx: Context) {
        val intent = if (Build.VERSION.SDK_INT >= 34) Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, Uri.parse("package:" + ctx.packageName))
            else Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
        ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    @JvmStatic fun openAppSettings(ctx: Context) {
        ctx.startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + ctx.packageName)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
    internal fun label(key: String): String = config.optJSONObject("labels")?.optString(key, key) ?: key
    internal fun developmentListenerAllowed(ctx: Context): Boolean = isTestPackage(ctx) && config.optBoolean("development") && config.optString("accessToken").isNotEmpty()
    internal fun uiSnapshot(id: String): JSONObject? {
        val value = current ?: return null
        if (value.optString("callId") != id || value.optString("state") == "ended") return null
        return JSONObject(value.toString()).put("incoming", value.optString("calleeId") == config.optString("userId"))
            .put("microphone", microphone).put("camera", camera).put("speaker", speaker)
            .put("mediaReady", connected && peerReady).put("reconnecting", reconnecting)
    }
    internal fun nativeVisible(id: String, visible: Boolean) {
        if (visible && current?.optString("callId") == id) nativeUiId = id
        else if (!visible && nativeUiId == id) nativeUiId = ""
        scope.launch {
            try {
                if (room != null) VoipCallService.enableCapture(camera && cameraVisible())
                room?.localParticipant?.setCameraEnabled(camera && cameraVisible())
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (current?.optString("callId") == id) emit("error", "code", "CALL_NATIVE_FAILED") }
        }
    }
    internal fun uiCommand(id: String, op: String, enabled: Boolean = false, mediaType: String = "audio") {
        if (id != current?.optString("callId")) return
        val command = JSONObject().put("scope", config.optString("scope")).put("callId", id).put("op", op).put("enabled", enabled)
        if (op == "action") command.put("action", "accept").put("answerMediaType", mediaType)
        context?.let { execute(it, command.toString()) }
    }
    @JvmStatic fun execute(ctx: Context, raw: String) {
        context = ctx.applicationContext
        scope.launch {
            try {
                val command = JSONObject(raw)
                if (command.optString("op") == "initialize") { initialize(command); return@launch }
                if (command.optString("op") == "reset") { reset(); return@launch }
                if (command.optString("scope") != config.optString("scope")) return@launch
                if (command.optString("op") in listOf("action", "microphone", "camera", "speaker", "audioRoute", "switchCamera") &&
                    command.optString("callId") != current?.optString("callId")) return@launch
                when (command.optString("op")) {
                    "developmentListener" -> {
                        if (command.optBoolean("enabled")) {
                            check(developmentListenerAllowed(ctx) && !hidden)
                            ContextCompat.startForegroundService(ctx, Intent(ctx, VoipDevControlService::class.java))
                        } else ctx.stopService(Intent(ctx, VoipDevControlService::class.java))
                    }
                    "reset" -> reset()
                    "watch" -> adopt(command.getJSONObject("snapshot"))
                    "invitation" -> if (business()) receiveInvitation(api("/api/instant-message/messages/" + Uri.encode(command.getString("msgId")) + "?convId=" + Uri.encode(command.getString("convId")), absolute = true))
                    "action" -> act(command.optString("action"), command.optString("answerMediaType", "audio"))
                    "microphone" -> setMicrophone(command.optBoolean("enabled"))
                    "camera" -> setCamera(command.optBoolean("enabled"))
                    "speaker" -> setSpeaker(command.optBoolean("enabled"))
                    "switchCamera" -> (room?.localParticipant?.getTrackPublication(Track.Source.CAMERA)?.track as? LocalVideoTrack)?.switchCamera()
                    "background" -> {
                        hidden = command.optBoolean("hidden")
                        room?.localParticipant?.setCameraEnabled(camera && cameraVisible())
                        if (room != null) VoipCallService.enableCapture(camera && cameraVisible())
                        if (!hidden && activity.get()?.intent?.getBooleanExtra("nuwaxVoip", false) == true) {
                            activity.get()?.intent?.removeExtra("nuwaxVoip"); emit("openPage")
                        }
                    }
                    "audioRoute" -> setAudioRoute(command.optString("route"))
                }
            } catch (_: Exception) { emit("error", "code", "CALL_NATIVE_FAILED") }
        }
    }

    private fun initialize(value: JSONObject) {
        trace("initialize requested")
        val debug = ((context?.applicationInfo?.flags ?: 0) and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (!value.optBoolean("development") && !value.optBoolean("qaAccepted") && !(debug && value.optBoolean("businessEnabled"))) return
        if (value.optBoolean("development") && ((context?.applicationInfo?.flags ?: 0) and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) return
        val base = Uri.parse(value.optString("apiBaseUrl"))
        if (base.host.isNullOrEmpty() || (base.scheme != "https" && !(value.optBoolean("development") && base.scheme == "http"))) return
        if (value.optString("userId").isEmpty() || value.optString("accessToken").isEmpty()) return
        val same = config.optString("userId") == value.optString("userId") && config.optString("apiBaseUrl") == value.optString("apiBaseUrl") && config.optString("deviceId") == value.optString("deviceId")
        if (!same) reset()
        config = value
        trace(if (business()) "business session accepted" else "development session accepted")
        hidden = activity.get() == null || value.optBoolean("background")
        saveConfig()
        if (calls == null) {
            calls = CallsManager(context!!)
            calls!!.registerAppWithTelecom(CallsManager.CAPABILITY_BASELINE or CallsManager.CAPABILITY_SUPPORTS_VIDEO_CALLING)
        }
        startStream()
        current?.let { emitSnapshot(it); if (connected) emit("connected"); if (peerReady) emit("peerMediaReady") }
    }

    private fun emit(type: String, key: String = "", value: Any = "") {
        val event = JSONObject().put("type", type).put("scope", config.optString("scope")).put("callId", current?.optString("callId") ?: "")
        if (key.isNotEmpty()) event.put(key, value)
        queue.add(event)
        while (queue.size > 256) queue.poll()
    }
    private fun emitSnapshot(value: JSONObject) {
        val event = JSONObject().put("type", "snapshot").put("scope", config.optString("scope"))
            .put("callId", value.optString("callId")).put("snapshot", JSONObject(value.toString())).put("nativeIncomingUI", true)
        queue.add(event)
        while (queue.size > 256) queue.poll()
    }
    @JvmStatic fun drainEvents(): String {
        val result = JSONArray()
        while (true) result.put(queue.poll() ?: break)
        return result.toString()
    }

    private suspend fun api(path: String, data: JSONObject? = null, absolute: Boolean = false, captured: JSONObject? = null): JSONObject {
        val owner = generation
        val settings = captured ?: JSONObject(config.toString())
        val result = withContext(Dispatchers.IO) {
            val request = Request.Builder().url(settings.getString("apiBaseUrl") + (if (absolute) "" else PREFIX) + path)
                .header("Authorization", "Bearer " + settings.getString("accessToken"))
                .header("X-Call-Device-Id", settings.getString("deviceId"))
            if (data != null) request.post(data.toString().toRequestBody("application/json".toMediaType()))
            http.newCall(request.build()).execute().use { response ->
                if (!response.isSuccessful) error("CALL_SERVICE_UNAVAILABLE")
                val envelope = JSONObject(response.body?.string() ?: "{}")
                if (envelope.optString("code") != "0000") error(envelope.optString("code", "CALL_SERVICE_UNAVAILABLE"))
                envelope.getJSONObject("data")
            }
        }
        if (captured == null) check(owner == generation) { "CALL_SESSION_CHANGED" }
        return result
    }

    private fun startStream() {
        imSocket?.cancel(); imSocket = null; streamCall?.cancel(); streamJob?.cancel()
        if (business()) { startImStream(); return }
        val run = generation
        val settings = JSONObject(config.toString())
        streamJob = scope.launch {
            var cursor = ""
            while (isActive && run == generation) {
                try {
                    withContext(Dispatchers.IO) {
                        val request = Request.Builder().url(settings.getString("apiBaseUrl") + PREFIX + "/events")
                            .header("Authorization", "Bearer " + settings.getString("accessToken"))
                            .header("X-Call-Device-Id", settings.getString("deviceId")).header("Last-Event-ID", cursor).build()
                        val connection = streamHttp.newCall(request); streamCall = connection
                        connection.execute().use { response ->
                            if (response.code == 401 || response.code == 403) { withContext(Dispatchers.Main) { if (settings.optString("accessToken") == config.optString("accessToken")) expireSession() }; return@use }
                            check(response.isSuccessful && response.header("Content-Type", "")!!.startsWith("text/event-stream"))
                            val source = response.body!!.source()
                            var data = ""
                            while (isActive && run == generation && !source.exhausted()) {
                                val line = source.readUtf8Line() ?: break
                                if (line.startsWith("id: ")) cursor = line.substring(4)
                                if (line.startsWith("data: ")) data = line.substring(6)
                                if (line.isEmpty() && data.isNotEmpty()) {
                                    val snapshot = JSONObject(data); data = ""
                                    withContext(Dispatchers.Main) { if (run == generation) adopt(snapshot) }
                                }
                            }
                        }
                    }
                } catch (_: Exception) { /* bounded reconnect; no credentials in logs */ }
                delay(1000)
            }
        }
    }

    /** Independent IM route: same physical base, separate tab; never registers a push device. */
    private fun startImStream() {
        val run = generation
        val settings = JSONObject(config.toString())
        streamJob = scope.launch {
            var retry = 1000L
            while (isActive && run == generation) {
                val closed = CompletableDeferred<Unit>()
                var rejected = false
                var heartbeat: Job? = null
                var lastFrame = System.currentTimeMillis()
                fun frame(op: Int, body: JSONObject = JSONObject()) = JSONObject().put("v", 1).put("op", op).put("reqId", UUID.randomUUID().toString()).put("ts", System.currentTimeMillis()).put("body", body).toString()
                val base = settings.getString("apiBaseUrl").replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
                val request = Request.Builder().url(base + "/instant-message/ws").header("Sec-WebSocket-Protocol", "im-v1").build()
                val socket = streamHttp.newWebSocket(request, object : WebSocketListener() {
                    override fun onOpen(ws: WebSocket, response: Response) {
                        trace("control socket opened")
                        ws.send(frame(1000, JSONObject().put("token", settings.getString("accessToken")).put("deviceId", settings.getString("deviceId").substringBefore('#') + "#voip").put("platform", "android").put("lastAckSeq", 0)))
                    }
                    override fun onMessage(ws: WebSocket, text: String) { scope.launch {
                        if (run != generation || imSocket !== ws) return@launch
                        try {
                            lastFrame = System.currentTimeMillis()
                            val envelope = JSONObject(text); val body = envelope.optJSONObject("body") ?: JSONObject()
                            when (envelope.optInt("op")) {
                                1001 -> {
                                    trace("control authenticated")
                                    retry = 1000L; heartbeat?.cancel()
                                    val interval = body.optLong("heartbeatInterval", 30).coerceIn(5, 60) * 1000
                                    heartbeat = launch { while (isActive) { delay(interval); if (System.currentTimeMillis() - lastFrame > interval * 2) { ws.cancel(); closed.complete(Unit); break }; ws.send(frame(2000)) } }
                                }
                                1002, 9000 -> { trace("control rejected"); rejected = true; emit("error", "code", "CALL_CONTROL_REJECTED"); ws.close(1000, null); closed.complete(Unit) }
                                3002 -> if (body.optString("msgType") == "voip") {
                                    trace("control invitation received")
                                    ws.send(frame(3003, JSONObject().put("convId", body.optString("convId")).put("seq", body.optLong("seq"))))
                                    receiveInvitation(body)
                                }
                                3007 -> receiveSignal(body)
                            }
                        } catch (_: Exception) { trace("control event failed"); emit("error", "code", "CALL_INVALID_EVENT") }
                    } }
                    override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) { trace("control socket failed"); closed.complete(Unit) }
                    override fun onClosed(ws: WebSocket, code: Int, reason: String) { trace("control socket closed"); closed.complete(Unit) }
                })
                imSocket = socket
                try { withTimeoutOrNull(10000) { while (heartbeat == null && !closed.isCompleted) delay(100) }; if (heartbeat == null) socket.cancel(); else closed.await() }
                finally { heartbeat?.cancel(); socket.cancel(); if (imSocket === socket) imSocket = null }
                if (rejected) return@launch
                delay(retry); retry = (retry * 2).coerceAtMost(30000)
            }
        }
    }
    private suspend fun receiveInvitation(message: JSONObject) {
        trace("invitation validating")
        if (message.optString("msgType") != "voip" || message.optInt("senderType", 1) != 1 || message.optInt("msgStatus", 1) != 1) return
        val body = message.optJSONObject("body") ?: return
        val id = body.optString("callId"); val conv = message.optString("convId"); val sender = message.optString("senderId")
        val media = body.optString("mediaType")
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,128}")) || body.optString("roomName").isEmpty() || media !in listOf("audio", "video") || sender == config.optString("userId")) return
        val sent = message.optLong("sendTime")
        if (sent <= 0 || sent + 60000 <= System.currentTimeMillis() || terminal.contains(id) || current?.optString("callId") == id) return
        val conversation = api("/api/instant-message/conversations/" + Uri.encode(conv), absolute = true)
        if (conversation.optInt("convType") != 1 || conversation.optString("peerUserId") != sender) return
        val next = JSONObject().put("protocol", "im-voip-v1").put("callId", id).put("roomName", body.getString("roomName")).put("msgId", message.getString("msgId")).put("convId", conv)
            .put("version", 1).put("state", "ringing").put("callerId", sender).put("calleeId", config.getString("userId")).put("callerDeviceId", "").put("acceptedDeviceId", "")
            .put("mediaType", media).put("callerDisplayName", conversation.optString("peerName", sender)).put("calleeDisplayName", config.getString("userId")).put("expiresAt", sent + 60000)
        if (current != null && current?.optString("callId") != id) { notifyBusinessEnd(next, "busy"); terminal.add(id); return }
        trace("invitation accepted"); adopt(next)
    }
    private fun receiveSignal(event: JSONObject) {
        val payload = event.optJSONObject("payload") ?: return
        val eventType = event.optString("eventType")
        val eventId = payload.optString("callId")
        if (eventType in listOf("voip:cancel", "voip:timeout", "voip:decline") && eventId.isNotEmpty()) { terminal.add(eventId); if (terminal.size > 128) terminal.remove(terminal.first()) }
        val call = current ?: return
        val sameId = (payload.optString("callId").isNotEmpty() && payload.optString("callId") == call.optString("callId")) || (payload.optString("msgId").isNotEmpty() && payload.optString("msgId") == call.optString("msgId"))
        if (payload.optString("convId") != call.optString("convId") || !sameId) return
        when (event.optString("eventType")) {
            "voip:answered" -> if (call.optString("calleeId") == config.optString("userId") && call.optString("acceptedDeviceId").isEmpty()) finish("answeredElsewhere")
            "voip:cancel", "voip:timeout", "voip:decline" -> { finish("remoteEnded") }
        }
    }
    private fun project(state: String, media: String? = null) {
        val old = current ?: return
        val next = JSONObject(old.toString()).put("state", state).put("version", old.optLong("version") + 1)
        if (media != null) next.put("mediaType", media)
        if (state == "connecting") next.put("acceptedDeviceId", config.getString("deviceId")).put("connectExpiresAt", System.currentTimeMillis() + 30000)
        if (state == "active") next.put("connectedAt", System.currentTimeMillis())
        adopt(next)
    }
    private suspend fun businessCredentials(call: JSONObject): JSONObject {
        val data = api("/api/instant-message/meetings/rtc/rooms/" + Uri.encode(call.getString("roomName")) + "/tokens", JSONObject().put("platform", "android").put("deviceId", config.getString("deviceId")).put("displayName", config.getString("userId")), true)
        return JSONObject().put("serverUrl", data.getString("wsUrl")).put("participantToken", data.getString("token"))
    }
    private fun businessBody(call: JSONObject) = JSONObject().put("convId", call.getString("convId")).put("msgId", call.getString("msgId")).put("callId", call.getString("callId")).put("roomName", call.getString("roomName"))
    private suspend fun mediaJoined() = withContext(NonCancellable) {
        val call = current ?: return@withContext
        val settings = JSONObject(config.toString()); val run = generation
        if (call.optString("callerId") == config.optString("userId")) {
            val invitation = JSONObject().put("convId", call.getString("convId")).put("deviceId", config.getString("deviceId")).put("clientMsgId", call.getString("callId")).put("msgType", "voip")
                .put("body", JSONObject().put("callId", call.getString("callId")).put("roomName", call.getString("roomName")).put("mediaType", call.getString("mediaType")))
            val response = api("/api/instant-message/messages", invitation, true, settings)
            if (run != generation || current?.optString("callId") != call.optString("callId")) { notifyBusinessEnd(JSONObject(call.toString()).put("msgId", response.getString("msgId")), "cancel", settings); return@withContext }
            current = JSONObject(current.toString()).put("msgId", response.getString("msgId")).put("version", current!!.optLong("version") + 1)
            emitSnapshot(current!!)
        } else api("/answered", businessBody(call))
    }
    private suspend fun businessAction(action: String, media: String) {
        val call = current ?: return
        when (action) {
            "accept" -> { if (call.optString("state") != "ringing") return; if (!permissions(media)) { emit("error", "code", "CALL_PERMISSION_REQUIRED"); return }; project("connecting", if (call.optString("mediaType") == "video") media else "audio") }
            "ready" -> if (connected && peerReady) project("active")
            "end", "cancel", "reject" -> finish(if (action == "reject") "rejected" else "cancel")
        }
    }
    private fun notifyBusinessEnd(call: JSONObject, reason: String, captured: JSONObject? = null) {
        val settings = captured ?: JSONObject(config.toString())
        if (call.optString("msgId").isEmpty() || reason in listOf("remoteEnded", "answeredElsewhere", "sessionChanged")) return
        val caller = call.optString("callerId") == settings.optString("userId")
        if (!caller && call.optString("state") != "ringing") return
        val body = businessBody(call); val path = if (caller) "/ended" else "/declined"
        if (caller) body.put("reason", if (reason == "timeout") "timeout" else "cancel")
        val request = Request.Builder().url(settings.getString("apiBaseUrl") + PREFIX + path).header("Authorization", "Bearer " + settings.getString("accessToken"))
            .post(body.toString().toRequestBody("application/json".toMediaType())).build()
        scope.launch(Dispatchers.IO) { runCatching { http.newCall(request).execute().close() } }
    }

    private fun adopt(snapshot: JSONObject) {
        val id = snapshot.optString("callId")
        if (id.isEmpty() || terminal.contains(id)) return
        val uid = config.optString("userId")
        if (snapshot.optString("callerId") != uid && snapshot.optString("calleeId") != uid) return
        val old = current
        fun rank(state: String) = listOf("ringing", "connecting", "active", "ended").indexOf(state)
        if (rank(snapshot.optString("state")) < 0 || snapshot.optLong("version") < 1) return
        if (old?.optString("callId") == id && rank(snapshot.optString("state")) < rank(old.optString("state"))) return
        if (old != null && old.optString("callId") != id && old.optString("state") != "ended") return
        if (old?.optString("callId") == id && snapshot.optLong("version") <= old.optLong("version")) return
        if (snapshot.optString("state") == "ringing" && snapshot.optLong("expiresAt") <= System.currentTimeMillis()) return
        val first = old == null || old.optString("callId") != id
        if (first) { microphone = true; camera = snapshot.optString("mediaType") == "video"; speaker = false }
        current = snapshot; emitSnapshot(snapshot)
        if (snapshot.optString("state") == "ended") { finish(); return }
        expiryJob?.cancel(); expiryJob = null
        val phase = snapshot.optString("state")
        if (phase == "ringing" || phase == "connecting") {
            val limit = if (phase == "ringing") (if (business()) 60000L else 45000L) else 30000L
            val deadline = snapshot.optLong(if (phase == "ringing") "expiresAt" else "connectExpiresAt", System.currentTimeMillis() + limit)
            expiryJob = scope.launch {
                delay((deadline - System.currentTimeMillis()).coerceIn(0L, limit))
                if (current?.optString("callId") == id && current?.optString("state") == phase) finish(if (phase == "ringing") "timeout" else "connectionTimeout")
            }
        }
        if (current?.optString("callId") != id || terminal.contains(id)) return
        val caller = snapshot.optString("callerId") == uid && snapshot.optString("callerDeviceId") == config.optString("deviceId")
        val accepted = snapshot.optString("acceptedDeviceId")
        val callee = snapshot.optString("calleeId") == uid
        if (callee && accepted.isNotEmpty() && accepted != config.optString("deviceId")) { finish("answeredElsewhere"); return }
        if (!caller && !callee) return
        if (telecomJob == null) addTelecom(snapshot, !caller)
        if (control != null) publishCall()
        if (first && callee && phase == "ringing" && !hidden) {
            try { context?.startActivity(VoipIncomingActivity.intent(context!!, id)) }
            catch (_: Exception) { emit("openPage") }
        }
        if ((snapshot.optString("state") != "ringing" || (business() && caller)) && (caller || accepted == config.optString("deviceId"))) connectMedia(snapshot)
    }

    private fun addTelecom(snapshot: JSONObject, incoming: Boolean) {
        val id = snapshot.optString("callId")
        val run = generation
        val ready = CompletableDeferred<CallControlScope?>()
        val previousCleanup = telecomCleanup
        telecomReady = ready
        fun ownsCall() = generation == run && current?.optString("callId") == id && !terminal.contains(id)
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                previousCleanup?.join()
                if (!ownsCall()) return@launch
                val attrs = CallAttributesCompat(snapshot.optString(if (incoming) "callerDisplayName" else "calleeDisplayName", "Nuwax"), Uri.parse("sip:" + snapshot.getString("callId")),
                    if (incoming) CallAttributesCompat.DIRECTION_INCOMING else CallAttributesCompat.DIRECTION_OUTGOING,
                    if (snapshot.optString("mediaType") == "video") CallAttributesCompat.CALL_TYPE_VIDEO_CALL else CallAttributesCompat.CALL_TYPE_AUDIO_CALL)
                calls!!.addCall(attrs,
                    onAnswer = { type -> if (ownsCall()) act("accept", if (type == CallAttributesCompat.CALL_TYPE_VIDEO_CALL) "video" else "audio") },
                    onDisconnect = { _ -> if (ownsCall()) act(if (current?.optString("state") == "ringing") (if (incoming) "reject" else "cancel") else "end") },
                    onSetActive = { if (ownsCall()) setMicrophone(microphone) },
                    onSetInactive = { if (ownsCall()) room?.localParticipant?.setMicrophoneEnabled(false); Unit }) {
                    val owner = this
                    ready.complete(owner)
                    // An invitation may end while Telecom is still creating its session.
                    // finish() waits for this scope and disconnects it before cancelling addCall.
                    if (!ownsCall()) return@addCall
                    control = owner
                    trace("telecom call registered")
                    // Telecom must own the call before asking for background phone-call execution.
                    // Posting CallStyle here also satisfies Core-Telecom's five-second deadline.
                    publishCall()
                    launch { isMuted.collect { muted -> if (control === owner) setMicrophone(!muted) } }
                    launch { currentCallEndpoint.collect { endpoint -> if (control === owner) { speaker = endpoint.type == CallEndpointCompat.TYPE_SPEAKER; emit("speaker", "enabled", speaker) } } }
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) {
                trace("telecom call failed")
                if (ownsCall()) { emit("error", "code", "CALL_SYSTEM_UNAVAILABLE"); finish("systemFailed") }
            } finally { if (!ready.isCompleted) ready.complete(null) }
        }
        telecomJob = job
        job.start()
    }

    private suspend fun act(action: String, answerMediaType: String = "audio") {
        val call = current ?: return
        val run = generation
        val token = config.optString("accessToken")
        val id = call.optString("callId")
        if (business()) { businessAction(action, answerMediaType); return }
        if (action == "accept" && !permissions(answerMediaType)) { emit("error", "code", "CALL_PERMISSION_REQUIRED"); return }
        // Local hangup always releases capture even when the business endpoint is unreachable.
        if (action == "end" || action == "cancel" || action == "reject") releaseMedia()
        try {
            val result = api("/$id/actions", JSONObject().put("action", action).put("actionId", UUID.randomUUID().toString()).put("answerMediaType", answerMediaType))
            if (current?.optString("callId") == id) adopt(result)
        } catch (_: Exception) {
            if (run != generation || token != config.optString("accessToken") || current?.optString("callId") != id) return
            if (action != "ready") finish("failed")
            emit("error", "code", "CALL_ACTION_FAILED")
        }
    }
    private fun publishCall() {
        val ctx = context ?: return
        try { VoipCallService.show(ctx) }
        catch (_: IllegalStateException) {
            // Core-Telecom on Android 14+ can keep a notified call alive via its own
            // foreground delegation. Do not lose the invitation if an OEM denies our FGS.
            NotificationManagerCompat.from(ctx).notify(9090, notification(ctx))
        }
    }
    private fun permissions(type: String): Boolean {
        val ctx = context ?: return false
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
            (type != "video" || ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }

    private fun connectMedia(snapshot: JSONObject) {
        val id = snapshot.optString("callId")
        if (mediaId == id) return
        mediaId = id; connected = false; peerReady = false; readySent = false
        val run = generation
        mediaJob = scope.launch {
            try {
                if (snapshot.optString("mediaType") != "video") camera = false
                check(permissions(snapshot.optString("mediaType")))
                val c = withTimeout(5000) {
                    while (control == null) delay(50)
                    control!!
                }
                val result = if (snapshot.optString("calleeId") == config.optString("userId")) c.answer(if (camera) CallAttributesCompat.CALL_TYPE_VIDEO_CALL else CallAttributesCompat.CALL_TYPE_AUDIO_CALL) else c.setActive()
                check(result is CallControlResult.Success)
                val credentials = if (business()) businessCredentials(snapshot) else api("/$id/credentials", JSONObject())
                val signal = credentials.getString("serverUrl")
                check(signal.startsWith("wss://") || (config.optBoolean("development") && signal.startsWith("ws://")))
                if (run != generation || current?.optString("callId") != id || terminal.contains(id)) return@launch
                val next = LiveKit.create(context!!, overrides = LiveKitOverrides(audioOptions = AudioOptions(
                    audioHandler = NoAudioHandler(), disableAudioPrewarming = true, disableCommunicationModeWorkaround = true)))
                room = next
                launch {
                    next.events.collect { event ->
                        if (room !== next) return@collect
                        when (event) {
                            is RoomEvent.TrackSubscribed -> {
                                if (event.track.kind == Track.Kind.AUDIO) { peerReady = true; emit("peerMediaReady"); maybeReady() }
                                refreshViews()
                            }
                            is RoomEvent.TrackUnsubscribed -> refreshViews()
                            is RoomEvent.Reconnecting -> { reconnecting = true; emit("reconnecting") }
                            is RoomEvent.Reconnected -> { reconnecting = false; emit("connected") }
                            is RoomEvent.ParticipantDisconnected -> if (business() && peerReady) finish("remoteEnded")
                            is RoomEvent.Disconnected -> if (!terminal.contains(id)) { finish("disconnected") }
                            else -> {}
                        }
                    }
                }
                next.connect(credentials.getString("serverUrl"), credentials.getString("participantToken"))
                if (room !== next || run != generation || terminal.contains(id)) { next.release(); return@launch }
                // Android 14+: phoneCall alone does not grant microphone/camera foreground-service access.
                withTimeout(5000) { while (!VoipCallService.enableCapture(camera && cameraVisible())) delay(50) }
                next.localParticipant.setMicrophoneEnabled(microphone)
                if (camera && cameraVisible()) next.localParticipant.setCameraEnabled(true)
                connected = true; emit("connected"); refreshViews()
                if (business()) mediaJoined()
                maybeReady()
                context?.let { VoipCallService.show(it) }
            } catch (_: Exception) { if (run == generation && !terminal.contains(id)) { finish("mediaFailed"); emit("error", "code", "CALL_MEDIA_FAILED") } }
        }
    }
    private fun maybeReady() { if (connected && peerReady && !readySent) { readySent = true; scope.launch { act("ready") } } }
    private suspend fun setMicrophone(enabled: Boolean) { microphone = enabled; room?.localParticipant?.setMicrophoneEnabled(enabled); emit("microphone", "enabled", enabled) }
    private suspend fun setCamera(enabled: Boolean) {
        if (current?.optString("mediaType") != "video") return
        if (enabled && !permissions("video")) { emit("error", "code", "CALL_PERMISSION_REQUIRED"); return }
        camera = enabled
        if (room != null) VoipCallService.enableCapture(enabled && cameraVisible())
        room?.localParticipant?.setCameraEnabled(enabled && cameraVisible()); refreshViews(); emit("camera", "enabled", enabled)
    }
    private suspend fun setSpeaker(enabled: Boolean) {
        setAudioRoute(if (enabled) "speaker" else "earpiece")
    }
    private suspend fun setAudioRoute(route: String) {
        val c = control ?: return
        val endpoints = withTimeoutOrNull(1000) { c.availableEndpoints.first() } ?: return
        val type = when (route) { "speaker" -> CallEndpointCompat.TYPE_SPEAKER; "earpiece" -> CallEndpointCompat.TYPE_EARPIECE; "bluetooth" -> CallEndpointCompat.TYPE_BLUETOOTH; "wired" -> CallEndpointCompat.TYPE_WIRED_HEADSET; else -> return }
        val endpoint = endpoints.firstOrNull { it.type == type }
        if (endpoint == null) emit("error", "code", "CALL_AUDIO_ROUTE_UNAVAILABLE") else c.requestEndpointChange(endpoint)
    }

    @JvmStatic fun createVideoView(ctx: Context, local: Boolean): FrameLayout {
        val view = FrameLayout(ctx); view.setBackgroundColor(android.graphics.Color.BLACK)
        views[view] = if (local) "local" else "remote"; scope.launch { refreshViews() }; return view
    }
    @JvmStatic fun releaseVideoView(view: FrameLayout) {
        val renderer = renderers[view]
        if (renderer != null) bindings.remove(view)?.removeRenderer(renderer)
        renderers.remove(view)?.release(); views.remove(view); view.removeAllViews()
    }
    private fun refreshViews() {
        val r = room ?: return
        for ((host, kind) in views) {
            val renderer = renderers.getOrPut(host) { TextureViewRenderer(host.context).also { r.initVideoRenderer(it); host.addView(it, FrameLayout.LayoutParams(-1, -1)) } }
            val track = if (kind == "local") r.localParticipant.getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack
                else r.remoteParticipants.values.firstNotNullOfOrNull { it.getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack }
            if (bindings[host] !== track) { bindings.remove(host)?.removeRenderer(renderer); track?.addRenderer(renderer); if (track != null) bindings[host] = track }
        }
    }
    private fun releaseMedia() {
        val old = room; room = null
        for ((host, renderer) in renderers) { bindings[host]?.removeRenderer(renderer); renderer.release(); host.removeAllViews() }
        renderers.clear(); bindings.clear(); old?.release(); connected = false; peerReady = false; reconnecting = false
    }
    private fun finish(reason: String = "") {
        if (reason.isNotEmpty() && reason != "answeredElsewhere" && reason != "sessionChanged") closeServerCall(reason)
        val id = current?.optString("callId") ?: ""
        if (id.isNotEmpty()) { terminal.add(id); if (terminal.size > 128) terminal.remove(terminal.first()) }
        expiryJob?.cancel(); expiryJob = null
        releaseMedia(); mediaJob?.cancel(); mediaJob = null; mediaId = ""
        val c = control; control = null
        val job = telecomJob; telecomJob = null
        val ready = telecomReady; telecomReady = null
        val cleanup = scope.launch(start = CoroutineStart.LAZY) {
            try {
                val closing = c ?: withTimeoutOrNull(7000) { ready?.await() }
                withTimeoutOrNull(3000) { closing?.disconnect(DisconnectCause(DisconnectCause.REMOTE)) }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { /* Already-disconnected Telecom scopes still need their owner job released. */ }
            finally { job?.cancel() }
        }
        telecomCleanup = cleanup
        cleanup.start()
        context?.stopService(Intent(context, VoipCallService::class.java))
        context?.getSystemService(NotificationManager::class.java)?.cancel(9090)
        if (reason.isNotEmpty()) emit("localEnded", "reason", reason)
        current = null; nativeUiId = ""
    }
    private fun expireSession() {
        val event = JSONObject().put("type", "localEnded").put("scope", config.optString("scope")).put("callId", current?.optString("callId")).put("reason", "sessionExpired")
        reset(); queue.add(event)
    }
    private fun closeServerCall(reason: String = "") {
        if (business()) { current?.let { notifyBusinessEnd(JSONObject(it.toString()), reason) }; return }
        val old = current
        val settings = JSONObject(config.toString())
        if (old != null && settings.optString("accessToken").isNotEmpty()) {
            val action = if (old.optString("state") == "ringing" && old.optString("calleeId") == settings.optString("userId")) "reject" else "end"
            val request = Request.Builder().url(settings.getString("apiBaseUrl") + PREFIX + "/" + old.getString("callId") + "/actions")
                .header("Authorization", "Bearer " + settings.getString("accessToken")).header("X-Call-Device-Id", settings.getString("deviceId"))
                .post(JSONObject().put("action", action).put("actionId", UUID.randomUUID().toString()).toString().toRequestBody("application/json".toMediaType())).build()
            scope.launch(Dispatchers.IO) { try { http.newCall(request).execute().close() } catch (_: Exception) {} }
        }
    }
    private fun reset() {
        context?.stopService(Intent(context, VoipDevControlService::class.java))
        closeServerCall()
        generation++; imSocket?.cancel(); imSocket = null; streamCall?.cancel(); streamJob?.cancel(); streamJob = null; finish("sessionChanged")
        config = JSONObject(); terminal.clear(); queue.clear()
        context?.getSharedPreferences("nuwax-voip", 0)?.edit()?.clear()?.apply()
    }

    /** Called by the native UniPush service before the SDK converts force_notification into an IM notice. */
    @JvmStatic fun receiveUniPush(ctx: Context, payload: String): Boolean {
        context = ctx.applicationContext
        // A persisted context exists only after privacy consent and an authenticated bootstrap.
        // Read it afresh: logout must not revive the previous account on a cold push.
        val saved = loadConfig() ?: return false
        val debug = ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (saved.optString("protocol") != "im-voip-v1" || saved.optString("accessToken").isEmpty() ||
            !(saved.optBoolean("qaAccepted") || (debug && saved.optBoolean("businessEnabled")))) return false
        trace("native push routed to call")
        incoming(ctx, payload)
        return true
    }

    /** Explicit vendor adapter hook. Feed a real call invitation, never an ordinary message notification. */
    @JvmStatic fun incoming(ctx: Context, payload: String) {
        context = ctx.applicationContext
        scope.launch {
            try {
                if (config.optString("accessToken").isEmpty()) loadConfig()?.let { initialize(it) }
                if (config.optString("accessToken").isEmpty()) return@launch
                val invitation = JSONObject(payload)
                if (business()) { receiveInvitation(api("/api/instant-message/messages/" + Uri.encode(invitation.getString("msgId")) + "?convId=" + Uri.encode(invitation.getString("convId")), absolute = true)); return@launch }
                val callId = invitation.getString("callId")
                if (!callId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) return@launch
                adopt(api("/$callId"))
            } catch (_: Exception) { emit("error", "code", "CALL_INVITATION_FAILED") }
        }
    }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("nuwax-voip-context", null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder("nuwax-voip-context", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }
    private fun saveConfig() {
        try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key())
            val encoded = Base64.encodeToString(cipher.iv + cipher.doFinal(config.toString().toByteArray()), Base64.NO_WRAP)
            context?.getSharedPreferences("nuwax-voip", 0)?.edit()?.putString("context", encoded)?.apply()
        } catch (_: Exception) { emit("error", "code", "CALL_SECURE_STORAGE_FAILED") }
    }
    private fun loadConfig(): JSONObject? = try {
        val encoded = context?.getSharedPreferences("nuwax-voip", 0)?.getString("context", null)
        if (encoded == null) null else {
            val bytes = Base64.decode(encoded, Base64.NO_WRAP)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size))))
        }
    } catch (_: Exception) { null }

    internal fun notification(ctx: Context): Notification {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel("nuwax-voip", config.optString("callLabel", "Nuwax"), NotificationManager.IMPORTANCE_HIGH))
        val s = current ?: JSONObject()
        val incoming = s.optString("state") == "ringing" && s.optString("calleeId") == config.optString("userId")
        fun intent(action: String): PendingIntent = PendingIntent.getBroadcast(ctx, action.hashCode(), Intent(ctx, VoipActionReceiver::class.java)
            .setData(Uri.parse("nuwax-voip://call/" + Uri.encode(s.optString("callId"))))
            .putExtra("action", action).putExtra("callId", s.optString("callId")), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = VoipIncomingActivity.intent(ctx, s.optString("callId"))
        val content = PendingIntent.getActivity(ctx, 9091, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val answer = PendingIntent.getActivity(ctx, 9092, VoipIncomingActivity.intent(ctx, s.optString("callId")).putExtra("answer", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val person = Person.Builder().setName(s.optString(if (s.optString("callerId") == config.optString("userId")) "calleeDisplayName" else "callerDisplayName", "Nuwax")).setImportant(true).build()
        val style = if (incoming) NotificationCompat.CallStyle.forIncomingCall(person, intent("reject"), answer)
            else NotificationCompat.CallStyle.forOngoingCall(person, intent(if (s.optString("state") == "ringing") "cancel" else "end"))
        val builder = NotificationCompat.Builder(ctx, "nuwax-voip").setSmallIcon(android.R.drawable.sym_call_incoming).setContentIntent(content)
            .setCategory(NotificationCompat.CATEGORY_CALL).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true).setOnlyAlertOnce(true).setStyle(style)
        if (incoming) builder.setFullScreenIntent(content, true)
        return builder.build()
    }
    internal fun receiveAction(id: String, action: String) { if (id == current?.optString("callId")) scope.launch { act(action) } }
}

class VoipActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { VoipBridge.receiveAction(intent.getStringExtra("callId") ?: "", intent.getStringExtra("action") ?: "") }
}
class VoipCallService : Service() {
    override fun onCreate() { super.onCreate(); instance = this }
    override fun onDestroy() { if (instance === this) instance = null; super.onDestroy() }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (Build.VERSION.SDK_INT >= 29) startForeground(9090, VoipBridge.notification(this), ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
        else startForeground(9090, VoipBridge.notification(this))
        return START_NOT_STICKY
    }
    companion object {
        private var instance: VoipCallService? = null
        fun show(context: Context) { ContextCompat.startForegroundService(context, Intent(context, VoipCallService::class.java)) }
        fun enableCapture(video: Boolean): Boolean {
            val service = instance ?: return false
            if (Build.VERSION.SDK_INT >= 30) {
                val types = ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                    (if (video) ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA else 0)
                service.startForeground(9090, VoipBridge.notification(service), types)
            }
            return true
        }
    }
}
