package com.nuwax.voip

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.net.Uri
import android.os.Build
import android.provider.Settings

/** Separate the ringing call from silent call progress. Existing user choices remain authoritative. */
internal object VoipNotificationChannels {
    private const val LEGACY = "nuwax-voip"
    private const val PREVIOUS_INCOMING = "nuwax-voip-incoming-v1"
    const val INCOMING = "nuwax-voip-incoming-v2"
    const val ONGOING = "nuwax-voip-ongoing-v1"

    fun incoming(manager: NotificationManager): NotificationChannel? =
        manager.getNotificationChannel(INCOMING) ?: manager.getNotificationChannel(PREVIOUS_INCOMING) ?: manager.getNotificationChannel(LEGACY)

    fun resourceLabel(context: Context, resource: String): String {
        val id = context.resources.getIdentifier(resource, "string", context.packageName)
        check(id != 0) { "Missing packaged call notification label" }
        return context.getString(id)
    }

    fun ensure(context: Context, name: String, incomingName: String) {
        val manager = context.getSystemService(NotificationManager::class.java)
        if (manager.getNotificationChannel(INCOMING) == null) {
            val legacy = manager.getNotificationChannel(PREVIOUS_INCOMING) ?: manager.getNotificationChannel(LEGACY)
            val userSound = if (Build.VERSION.SDK_INT >= 30) legacy?.hasUserSetSound() else null
            val bundled = "android.resource://${context.packageName}/raw/nuwax_voip_ring"
            check(context.resources.getIdentifier("nuwax_voip_ring", "raw", context.packageName) != 0) { "Missing packaged call ringtone" }
            val uri = VoipCallPolicy.invitationSound(legacy != null, legacy?.sound?.toString(), userSound,
                setOf(Settings.System.DEFAULT_NOTIFICATION_URI.toString(), Settings.System.DEFAULT_RINGTONE_URI.toString()), bundled)
            val channel = NotificationChannel(INCOMING, incomingName, legacy?.importance ?: NotificationManager.IMPORTANCE_HIGH)
            channel.setSound(uri?.let(Uri::parse), AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build())
            // A silent/blocked legacy channel stays silent/blocked; never delete it or override the user.
            channel.enableVibration(legacy?.shouldVibrate() ?: true)
            legacy?.vibrationPattern?.let { channel.vibrationPattern = it }
            channel.enableLights(legacy?.shouldShowLights() ?: false)
            if (legacy != null) {
                channel.lightColor = legacy.lightColor
                channel.lockscreenVisibility = legacy.lockscreenVisibility
                channel.setShowBadge(legacy.canShowBadge())
                if (legacy.group != null) channel.group = legacy.group
            }
            manager.createNotificationChannel(channel)
        }
        // Channel names can be localized/clarified without replacing any user-controlled settings.
        manager.getNotificationChannel(INCOMING)?.let { channel ->
            if (channel.name.toString() != incomingName) { channel.name = incomingName; manager.createNotificationChannel(channel) }
        }
        if (manager.getNotificationChannel(ONGOING) == null) {
            val channel = NotificationChannel(ONGOING, name, NotificationManager.IMPORTANCE_LOW)
            channel.setSound(null, null)
            channel.enableVibration(false)
            manager.createNotificationChannel(channel)
        }
        manager.getNotificationChannel(ONGOING)?.let { channel ->
            if (channel.name.toString() != name) { channel.name = name; manager.createNotificationChannel(channel) }
        }
    }
}
