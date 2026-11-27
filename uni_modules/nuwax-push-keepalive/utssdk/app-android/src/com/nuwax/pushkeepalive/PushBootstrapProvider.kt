package com.nuwax.pushkeepalive

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.util.Log

/** Restore the process-local callback before Android starts the DCloud push service. */
class PushBootstrapProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        val app = context?.applicationContext ?: return false
        // The saved marker is written only after login and cleared on logout or environment change.
        // Restoring the callback requires neither an Activity nor SDK initialization.
        try {
            if (PushDeliverySession.canRestoreReceiver(app) && PushRuntime.installDCloudBridge(app)) {
                Log.i("NuwaxPushKeepAlive", "cold-start push callback restored")
            }
        } catch (error: RuntimeException) {
            Log.w("NuwaxPushKeepAlive", "cold-start push callback unavailable type=${error.javaClass.simpleName}")
        }
        return true
    }

    override fun query(uri: Uri, projection: Array<out String>?, selection: String?,
        selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null

    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
