package com.nuwax.pushkeepalive

import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.util.Base64
import android.util.Log
import io.dcloud.uts.UTSAndroid
import org.json.JSONObject
import java.lang.reflect.Method
import java.security.MessageDigest

/**
 * 仅补无厂商通道、无 Activity 的普通 IM 通知。DCloud 通知类通过反射复用，
 * 避免 UTS library module 之间形成编译依赖，同时保留原通知渠道和点击行为。
 */
internal object ImHeadlessPush {
    private const val SESSION = "nuwax-im-headless-session"
    private const val RECEIPTS = "nuwax-im-headless-receipts"
    private const val TTL = 24 * 60 * 60 * 1000L
    private const val LIMIT = 128
    private const val TAG = "NuwaxImPush"
    private const val PUSH_MESSAGE = "uts.sdk.modules.DCloudUniPush.PushMessage"
    private const val PUSH_MANAGER = "uts.sdk.modules.DCloudUniPush.PushManager__1"

    /** true 表示已展示或应忽略；false 表示继续交给 DCloud/UTS 原逻辑。 */
    fun receive(context: Context, raw: String?, sdkMessageId: String?): Boolean {
        if (raw.isNullOrEmpty() || raw.length > 65_536) return false
        val envelope = runCatching { JSONObject(raw) }.getOrNull() ?: return false
        // 即使来电校验失败也不能被降级成普通聊天通知。
        if (field(envelope, "type") == "voip" || field(envelope, "kind") == "voip.invite" ||
            field(envelope, "scene") == "meeting") return false
        val session = context.getSharedPreferences(SESSION, Context.MODE_PRIVATE)
        if (!session.getBoolean("fallback", false)) return false
        val user = session.getString("user", "").orEmpty()
        val environment = session.getString("environment", "").orEmpty()
        if (!session.getBoolean("enabled", false) || user.isEmpty() || environment.isEmpty()) {
            Log.i(TAG, "ordinary receive ignored: no enabled session")
            return true
        }
        val pushedEnvironment = field(envelope, "pushEnvironment")
        if (pushedEnvironment.isNotEmpty() && pushedEnvironment != environment) {
            Log.i(TAG, "ordinary receive ignored: environment mismatch")
            return true
        }
        val businessId = field(envelope, "msgId")
        val locator = if (businessId.isNotEmpty()) field(envelope, "convId") + ":" + businessId
            else sdkMessageId?.takeIf { it.isNotEmpty() } ?: raw
        val key = Base64.encodeToString(MessageDigest.getInstance("SHA-256")
            .digest("$environment|$user|$locator".toByteArray(Charsets.UTF_8)), Base64.NO_WRAP or Base64.URL_SAFE)
        val receipts = context.getSharedPreferences(RECEIPTS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val previous = receipts.getLong(key, 0L)
        if (previous > 0 && now - previous in 0L until TTL) {
            Log.i(TAG, "ordinary receive duplicate key=${key.take(12)}")
            return true
        }
        // 有 Activity 时仍由现有 UTS 前后台逻辑负责；不重复发送 receive 事件。
        if (UTSAndroid.getUniActivity() != null) return false
        if (envelope.optString("content").isBlank()) return false
        if (!notificationsEnabled(context)) {
            Log.i(TAG, "notification skipped: permission disabled key=${key.take(12)}")
            return true
        }
        return try {
            val title = context.packageManager.getApplicationLabel(context.applicationInfo).toString()
            val messageType = Class.forName(PUSH_MESSAGE)
            val constructor = messageType.getDeclaredConstructor(
                String::class.java, String::class.java, java.lang.Boolean.TYPE)
            val message = constructor.newInstance(raw, title, true)
            val manager = invokeStaticOrCompanion(PUSH_MANAGER, "getInstance")
                ?: error("DCloud PushManager unavailable")
            invokeMember(manager, "createNotification", context, message)
            // 同进程点击优先命中 SDK 消息表；再次杀进程后由通知 Bundle 重建。
            val bundle = invokeMember(message, "toBundle") as? Bundle
            val appId = bundle?.getString("appid").orEmpty()
            if (appId.isNotEmpty()) invokeMember(manager, "addPushMessage", appId, message)
            // 只有通知调用完成后记去重；失败时保留 DCloud 原回调的兜底机会。
            val retained = receipts.all.entries.mapNotNull { entry ->
                (entry.value as? Long)?.takeIf { now - it in 0L until TTL }?.let { entry.key to it }
            }.sortedByDescending { it.second }.take(LIMIT - 1)
            val edit = receipts.edit().clear()
            retained.forEach { edit.putLong(it.first, it.second) }
            edit.putLong(key, now).commit()
            Log.i(TAG, "notification submitted key=${key.take(12)}")
            true
        } catch (error: Exception) {
            Log.w(TAG, "notification failed key=${key.take(12)} type=${error.javaClass.simpleName}")
            false
        }
    }

    private fun notificationsEnabled(context: Context): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) return true
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
        return manager?.areNotificationsEnabled() != false
    }

    private fun invokeMember(target: Any, name: String, vararg args: Any?): Any? {
        val method = findMethod(target.javaClass, name, args)
            ?: throw NoSuchMethodException("${target.javaClass.name}.$name/${args.size}")
        return method.invoke(target, *args)
    }

    private fun invokeStaticOrCompanion(className: String, name: String, vararg args: Any?): Any? {
        val type = Class.forName(className)
        findMethod(type, name, args)?.let { method ->
            if (java.lang.reflect.Modifier.isStatic(method.modifiers)) return method.invoke(null, *args)
        }
        val companion = type.getField("Companion").get(null)
        return invokeMember(companion, name, *args)
    }

    private fun findMethod(type: Class<*>, name: String, args: Array<out Any?>): Method? =
        type.methods.firstOrNull { method ->
            method.name == name && method.parameterTypes.size == args.size &&
                method.parameterTypes.indices.all { index ->
                    val value = args[index]
                    value == null && !method.parameterTypes[index].isPrimitive ||
                        value != null && method.parameterTypes[index].isAssignableFrom(value.javaClass)
                }
        }

    private fun field(value: JSONObject, key: String, depth: Int = 0): String {
        if (depth > 4) return ""
        val direct = value.opt(key)
        if (direct is String || direct is Number) return direct.toString()
        for (wrapper in listOf("payload", "data")) {
            val child = when (val nested = value.opt(wrapper)) {
                is JSONObject -> nested
                is String -> runCatching { JSONObject(nested) }.getOrNull()
                else -> null
            }
            if (child != null) field(child, key, depth + 1).takeIf { it.isNotEmpty() }?.let { return it }
        }
        return ""
    }
}
