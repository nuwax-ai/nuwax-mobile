package com.nuwax.voip

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.Ringtone
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.telecom.DisconnectCause
import android.widget.FrameLayout
import androidx.core.app.NotificationCompat
import androidx.core.app.Person
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.IconCompat
import androidx.core.telecom.*
import com.caverock.androidsvg.SVG
import com.caverock.androidsvg.SVGParseException
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
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
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

private class VoipHttpFailure(val status: Int) : Exception("CALL_SERVICE_UNAVAILABLE")

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
    private var remoteLeftJob: Job? = null
    private var everHadRemote = false
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
    private var appCallUiId = ""
    private var incomingUiWait: Job? = null
    private var incomingAvatarJob: Job? = null
    private var incomingAvatar: Bitmap? = null
    private var speaker = false
    private var onEarpiece = false
    private var audioRouteChosen = false
    private var proximityLock: PowerManager.WakeLock? = null
    private val terminal = LinkedHashSet<String>()
    private val incomingNotifications = VoipIncomingNotificationGate()
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
        val channel = VoipNotificationChannels.incoming(manager)
        val presented = manager.getNotificationChannel(VoipNotificationChannels.PRESENTED_INCOMING)
        val audio = ctx.getSystemService(AudioManager::class.java)
        val interruptionFilter = manager.currentInterruptionFilter
        return JSONObject().put("supported", true)
            .put("bundleId", ctx.packageName)
            .put("developmentListener", VoipDevControlService.running)
            .put("uniPushConfigured", ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA).metaData?.getBoolean("nuwax.voip.uniPush", false) == true)
            .put("notificationsAllowed", NotificationManagerCompat.from(ctx).areNotificationsEnabled())
            .put("overlayAllowed", Settings.canDrawOverlays(ctx))
            .put("fullScreenAllowed", Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent())
            .put("fullScreenPermissionChecked", Build.VERSION.SDK_INT >= 34)
            .put("sdk", Build.VERSION.SDK_INT).put("manufacturer", Build.MANUFACTURER)
            .put("channelEnabled", channel == null || channel.importance >= NotificationManager.IMPORTANCE_HIGH)
            .put("channelId", channel?.id ?: VoipNotificationChannels.INCOMING)
            .put("channelImportance", channel?.importance ?: -1)
            .put("channelSoundEnabled", channel?.sound?.let { it != Uri.EMPTY } == true)
            .put("presentedChannelExists", presented != null && channel != null && channel.importance > NotificationManager.IMPORTANCE_DEFAULT)
            .put("presentedChannelAudible", presented != null && presented.importance >= NotificationManager.IMPORTANCE_DEFAULT &&
                presented.sound?.let { it != Uri.EMPTY } == true)
            .put("ringerMode", audio.ringerMode).put("ringVolume", audio.getStreamVolume(AudioManager.STREAM_RING))
            .put("interruptionFilter", interruptionFilter)
            .put("doNotDisturbActive", interruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL &&
                interruptionFilter != NotificationManager.INTERRUPTION_FILTER_UNKNOWN)
            .put("ringerAudible", audio.ringerMode == AudioManager.RINGER_MODE_NORMAL && audio.getStreamVolume(AudioManager.STREAM_RING) > 0)
            .put("keyguardLocked", ctx.getSystemService(KeyguardManager::class.java).isKeyguardLocked).toString()
    }
    @JvmStatic fun openPresentationSettings(ctx: Context) {
        openAlertSettings(ctx, if (Build.VERSION.SDK_INT >= 34) "fullScreen" else "notifications")
    }
    @JvmStatic fun openAlertSettings(ctx: Context, setting: String): Boolean {
        val packageUri = Uri.fromParts("package", ctx.packageName, null)
        val notifications = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
        val intent = when (setting) {
            "notifications" -> notifications
            "channel", "presentedChannel" -> {
                val manager = ctx.getSystemService(NotificationManager::class.java)
                val channel = if (setting == "channel") {
                    runCatching { ensureNotificationChannels(ctx) }
                    VoipNotificationChannels.incoming(manager)
                } else manager.getNotificationChannel(VoipNotificationChannels.PRESENTED_INCOMING)
                if (channel != null) Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                    .putExtra(Settings.EXTRA_CHANNEL_ID, channel.id)
                else notifications
            }
            "overlay" -> Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, packageUri)
            "fullScreen" -> Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT, packageUri)
            "background" -> return startSettings(ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri))
            else -> return false
        }
        if (startSettings(ctx, intent)) return true
        if ((setting == "channel" || setting == "presentedChannel") && intent !== notifications && startSettings(ctx, notifications)) return true
        return startSettings(ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, packageUri))
    }
    @JvmStatic fun openAppSettings(ctx: Context) {
        startSettings(ctx, Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", ctx.packageName, null)))
    }
    private fun startSettings(ctx: Context, intent: Intent): Boolean {
        return runCatching { ctx.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.isSuccess
    }
    internal fun label(key: String): String {
        val fallback = when (key) {
            "meetingInvitation" -> "会议邀请"
            "meetingNumber" -> "会议号"
            "meetingInvitedBy" -> "{name} 邀请你加入会议"
            "meetingJoin" -> "入会"
            "meetingIgnore" -> "忽略"
            "meetingJoining" -> "正在加入会议…"
            "meetingMinimize" -> "收起"
            else -> key
        }
        return config.optJSONObject("labels")?.optString(key, fallback) ?: fallback
    }
    internal suspend fun loadPeerAvatar(raw: String, sizePx: Int): Bitmap? {
        val base = config.optString("apiBaseUrl").toHttpUrlOrNull() ?: return null
        val url = base.resolve(raw) ?: return null
        val sameOrigin = url.scheme == base.scheme && url.host == base.host && url.port == base.port
        if (url.scheme != "https" && !(sameOrigin && config.optBoolean("development"))) return null
        if (url.username.isNotEmpty() || url.password.isNotEmpty()) return null
        val request = Request.Builder().url(url)
        if (sameOrigin && url.encodedPath.startsWith("/api/f/", ignoreCase = true)) {
            request.header("Authorization", "Bearer " + config.optString("accessToken"))
        }
        return withContext(Dispatchers.IO) {
            try {
                http.newCall(request.build()).execute().use { response ->
                    if (!response.isSuccessful) return@use null
                    val source = response.body?.source() ?: return@use null
                    if (source.request(4 * 1024 * 1024L + 1)) return@use null
                    val bytes = source.readByteArray()
                    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return@use decodeSvgAvatar(bytes, sizePx)
                    val largestSide = maxOf(bounds.outWidth, bounds.outHeight)
                    val options = BitmapFactory.Options()
                    options.inSampleSize = 1
                    while (largestSide / options.inSampleSize > sizePx * 2) options.inSampleSize *= 2
                    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
                }
            } catch (_: java.io.IOException) { null }
        }
    }

    private fun prepareIncomingAvatar(call: JSONObject) {
        clearIncomingAvatar()
        val run = generation
        val id = call.optString("callId")
        val caller = call.optString("callerId")
        val settings = config
        incomingAvatarJob = scope.launch {
            var url = (call.opt("callerAvatar") as? String)?.trim().orEmpty()
            if (url.isEmpty() && business() && caller.isNotEmpty()) {
                url = lookupCallerAvatar(caller, settings)
                val active = current ?: return@launch
                if (run != generation || active.optString("callId") != id || active.optString("callerId") != caller) return@launch
                if (url.isNotEmpty() && (active.opt("callerAvatar") as? String).isNullOrBlank()) {
                    active.put("callerAvatar", url)
                    if (active.optString("scene") != "meeting") {
                        active.put("version", active.optLong("version") + 1)
                        emitSnapshot(active)
                    }
                }
            }
            if (url.isEmpty()) return@launch
            val bitmap = loadPeerAvatar(url, 64) ?: return@launch
            if (run == generation && current?.optString("callId") == id) incomingAvatar = bitmap
        }
    }

    private suspend fun lookupCallerAvatar(caller: String, settings: JSONObject): String {
        val contacts = try {
            api("/api/instant-message/contacts", absolute = true, captured = settings).optJSONArray("items")
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { return "" }
        if (contacts == null) return ""
        for (index in 0 until contacts.length()) {
            val contact = contacts.optJSONObject(index) ?: continue
            if (contact.optString("userId") == caller && contact.optInt("subjectType") == 1 && contact.optInt("status") == 1) {
                return (contact.opt("avatar") as? String)?.trim().orEmpty()
            }
        }
        return ""
    }

    private fun clearIncomingAvatar() {
        incomingAvatarJob?.cancel()
        incomingAvatarJob = null
        incomingAvatar = null
    }

    private fun callerInitialAvatar(displayName: String): Bitmap {
        val name = displayName.trim().ifEmpty { "?" }
        val initial = name.substring(0, Character.charCount(name.codePointAt(0)))
        return Bitmap.createBitmap(96, 96, Bitmap.Config.ARGB_8888).also { bitmap ->
            val canvas = Canvas(bitmap)
            val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.rgb(113, 134, 124) }
            canvas.drawCircle(48f, 48f, 48f, paint)
            paint.color = Color.WHITE
            paint.textAlign = Paint.Align.CENTER
            paint.textSize = 48f
            canvas.drawText(initial, 48f, 48f - (paint.ascent() + paint.descent()) / 2, paint)
        }
    }

    private fun decodeSvgAvatar(bytes: ByteArray, sizePx: Int): Bitmap? {
        val content = bytes.toString(Charsets.UTF_8)
        // The profile uploader accepts SVG. Profile images need no XML entities.
        if (!content.contains("<svg") || content.contains("<!ENTITY")) return null
        return try {
            val svg = SVG.getFromString(content)
            Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888).also {
                svg.renderToCanvas(Canvas(it))
            }
        } catch (_: SVGParseException) { null }
        catch (_: RuntimeException) { null }
        catch (_: StackOverflowError) { null }
    }
    internal fun developmentListenerAllowed(ctx: Context): Boolean = isTestPackage(ctx) && config.optBoolean("development") && config.optString("accessToken").isNotEmpty()
    internal fun uiSnapshot(id: String): JSONObject? {
        val value = current ?: return null
        if (value.optString("callId") != id || value.optString("state") == "ended") return null
        return JSONObject(value.toString()).put("incoming", value.optString("calleeId") == config.optString("userId"))
            .put("microphone", microphone).put("camera", camera).put("speaker", speaker)
            .put("mediaReady", connected && peerReady).put("reconnecting", reconnecting)
    }
    internal fun nativeVisible(id: String, visible: Boolean) {
        trace(if (visible) "native call activity visible" else "native call activity hidden")
        if (visible && current?.optString("callId") == id) {
            nativeUiId = id
            updatePresentedIncoming(id)
        } else if (!visible && nativeUiId == id) nativeUiId = ""
        updateProximity()
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
                        updateProximity()
                        if (!hidden && appCallUiId.isNotEmpty()) updatePresentedIncoming(appCallUiId)
                        room?.localParticipant?.setCameraEnabled(camera && cameraVisible())
                        if (room != null) VoipCallService.enableCapture(camera && cameraVisible())
                        if (!hidden && activity.get()?.intent?.getBooleanExtra("nuwaxVoip", false) == true) {
                            activity.get()?.intent?.removeExtra("nuwaxVoip"); emit("openPage")
                        }
                    }
                    "callPageVisibility" -> {
                        val id = command.optString("callId")
                        val visible = command.optBoolean("visible")
                        if (visible && id == current?.optString("callId")) {
                            appCallUiId = id
                            updatePresentedIncoming(id)
                        } else if (!visible && appCallUiId == id) appCallUiId = ""
                        updateProximity()
                    }
                    "audioRoute" -> setAudioRoute(command.optString("route"))
                }
            } catch (_: Exception) { emit("error", "code", "CALL_NATIVE_FAILED") }
        }
    }

    private fun initialize(value: JSONObject) {
        trace("initialize requested")
        if (!qaOriginAllowed(value)) return
        val debug = ((context?.applicationInfo?.flags ?: 0) and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0
        if (!value.optBoolean("development") && !businessSessionAllowed(value, debug)) return
        if (value.optBoolean("development") && ((context?.applicationInfo?.flags ?: 0) and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) == 0) return
        val base = Uri.parse(value.optString("apiBaseUrl"))
        if (base.host.isNullOrEmpty() || (base.scheme != "https" && !(value.optBoolean("development") && base.scheme == "http"))) return
        if (value.optString("userId").isEmpty() || value.optString("accessToken").isEmpty()) return
        val same = config.optString("userId") == value.optString("userId") && config.optString("apiBaseUrl") == value.optString("apiBaseUrl") && config.optString("deviceId") == value.optString("deviceId")
        if (!same) reset()
        config = value
        if (same) {
            // 锁屏入会唤醒 UTS 后会更换 scope；同一账号的已确认入会意图不能因此丢失。
            queue.forEach { event ->
                if (event.optString("type") == "meetingInvite" && event.optString("action") == "accept") {
                    event.put("scope", config.optString("scope"))
                }
            }
        }
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
        val result = try { withContext(Dispatchers.IO) {
            val request = Request.Builder().url(settings.getString("apiBaseUrl") + (if (absolute) "" else PREFIX) + path)
                .header("Authorization", "Bearer " + settings.getString("accessToken"))
                .header("X-Call-Device-Id", settings.getString("deviceId"))
            if (data != null) request.post(data.toString().toRequestBody("application/json".toMediaType()))
            http.newCall(request.build()).execute().use { response ->
                if (!response.isSuccessful) throw VoipHttpFailure(response.code)
                val envelope = JSONObject(response.body?.string() ?: "{}")
                if (envelope.optString("code") != "0000") error(envelope.optString("code", "CALL_SERVICE_UNAVAILABLE"))
                envelope.getJSONObject("data")
            }
        } } catch (error: VoipHttpFailure) {
            if (captured == null && owner == generation && settings.optString("accessToken") == config.optString("accessToken") && VoipCallPolicy.isAuthenticationFailure(error.status)) expireSession()
            throw error
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
    private suspend fun receiveInvitation(message: JSONObject, push: JSONObject? = null, sessionScope: String? = null) {
        trace("invitation validating")
        if (message.optString("msgType") == "meeting_invite") { receiveMeetingInvitation(message, push, sessionScope); return }
        if (message.optString("msgType") != "voip" || message.optInt("senderType", 1) != 1 || message.optInt("msgStatus", 1) != 1) return
        val body = message.optJSONObject("body") ?: return
        val id = body.optString("callId"); val conv = message.optString("convId"); val sender = message.optString("senderId")
        val media = body.optString("mediaType")
        if (!id.matches(Regex("[A-Za-z0-9_-]{1,128}")) || body.optString("roomName").isEmpty() || media !in listOf("audio", "video") || sender == config.optString("userId")) return
        val sent = message.optLong("sendTime")
        if (sent <= 0 || sent + 60000 <= System.currentTimeMillis() || terminal.contains(id) || current?.optString("callId") == id) return
        val conversation = api("/api/instant-message/conversations/" + Uri.encode(conv), absolute = true)
        if (sessionScope != null && config.optString("scope") != sessionScope) return
        if (conversation.optInt("convType") != 1 || conversation.optString("peerUserId") != sender) return
        val deadline = if (push == null) sent + 60000 else push.optLong("expiresAt")
        if (deadline <= System.currentTimeMillis() || terminal.contains(id) || current?.optString("callId") == id) return
        val peerAvatar = (conversation.opt("peerAvatar") as? String)?.trim().orEmpty()
            .ifEmpty { (message.opt("senderAvatar") as? String)?.trim().orEmpty() }
        val next = JSONObject().put("protocol", "im-voip-v1").put("callId", id).put("roomName", body.getString("roomName")).put("msgId", message.getString("msgId")).put("convId", conv)
            .put("version", 1).put("state", "ringing").put("callerId", sender).put("calleeId", config.getString("userId")).put("callerDeviceId", "").put("acceptedDeviceId", "")
            .put("mediaType", media).put("callerDisplayName", conversation.optString("peerName", sender)).put("calleeDisplayName", config.getString("userId"))
            .put("callerAvatar", peerAvatar).put("expiresAt", deadline)
        if (current != null && current?.optString("callId") != id) { notifyBusinessEnd(next, "busy"); terminal.add(id); return }
        trace("invitation accepted"); adopt(next)
    }
    /**
     * 会议来电只借用系统来电界面和铃声，不进入 1:1 通话状态机：
     * 接听后由 JS 打开会议页，忽略/超时回写 meeting-invite-handled。
     */
    private fun receiveMeetingInvitation(message: JSONObject, push: JSONObject?, sessionScope: String?) {
        if (message.optInt("senderType", 1) != 1 || message.optInt("msgStatus", 1) != 1) return
        val body = message.optJSONObject("body") ?: return
        if (VoipPushPayload.isSilentMeeting(body)) return
        val inviteId = body.optString("inviteId")
        val room = body.optString("roomName")
        val title = body.optString("title")
        val media = body.optString("mediaType")
        val conv = message.optString("convId")
        val msg = message.optString("msgId")
        if (!inviteId.matches(Regex("[A-Za-z0-9._-]{1,128}")) || !room.matches(Regex("[A-Za-z0-9._-]{1,128}")) ||
            title.isBlank() || media !in listOf("audio", "video")) return
        if (sessionScope != null && config.optString("scope") != sessionScope) return
        if (push != null && (push.optString("inviteId") != inviteId || push.optString("roomName") != room)) return
        if (terminal.contains(inviteId) || current?.optString("callId") == inviteId) return
        val sent = message.optLong("sendTime")
        val now = System.currentTimeMillis()
        if (sent <= 0 || sent + 60000 <= now) return
        val deadline = if (push == null) sent + 60000 else push.optLong("expiresAt")
        if (deadline <= now) return
        // 忙线不打断：保留聊天卡片，用户结束后自行加入。
        if (current != null) return
        val sender = message.optString("senderId")
        val next = JSONObject().put("protocol", "im-voip-v1").put("scene", "meeting")
            .put("callId", inviteId).put("inviteId", inviteId).put("roomName", room).put("title", title)
            .put("passcode", body.optString("passcode"))
            .put("msgId", msg).put("convId", conv).put("version", 1).put("state", "ringing")
            .put("callerId", sender).put("calleeId", config.optString("userId")).put("acceptedDeviceId", "")
            .put("mediaType", media)
            .put("callerDisplayName", message.optString("senderName", title))
            .put("callerAvatar", message.opt("senderAvatar") as? String ?: "")
            .put("calleeDisplayName", config.optString("userId"))
            .put("expiresAt", deadline)
        current = next
        prepareIncomingAvatar(next)
        trace("meeting invitation accepted")
        expiryJob?.cancel()
        expiryJob = scope.launch {
            delay((deadline - System.currentTimeMillis()).coerceIn(0L, 60_000L))
            val active = current
            if (active?.optString("callId") == inviteId && active.optString("scene") == "meeting") {
                emitMeeting("timeout", active)
                closeMeeting()
            }
        }
        if (!hidden) requestIncomingCallUi(inviteId)
        publishCall()
    }

    private fun emitMeeting(action: String, meeting: JSONObject) {
        val event = JSONObject().put("type", "meetingInvite").put("scope", config.optString("scope"))
            .put("action", action).put("callId", meeting.optString("callId"))
            .put("inviteId", meeting.optString("inviteId")).put("roomName", meeting.optString("roomName"))
            .put("title", meeting.optString("title")).put("mediaType", meeting.optString("mediaType"))
            .put("passcode", meeting.optString("passcode"))
            .put("convId", meeting.optString("convId")).put("msgId", meeting.optString("msgId"))
        queue.add(event)
        while (queue.size > 256) queue.poll()
    }

    private fun closeMeeting() {
        val ctx = context
        val id = current?.optString("callId") ?: ""
        if (id.isNotEmpty()) { terminal.add(id); if (terminal.size > 128) terminal.remove(terminal.first()) }
        current = null
        expiryJob?.cancel(); expiryJob = null
        clearIncomingUiWait()
        clearIncomingAvatar()
        incomingNotifications.reset()
        try { VoipCallService.removeNotification() } catch (_: Exception) { }
        ctx?.stopService(Intent(ctx, VoipCallService::class.java))
        try { if (ctx != null) NotificationManagerCompat.from(ctx).cancel(9090) } catch (_: Exception) { }
    }

    private fun receiveSignal(event: JSONObject) {
        val payload = event.optJSONObject("payload") ?: return
        val type = event.optString("eventType")
        if (type == "meeting:invite-handled") {
            val invite = payload.optString("inviteId")
            if (invite.isNotEmpty()) {
                terminal.add(invite)
                if (terminal.size > 128) terminal.remove(terminal.first())
            }
            val call = current ?: return
            if (call.optString("scene") != "meeting") return
            val msg = payload.optString("msgId")
            if ((msg.isNotEmpty() && msg == call.optString("msgId")) ||
                (invite.isNotEmpty() && invite == call.optString("inviteId"))) closeMeeting()
            return
        }
        val id = payload.optString("callId")
        val conv = payload.optString("convId"); if (conv.isEmpty()) return
        val call = current
        if (call != null && conv == call.optString("convId") && VoipCallPolicy.matches(id, payload.optString("msgId"), call.optString("callId"), call.optString("msgId"))) {
            if (type == "voip:answered") {
                if (call.optString("calleeId") == config.optString("userId") && call.optString("acceptedDeviceId").isEmpty()) finish("answeredElsewhere", false)
                else if (call.optString("callerId") == config.optString("userId") && call.optString("state") == "ringing") project("connecting")
            } else VoipCallPolicy.signalEndReason(type, call.optString("state"))?.let { finish(it, false) }
            return
        }
        if (id.isEmpty() || call?.optString("callId") == id) return
        if (type in listOf("voip:cancel", "voip:timeout", "voip:decline") || (type == "voip:answered" && payload.optString("userId") == config.optString("userId"))) {
            terminal.add(id); if (terminal.size > 128) terminal.remove(terminal.first())
        }
    }
    private fun project(state: String, media: String? = null) {
        val old = current ?: return
        val next = JSONObject(old.toString()).put("state", state).put("version", old.optLong("version") + 1)
        if (media != null) next.put("mediaType", media)
        if (state == "connecting") {
            if (old.optString("calleeId") == config.optString("userId")) next.put("acceptedDeviceId", config.getString("deviceId"))
            next.put("connectExpiresAt", System.currentTimeMillis() + 30000)
        }
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
            val now = System.currentTimeMillis()
            val next = JSONObject(current.toString()).put("msgId", response.getString("msgId"))
                .put("expiresAt", VoipCallPolicy.ringDeadline(response.optLong("sendTime"), now)).put("version", current!!.optLong("version") + 1)
            if (next.optString("state") == "ringing" && next.optLong("expiresAt") <= now) { current = next; finish("timeout"); return@withContext }
            adopt(next)
        } else {
            try { api("/answered", businessBody(call)) }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (run == generation && current?.optString("callId") == call.optString("callId")) trace("answer report unavailable; media retained") }
        }
    }
    private suspend fun businessAction(action: String, media: String) {
        val call = current ?: return
        when (action) {
            "accept" -> {
                if (call.optString("state") != "ringing" || call.optString("calleeId") != config.optString("userId")) return
                if (media != "audio" && !(media == "video" && call.optString("mediaType") == "video")) return
                if (!permissions(media)) { emit("error", "code", "CALL_PERMISSION_REQUIRED"); return }
                project("connecting", if (call.optString("mediaType") == "video") media else "audio")
            }
            "ready" -> if (connected && peerReady) project("active")
            "end", "cancel", "reject" -> finish(VoipCallPolicy.endReason(call.optString("state"), call.optString("calleeId") == config.optString("userId")))
        }
    }
    private fun notifyBusinessEnd(call: JSONObject, reason: String, captured: JSONObject? = null) {
        val settings = captured ?: JSONObject(config.toString())
        if (call.optString("msgId").isEmpty()) return
        val caller = call.optString("callerId") == settings.optString("userId")
        val action = VoipCallPolicy.businessEndAction(caller, call.optString("state"), reason) ?: return
        val body = businessBody(call); val path = "/$action"
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
        if (snapshot.optString("callerId") == uid && snapshot.optString("callerDeviceId") != config.optString("deviceId")) return
        val old = current
        fun rank(state: String) = listOf("ringing", "connecting", "active", "ended").indexOf(state)
        if (rank(snapshot.optString("state")) < 0 || snapshot.optLong("version") < 1) return
        if (old?.optString("callId") == id && rank(snapshot.optString("state")) < rank(old.optString("state"))) return
        if (old != null && old.optString("callId") != id && old.optString("state") != "ended") return
        if (old?.optString("callId") == id && snapshot.optLong("version") <= old.optLong("version")) return
        if (snapshot.optString("state") == "ringing" && snapshot.optLong("expiresAt") <= System.currentTimeMillis()) return
        val first = old == null || old.optString("callId") != id
        if (first) { microphone = true; camera = snapshot.optString("mediaType") == "video"; speaker = false; onEarpiece = false; audioRouteChosen = false }
        current = snapshot; emitSnapshot(snapshot)
        updateProximity()
        if (snapshot.optString("state") == "ended") { finish(); return }
        expiryJob?.cancel(); expiryJob = null
        val phase = snapshot.optString("state")
        if (phase == "ringing" || phase == "connecting") {
            val preparing = business() && phase == "ringing" && snapshot.optString("callerId") == uid && snapshot.optString("msgId").isEmpty()
            if (preparing) snapshot.put("prepareExpiresAt", old?.optLong("prepareExpiresAt")?.takeIf { it > 0 } ?: (System.currentTimeMillis() + VoipCallPolicy.PREPARE_TIMEOUT_MS))
            val limit = if (preparing || phase == "connecting") 30000L else if (business()) 60000L else 45000L
            val deadline = snapshot.optLong(if (preparing) "prepareExpiresAt" else if (phase == "ringing") "expiresAt" else "connectExpiresAt", System.currentTimeMillis() + limit)
            expiryJob = scope.launch {
                delay((deadline - System.currentTimeMillis()).coerceIn(0L, limit))
                if (current?.optString("callId") == id && current?.optString("state") == phase) finish(if (!preparing && phase == "ringing") "timeout" else "connectionTimeout")
            }
        }
        if (current?.optString("callId") != id || terminal.contains(id)) return
        val caller = snapshot.optString("callerId") == uid && snapshot.optString("callerDeviceId") == config.optString("deviceId")
        val accepted = snapshot.optString("acceptedDeviceId")
        val callee = snapshot.optString("calleeId") == uid
        if (callee && accepted.isNotEmpty() && accepted != config.optString("deviceId")) { finish("answeredElsewhere"); return }
        if (!caller && !callee) return
        if (first && callee && phase == "ringing") {
            prepareIncomingAvatar(snapshot)
            if (!hidden) requestIncomingCallUi(id, fallbackToAppPage = true)
        }
        if (telecomJob == null) addTelecom(snapshot, !caller)
        if (control != null) publishCall()
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
                    if (incoming && ownsCall()) requestBackgroundCallUi(id)
                    publishCall()
                    launch { isMuted.collect { muted -> if (control === owner) setMicrophone(!muted) } }
                    launch {
                        currentCallEndpoint.collect { endpoint ->
                            if (control === owner) {
                                speaker = endpoint.type == CallEndpointCompat.TYPE_SPEAKER
                                onEarpiece = endpoint.type == CallEndpointCompat.TYPE_EARPIECE
                                emit("speaker", "enabled", speaker)
                                updateProximity()
                            }
                        }
                    }
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
        if (call.optString("scene") == "meeting") {
            if (action == "accept") emitMeeting("accept", call)
            else if (action in listOf("reject", "end", "cancel")) emitMeeting("reject", call)
            closeMeeting()
            return
        }
        val run = generation
        val token = config.optString("accessToken")
        val id = call.optString("callId")
        if (business()) { businessAction(action, answerMediaType); return }
        if (action in listOf("end", "cancel", "reject")) {
            finish(VoipCallPolicy.endReason(call.optString("state"), call.optString("calleeId") == config.optString("userId")))
            return
        }
        if (action == "accept" && !permissions(answerMediaType)) { emit("error", "code", "CALL_PERMISSION_REQUIRED"); return }
        try {
            val result = api("/$id/actions", JSONObject().put("action", action).put("actionId", UUID.randomUUID().toString()).put("answerMediaType", answerMediaType))
            if (current?.optString("callId") == id) adopt(result)
        } catch (_: Exception) {
            if (run != generation || token != config.optString("accessToken") || current?.optString("callId") != id) return
            if (action != "ready") finish("failed")
            emit("error", "code", "CALL_ACTION_FAILED")
        }
    }
    // After Telecom registers the call, use the user-granted overlay permission to try
    // the native incoming Activity. Some devices show a banner for the full-screen
    // notification intent, so keep it as the fallback when the Activity cannot open.
    private fun requestBackgroundCallUi(id: String) {
        val ctx = context ?: return
        val call = current ?: return
        if (!business()) { trace("background call activity skipped: not a business call"); return }
        if (call.optString("callId") != id) { trace("background call activity skipped: call changed"); return }
        if (!isRingingIncoming(call)) { trace("background call activity skipped: not an incoming ringing call"); return }
        if (call.optLong("expiresAt") <= System.currentTimeMillis()) { trace("background call activity skipped: invitation expired"); return }
        if (callUiVisible(id)) { trace("background call activity skipped: call UI already visible"); return }
        if (incomingUiWait != null) { trace("background call activity skipped: request pending"); return }
        val locked = ctx.getSystemService(KeyguardManager::class.java).isKeyguardLocked
        if (!VoipCallPolicy.shouldOpenBackgroundCallUi(locked, call.optString("mediaType"))) {
            trace("background call activity skipped: screen and media policy")
            return
        }
        if (!Settings.canDrawOverlays(ctx)) {
            trace("background call activity skipped: overlay unavailable")
            return
        }
        val manager = ctx.getSystemService(NotificationManager::class.java)
        if (runCatching { ensureNotificationChannels(ctx) }.isFailure) {
            trace("background call activity skipped: notification channel setup failed")
            return
        }
        val channel = VoipNotificationChannels.incoming(manager)
        if (channel == null) {
            trace("background call activity skipped: notification channel missing")
            return
        }
        if (!manager.areNotificationsEnabled()) {
            trace("background call activity skipped: notifications disabled")
            return
        }
        if (channel.importance < NotificationManager.IMPORTANCE_HIGH) {
            trace("background call activity skipped: notification channel importance below high")
            return
        }
        if (manager.currentInterruptionFilter != NotificationManager.INTERRUPTION_FILTER_ALL) {
            trace("background call activity skipped: interruption filter active or unknown")
            return
        }
        trace(if (locked) "locked call activity requested" else "unlocked incoming call activity requested")
        requestIncomingCallUi(id)
    }

    private fun callUiVisible(id: String) = nativeUiId == id || (!hidden && appCallUiId == id)

    private fun updateProximity() {
        val call = current
        val phase = call?.optString("state")
        val shouldMonitor = call != null && onEarpiece && callUiVisible(call.optString("callId")) &&
            call.optString("mediaType") == "audio" && (phase == "connecting" || phase == "active")
        if (!shouldMonitor) {
            val lock = proximityLock
            proximityLock = null
            if (lock?.isHeld == true) lock.release(PowerManager.RELEASE_FLAG_WAIT_FOR_NO_PROXIMITY)
            return
        }
        if (proximityLock?.isHeld == true) return
        val power = context?.getSystemService(PowerManager::class.java) ?: return
        if (!power.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) return
        try {
            val lock = power.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "Nuwax:VoipProximity")
            lock.acquire()
            proximityLock = lock
        } catch (_: SecurityException) {
            trace("proximity wake lock unavailable")
        }
    }

    private fun isRingingIncoming(call: JSONObject) =
        call.optString("state") == "ringing" && call.optString("calleeId") == config.optString("userId")

    private fun updatePresentedIncoming(id: String) {
        val call = current ?: return
        if (call.optString("callId") == id && callUiVisible(id) && isRingingIncoming(call) && hasSystemCall()) publishCall()
    }

    private fun requestIncomingCallUi(id: String, fallbackToAppPage: Boolean = false) {
        val ctx = context ?: return
        if (callUiVisible(id) || incomingUiWait != null) return
        try {
            ctx.startActivity(VoipIncomingActivity.intent(ctx, id))
        } catch (ex: RuntimeException) {
            trace("incoming call activity declined: " + ex.javaClass.simpleName)
            if (!fallbackToAppPage) return
        }
        // startActivity can return without showing anything. Leave enough time for the
        // Activity to resume while still posting CallStyle within Telecom's five seconds.
        incomingUiWait = scope.launch {
            delay(750)
            val ringing = current
            if (fallbackToAppPage && !hidden && ringing?.optString("callId") == id &&
                isRingingIncoming(ringing) && !callUiVisible(id)) {
                emit("openPage")
                delay(500)
            }
            incomingUiWait = null
            val call = current
            if (call?.optString("callId") == id && isRingingIncoming(call) && hasSystemCall()) {
                trace(if (callUiVisible(id)) "incoming call UI visible after activity request" else "incoming call UI not visible after activity request")
                publishCall()
            }
        }
    }

    private fun clearIncomingUiWait() {
        incomingUiWait?.cancel()
        incomingUiWait = null
    }

    private fun publishCall() {
        val ctx = context ?: return
        val call = current ?: return
        val id = call.optString("callId")
        val incoming = isRingingIncoming(call)
        if (!incoming) VoipCallService.stopIncomingRingtone()
        val visible = incoming && callUiVisible(id)
        if (incoming && incomingUiWait != null && !visible) return
        clearIncomingUiWait()
        if (!incomingNotifications.publish(id, incoming, visible)) return
        val avatarJob = incomingAvatarJob
        if (incoming && !visible && avatarJob?.isActive == true) {
            // Start the fallback alert within Telecom's five-second window.
            // A second post just for the avatar can interrupt the system ringtone.
            val run = generation
            scope.launch {
                withTimeoutOrNull(1_800L) { avatarJob.join() }
                val active = current ?: return@launch
                if (run == generation && active.optString("callId") == id && isRingingIncoming(active) &&
                    incomingNotifications.hasUnpresentedAlert(id)) postCallNotification(ctx, id, incoming, visible)
            }
            return
        }
        postCallNotification(ctx, id, incoming, visible)
    }

    private fun postCallNotification(ctx: Context, id: String, incoming: Boolean, visible: Boolean) {
        // Once the call page is visible, its CallStyle drops the full-screen Intent.
        // Post it through the phoneCall foreground service so the system accepts it.
        if (incoming && Build.VERSION.SDK_INT >= 31 && !visible) {
            try { NotificationManagerCompat.from(ctx).notify(9090, notification(ctx)); trace("incoming call notification posted") }
            catch (_: Exception) { incomingNotifications.reset(); trace("incoming call notification failed") }
            return
        }
        try { VoipCallService.show(ctx, id) }
        catch (_: IllegalStateException) {
            // Core-Telecom on Android 14+ can keep a notified call alive via its own
            // foreground delegation. Do not lose the invitation if an OEM denies our FGS.
            try { NotificationManagerCompat.from(ctx).notify(9090, notification(ctx)); trace("call notification posted without own service") }
            catch (_: Exception) { incomingNotifications.reset(); trace("call notification failed") }
        }
        catch (_: Exception) { incomingNotifications.reset(); trace("call service failed") }
    }
    internal fun hasSystemCall() = current != null && (control != null || current?.optString("scene") == "meeting")
    private fun permissions(type: String): Boolean {
        val ctx = context ?: return false
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED &&
            (type != "video" || ContextCompat.checkSelfPermission(ctx, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED)
    }

    private fun connectMedia(snapshot: JSONObject) {
        val id = snapshot.optString("callId")
        if (mediaId == id) return
        mediaId = id; connected = false; peerReady = false; readySent = false
        remoteLeftJob?.cancel(); remoteLeftJob = null; everHadRemote = false
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
                if (snapshot.optString("mediaType") == "audio") {
                    launch { selectDefaultAudioRoute(c, id, run) }
                }
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
                            is RoomEvent.ParticipantConnected -> { everHadRemote = true; observeRemotePresence(next, id, run); announceMediaReady() }
                            is RoomEvent.DataReceived -> {
                                if (event.participant != null && event.topic == "nuwax.voip.media-ready.v1" && event.data.size <= 256) {
                                    val payload = runCatching { JSONObject(String(event.data, Charsets.UTF_8)) }.getOrNull()
                                    if (payload?.optInt("v") == 1 && payload.optString("type") == "ready" && payload.optString("callId") == id) {
                                        peerReady = true; emit("peerMediaReady"); maybeReady()
                                    }
                                }
                            }
                            is RoomEvent.Reconnecting -> { reconnecting = true; emit("reconnecting"); observeRemotePresence(next, id, run) }
                            is RoomEvent.Reconnected -> { reconnecting = false; emit("connected"); observeRemotePresence(next, id, run); announceMediaReady() }
                            is RoomEvent.ParticipantDisconnected -> observeRemotePresence(next, id, run)
                            is RoomEvent.Disconnected -> if (!terminal.contains(id)) { finish("disconnected") }
                            else -> {}
                        }
                    }
                }
                next.connect(credentials.getString("serverUrl"), credentials.getString("participantToken"))
                if (room !== next || run != generation || terminal.contains(id)) { next.release(); return@launch }
                observeRemotePresence(next, id, run)
                // Android 14+: phoneCall alone does not grant microphone/camera foreground-service access.
                withTimeout(5000) { while (!VoipCallService.enableCapture(camera && cameraVisible())) delay(50) }
                next.localParticipant.setMicrophoneEnabled(microphone)
                if (camera && cameraVisible()) next.localParticipant.setCameraEnabled(true)
                connected = true; emit("connected"); refreshViews(); announceMediaReady()
                if (business()) mediaJoined()
                if (room !== next || run != generation || current?.optString("callId") != id) return@launch
                maybeReady()
                context?.let { VoipCallService.show(it, id) }
            } catch (_: Exception) { if (run == generation && !terminal.contains(id)) { finish("mediaFailed"); emit("error", "code", "CALL_MEDIA_FAILED") } }
        }
    }
    private fun observeRemotePresence(target: Room, id: String, run: Int) {
        if (!business() || room !== target || run != generation || current?.optString("callId") != id) return
        if (target.remoteParticipants.isNotEmpty()) {
            everHadRemote = true; remoteLeftJob?.cancel(); remoteLeftJob = null; return
        }
        if (!everHadRemote || remoteLeftJob != null) return
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                while (room === target && run == generation && current?.optString("callId") == id) {
                    delay(VoipCallPolicy.REMOTE_LEFT_GRACE_MS)
                    if (target.remoteParticipants.isNotEmpty()) return@launch
                    val recovering = reconnecting || target.state == Room.State.RECONNECTING
                    if (VoipCallPolicy.shouldFinishRemoteLeft(everHadRemote, target.remoteParticipants.size, recovering, true)) {
                        finish("remoteEnded", false); return@launch
                    }
                }
            } finally { if (remoteLeftJob === coroutineContext[Job]) remoteLeftJob = null }
        }
        remoteLeftJob = job; job.start()
    }
    private fun maybeReady() { if (connected && peerReady && !readySent) {
        readySent = true; val id = current?.optString("callId"); val run = generation
        scope.launch { if (run == generation && current?.optString("callId") == id) act("ready") }
    } }
    private fun announceMediaReady() {
        val target = room ?: return; val id = current?.optString("callId") ?: return; val run = generation
        if (!connected) return
        val data = JSONObject().put("v", 1).put("type", "ready").put("callId", id).toString().toByteArray(Charsets.UTF_8)
        scope.launch {
            if (run == generation && room === target && current?.optString("callId") == id) {
                try { target.localParticipant.publishData(data, topic = "nuwax.voip.media-ready.v1") }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { /* Audio subscription remains compatible with older peers. */ }
            }
        }
    }
    private suspend fun setMicrophone(enabled: Boolean) {
        val target = room; val id = current?.optString("callId"); val run = generation
        microphone = enabled; target?.localParticipant?.setMicrophoneEnabled(enabled)
        if (run == generation && current?.optString("callId") == id && room === target) emit("microphone", "enabled", enabled)
    }
    private suspend fun setCamera(enabled: Boolean) {
        if (current?.optString("mediaType") != "video") return
        if (enabled && !permissions("video")) { emit("error", "code", "CALL_PERMISSION_REQUIRED"); return }
        val target = room; val id = current?.optString("callId"); val run = generation
        camera = enabled
        if (room != null) VoipCallService.enableCapture(enabled && cameraVisible())
        target?.localParticipant?.setCameraEnabled(enabled && cameraVisible())
        if (run == generation && current?.optString("callId") == id && room === target) { refreshViews(); emit("camera", "enabled", enabled) }
    }
    private suspend fun setSpeaker(enabled: Boolean) {
        setAudioRoute(if (enabled) "speaker" else "earpiece")
    }
    private suspend fun setAudioRoute(route: String) {
        audioRouteChosen = true
        val c = control ?: return
        val endpoints = withTimeoutOrNull(1000) { c.availableEndpoints.first() } ?: return
        val type = when (route) { "speaker" -> CallEndpointCompat.TYPE_SPEAKER; "earpiece" -> CallEndpointCompat.TYPE_EARPIECE; "bluetooth" -> CallEndpointCompat.TYPE_BLUETOOTH; "wired" -> CallEndpointCompat.TYPE_WIRED_HEADSET; else -> return }
        val endpoint = endpoints.firstOrNull { it.type == type }
        if (endpoint == null) emit("error", "code", "CALL_AUDIO_ROUTE_UNAVAILABLE") else c.requestEndpointChange(endpoint)
    }

    private suspend fun selectDefaultAudioRoute(c: CallControlScope, id: String, run: Int) {
        val endpoints = withTimeoutOrNull(2000) { c.availableEndpoints.first { list -> list.any { it.type == CallEndpointCompat.TYPE_EARPIECE } } } ?: return
        val selected = withTimeoutOrNull(1000) { c.currentCallEndpoint.first() } ?: return
        if (run != generation || current?.optString("callId") != id || control !== c || audioRouteChosen) return
        // Leave connected headsets to Telecom and never override a user's route selection.
        if (selected.type != CallEndpointCompat.TYPE_SPEAKER || endpoints.any { it.type == CallEndpointCompat.TYPE_BLUETOOTH || it.type == CallEndpointCompat.TYPE_WIRED_HEADSET }) return
        val earpiece = endpoints.first { it.type == CallEndpointCompat.TYPE_EARPIECE }
        try {
            if (c.requestEndpointChange(earpiece) !is CallControlResult.Success) trace("default earpiece route unavailable")
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { trace("default earpiece route unavailable") }
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
        remoteLeftJob?.cancel(); remoteLeftJob = null; everHadRemote = false
        reconnecting = false
        val old = room; room = null
        for ((host, renderer) in renderers) { bindings[host]?.removeRenderer(renderer); renderer.release(); host.removeAllViews() }
        renderers.clear(); bindings.clear(); old?.release(); connected = false; peerReady = false; reconnecting = false
    }
    private fun finish(reason: String = "", notifyRemote: Boolean = true) {
        if (notifyRemote && reason.isNotEmpty() && reason != "answeredElsewhere" && reason != "sessionChanged") closeServerCall(reason)
        val id = current?.optString("callId") ?: ""
        if (id.isNotEmpty()) { terminal.add(id); if (terminal.size > 128) terminal.remove(terminal.first()) }
        expiryJob?.cancel(); expiryJob = null
        clearIncomingUiWait()
        clearIncomingAvatar()
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
        incomingNotifications.reset()
        VoipCallService.removeNotification()
        context?.stopService(Intent(context, VoipCallService::class.java))
        context?.getSystemService(NotificationManager::class.java)?.cancel(9090)
        if (reason.isNotEmpty()) emit("localEnded", "reason", reason)
        current = null; nativeUiId = ""; appCallUiId = ""; onEarpiece = false
        updateProximity()
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
    @JvmStatic @JvmOverloads fun receiveUniPush(
        ctx: Context, payload: String, source: String, onVerification: ((Job) -> Unit)? = null
    ): Boolean {
        context = ctx.applicationContext
        val invitation = runCatching { JSONObject(payload) }.getOrNull() ?: return false
        val native = VoipPushPayload.isNative(invitation)
        // 会议没有 Telecom 会话兜底；进程被杀后点击通知必须重建来电状态，
        // 否则 VoipIncomingActivity 拿不到 current 会立刻关闭。
        if (native && source == "click" && invitation.optString("scene") != "meeting") return true
        // A persisted context exists only after privacy consent and an authenticated bootstrap.
        // Read it afresh: logout must not revive the previous account on a cold push.
        val saved = loadConfig() ?: return native
        if (invitation.has("pushEnvironment") &&
            invitation.optString("pushEnvironment") != saved.optString("pushBusinessEnvironment")) return true
        val debug = ctx.applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE != 0
        if (saved.optString("protocol") != "im-voip-v1" || saved.optString("accessToken").isEmpty() ||
            !businessSessionAllowed(saved, debug)) return native
        if (!debug && !saved.optBoolean("qaAccepted") && !native) return false
        if (native && !VoipPushPayload.eligible(invitation, saved.optString("userId"), System.currentTimeMillis())) return true
        trace(if (native) "native push routed to call source=$source callId=${invitation.optString("callId")}" else "native push routed to call")
        val verification = incoming(ctx, invitation, saved.optString("scope"))
        onVerification?.invoke(verification)
        return true
    }

    /** Restore the authenticated native context and verify the invitation before ringing. */
    private fun incoming(ctx: Context, invitation: JSONObject, sessionScope: String): Job {
        context = ctx.applicationContext
        return scope.launch {
            try {
                if (config.optString("accessToken").isEmpty()) {
                    loadConfig()?.takeIf { it.optString("scope") == sessionScope }?.let { initialize(it) }
                }
                if (!business() || sessionScope.isEmpty() || config.optString("scope") != sessionScope) return@launch
                val message = api("/api/instant-message/messages/" + Uri.encode(invitation.getString("msgId")) +
                    "?convId=" + Uri.encode(invitation.getString("convId")), absolute = true)
                if (config.optString("scope") != sessionScope) return@launch
                val native = VoipPushPayload.isNative(invitation)
                if (native && !VoipPushPayload.matches(invitation, message, config.optString("userId"), System.currentTimeMillis())) return@launch
                receiveInvitation(message, invitation.takeIf { native }, sessionScope)
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { if (config.optString("scope") == sessionScope) emit("error", "code", "CALL_INVITATION_FAILED") }
        }
    }

    @JvmStatic fun isReleaseOrigin(ctx: Context, origin: String): Boolean {
        val pinned = ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
            .metaData?.getString("nuwax.voip.releaseApiOrigin")
        return VoipCallPolicy.releaseOriginAllowed(pinned, origin)
    }

    private fun businessSessionAllowed(value: JSONObject, debug: Boolean): Boolean =
        value.optBoolean("qaAccepted") || (value.optBoolean("businessEnabled") &&
            (debug || context?.let { isReleaseOrigin(it, value.optString("apiBaseUrl")) } == true))
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
            JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)))).takeIf { qaOriginAllowed(it) }
        }
    } catch (_: Exception) { null }

    private fun qaOriginAllowed(value: JSONObject): Boolean {
        val ctx = context ?: return false
        val fixedOrigin = ctx.packageManager.getApplicationInfo(ctx.packageName, PackageManager.GET_META_DATA)
            .metaData?.getString("nuwax.voip.qaApiOrigin")
        return VoipCallPolicy.originAllowed(fixedOrigin, value.optString("apiBaseUrl"))
    }

    private fun ensureNotificationChannels(ctx: Context) {
        VoipNotificationChannels.ensure(ctx,
            config.optString("ongoingNotificationLabel").ifEmpty { VoipNotificationChannels.resourceLabel(ctx, "nuwax_voip_ongoing_channel") },
            config.optString("incomingNotificationLabel").ifEmpty { VoipNotificationChannels.resourceLabel(ctx, "nuwax_voip_incoming_channel") })
    }

    internal fun presentedRingtoneChannel(ctx: Context): NotificationChannel? {
        if (Build.VERSION.SDK_INT < 31) return null
        val call = current ?: return null
        val id = call.optString("callId")
        if (!isRingingIncoming(call) || !incomingNotifications.wasPresented(id)) return null
        val manager = ctx.getSystemService(NotificationManager::class.java)
        val channel = manager.getNotificationChannel(VoipNotificationChannels.presentedIncoming(ctx)) ?: return null
        val filter = manager.currentInterruptionFilter
        fun permitsRinging(value: NotificationChannel): Boolean =
            value.importance >= NotificationManager.IMPORTANCE_DEFAULT &&
                value.sound != null && value.sound != Uri.EMPTY &&
                (filter == NotificationManager.INTERRUPTION_FILTER_ALL ||
                    (filter == NotificationManager.INTERRUPTION_FILTER_PRIORITY && value.canBypassDnd()))

        if (!manager.areNotificationsEnabled() || !permitsRinging(channel)) return null
        // Updating the notification when the call page opens can stop its ringtone.
        // Respect the original channel's sound settings before taking over playback.
        if (!incomingNotifications.wasPresentedFirst(id) &&
            VoipNotificationChannels.incoming(manager)?.let(::permitsRinging) != true) return null
        val audio = ctx.getSystemService(AudioManager::class.java)
        return channel.takeIf { audio.ringerMode == AudioManager.RINGER_MODE_NORMAL && audio.getStreamVolume(AudioManager.STREAM_RING) > 0 }
    }

    internal fun takeReplacedIncomingAlert(callId: String) = incomingNotifications.takeReplacedAlert(callId)

    internal fun notification(ctx: Context, useServiceRingtone: Boolean = false): Notification {
        ensureNotificationChannels(ctx)
        val s = current ?: JSONObject()
        val incoming = isRingingIncoming(s)
        val presented = incoming && incomingNotifications.wasPresented(s.optString("callId"))
        val presentedSoundAllowed = if (presented && Build.VERSION.SDK_INT >= 31) presentedRingtoneChannel(ctx) != null else null
        val ringsInService = useServiceRingtone && presentedSoundAllowed == true
        val ringsInNotification = VoipCallPolicy.notificationRings(incoming, presentedSoundAllowed, ringsInService)
        val alert = incoming && !presented
        fun intent(action: String): PendingIntent = PendingIntent.getBroadcast(ctx, action.hashCode(), Intent(ctx, VoipActionReceiver::class.java)
            .setData(Uri.parse("nuwax-voip://call/" + Uri.encode(s.optString("callId"))))
            .putExtra("action", action).putExtra("callId", s.optString("callId")), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val open = VoipIncomingActivity.intent(ctx, s.optString("callId"))
        val content = PendingIntent.getActivity(ctx, 9091, open, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val answer = PendingIntent.getActivity(ctx, 9092, VoipIncomingActivity.intent(ctx, s.optString("callId")).putExtra("answer", true), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val meeting = s.optString("scene") == "meeting"
        val personName = if (meeting) "${label("meetingInvitation")} · ${s.optString("title")}" else
            s.optString(if (s.optString("callerId") == config.optString("userId")) "calleeDisplayName" else "callerDisplayName", "Nuwax")
        val avatar = if (s.optString("calleeId") == config.optString("userId")) {
            incomingAvatar ?: callerInitialAvatar(s.optString("callerDisplayName"))
        } else null
        val person = Person.Builder().setName(personName).setImportant(true)
            .apply { if (avatar != null) setIcon(IconCompat.createWithBitmap(avatar)) }.build()
        val style = if (incoming) NotificationCompat.CallStyle.forIncomingCall(person, intent("reject"), answer)
            .setIsVideo(!meeting && s.optString("mediaType") == "video")
            else NotificationCompat.CallStyle.forOngoingCall(person, intent(if (s.optString("state") == "ringing") "cancel" else "end"))
        val channel = when {
            alert -> VoipNotificationChannels.INCOMING
            presented && !ringsInService -> VoipNotificationChannels.presentedIncoming(ctx)
            else -> VoipNotificationChannels.ONGOING
        }
        val priority = when {
            alert -> NotificationCompat.PRIORITY_MAX
            presented && !ringsInService -> NotificationCompat.PRIORITY_DEFAULT
            else -> NotificationCompat.PRIORITY_LOW
        }
        val builder = NotificationCompat.Builder(ctx, channel)
            .setSmallIcon(android.R.drawable.sym_call_incoming).setContentIntent(content)
            .setContentTitle(person.name).setContentText(if (meeting) "${label("meetingNumber")} ${s.optString("roomName")}" else if (s.optString("state") == "active") config.optString("callLabel", "Nuwax")
                else label(if (incoming) "incoming" else if (s.optString("state") == "ringing") "dialing" else "connecting"))
            .setCategory(NotificationCompat.CATEGORY_CALL).setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setGroupAlertBehavior(NotificationCompat.GROUP_ALERT_ALL)
            .setPriority(priority).setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .setOngoing(true).setOnlyAlertOnce(!incoming)
        if (avatar != null) builder.setLargeIcon(avatar)
        if (meeting && incoming) {
            // CallStyle 的接听文案由系统生成；会议用明确的「入会」动作。
            builder.addAction(android.R.drawable.ic_menu_close_clear_cancel, label("meetingIgnore"), intent("reject"))
                .addAction(android.R.drawable.ic_menu_call, label("meetingJoin"), answer)
        } else builder.setStyle(style)
        if (alert) builder.setFullScreenIntent(content, true)
        if (!ringsInNotification) builder.setSilent(true)
        return builder.build().also {
            if (ringsInNotification) it.flags = it.flags or Notification.FLAG_INSISTENT
            trace("call notification channel=$channel, fullscreenIntent=" + (it.fullScreenIntent != null) + ", groupAlertBehavior=" + it.groupAlertBehavior + ", flags=" + it.flags)
            trace("call notification incoming=" + incoming + ", presentation=" + presentationStatus(ctx))
        }
    }
    internal fun receiveAction(id: String, action: String) { if (id == current?.optString("callId")) scope.launch { act(action) } }
}

class VoipActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) { VoipBridge.receiveAction(intent.getStringExtra("callId") ?: "", intent.getStringExtra("action") ?: "") }
}
class VoipCallService : Service() {
    private var ringtone: Ringtone? = null
    private var ringtoneVibrator: Vibrator? = null

