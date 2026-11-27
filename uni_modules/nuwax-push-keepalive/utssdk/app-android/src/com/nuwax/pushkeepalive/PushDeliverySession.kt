package com.nuwax.pushkeepalive

import android.content.Context
import android.util.Log

/** 与原生 ImHeadlessPush 共享的最小会话闸门；不保存 token、消息或账号显示信息。 */
object PushDeliverySession {
    private const val PREFS = "nuwax-im-headless-session"

    @JvmStatic fun sync(context: Context, user: String, environment: String, enabled: Boolean, fallback: Boolean) {
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val accepted = user.isNotEmpty() && (environment == "test" || environment == "production")
        if (!saved.edit().putString("user", user).putString("environment", environment)
            .putBoolean("enabled", accepted && enabled).putBoolean("fallback", fallback).commit()) {
            Log.w("NuwaxPushKeepAlive", "native session persistence failed")
        }
    }

    @JvmStatic fun clear(context: Context) {
        // 保留设备能力标记，退出后到达的普通透传由原生直接忽略。
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .remove("user").remove("environment").putBoolean("enabled", false).commit()
    }

    fun canRestoreReceiver(context: Context): Boolean {
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val environment = saved.getString("environment", null)
        return !saved.getString("user", null).isNullOrEmpty() &&
            (environment == "test" || environment == "production")
    }

    @JvmStatic fun isEnabled(context: Context): Boolean {
        val saved = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return saved.getBoolean("enabled", false) && saved.getBoolean("fallback", false)
            && !saved.getString("user", null).isNullOrEmpty()
    }
}