    override fun onCreate() { super.onCreate(); instance = this }
    override fun onDestroy() {
        stopRinging()
        stopForeground(STOP_FOREGROUND_REMOVE)
        if (instance === this) instance = null
        super.onDestroy()
    }
    override fun onBind(intent: Intent?): IBinder? = null
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!VoipBridge.hasSystemCall()) { stopForeground(STOP_FOREGROUND_REMOVE); stopSelf(); return START_NOT_STICKY }
        val callId = intent?.getStringExtra("callId") ?: ""
        if (VoipBridge.uiSnapshot(callId) == null) return START_NOT_STICKY
        val channel = VoipBridge.presentedRingtoneChannel(this)
        // Updating an insistent notification can leave its SystemUI ringtone running.
        // Remove that alert before posting the silent foreground notification.
        if (channel != null && VoipBridge.takeReplacedIncomingAlert(callId)) {
            getSystemService(NotificationManager::class.java).cancel(9090)
        }
        publishForeground(useServiceRingtone = channel != null)
        if (channel == null) stopRinging()
        else if (!startRinging(channel)) publishForeground(useServiceRingtone = false)
        return START_NOT_STICKY
    }

    private fun publishForeground(useServiceRingtone: Boolean) {
        val notification = VoipBridge.notification(this, useServiceRingtone = useServiceRingtone)
        if (Build.VERSION.SDK_INT >= 29) startForeground(9090, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL)
        else startForeground(9090, notification)
    }

    private fun startRinging(channel: NotificationChannel): Boolean {
        if (ringtone != null) return true
        val attributes = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build()
        try {
            val player = RingtoneManager.getRingtone(this, channel.sound) ?: return false
            ringtone = player
            player.audioAttributes = attributes
            player.isLooping = true
            player.play()
        } catch (error: Exception) {
            Log.w("NuwaxVoip", "Unable to start incoming ringtone: ${error.javaClass.simpleName}")
            stopRinging()
            return false
        }
        try {
            if (channel.shouldVibrate()) {
                val vibrator = getSystemService(VibratorManager::class.java).defaultVibrator
                val pattern = channel.vibrationPattern?.takeIf { it.isNotEmpty() } ?: longArrayOf(0, 250, 1000)
                ringtoneVibrator = vibrator
                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0), attributes)
            }
        } catch (error: Exception) {
            Log.w("NuwaxVoip", "Unable to start incoming vibration: ${error.javaClass.simpleName}")
        }
        return true
    }

    private fun stopRinging() {
        ringtone?.stop(); ringtone = null
        ringtoneVibrator?.cancel(); ringtoneVibrator = null
    }

    companion object {
        private var instance: VoipCallService? = null
        fun stopIncomingRingtone() { instance?.stopRinging() }
        fun removeNotification() { stopIncomingRingtone(); instance?.stopForeground(STOP_FOREGROUND_REMOVE) }
        fun show(context: Context, id: String) { ContextCompat.startForegroundService(context, Intent(context, VoipCallService::class.java).putExtra("callId", id)) }
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
