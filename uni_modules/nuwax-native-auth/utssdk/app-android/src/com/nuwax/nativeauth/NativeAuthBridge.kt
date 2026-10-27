package com.nuwax.nativeauth

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.security.KeyStore
import java.security.MessageDigest
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/** 只持有短期认证事务。没有 Cookie 导出、账号密码、提供方 SDK 或网络请求。 */
object NativeAuthBridge {
    private const val CALLBACK = "com.nuwax.app.auth://oauth/callback"
    private const val PREFS = "nuwax_native_auth_v1"
    private const val ALIAS = "com.nuwax.nativeauth.transaction.v1"
    private val lock = Any()

    private fun b64(bytes: ByteArray) = Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
    @JvmStatic fun randomToken(): String = b64(ByteArray(32).also { SecureRandom().nextBytes(it) })
    @JvmStatic fun sha256(value: String): String = b64(MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)))

    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        val existing = store.getKey(ALIAS, null)
        if (existing is SecretKey) return existing
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        generator.init(KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        return generator.generateKey()
    }

    private fun readVault(context: Context): JSONObject {
        val encoded = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("vault", null) ?: return JSONObject()
        val envelope = JSONObject(encoded)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, Base64.decode(envelope.getString("iv"), Base64.NO_WRAP)))
        val plain = cipher.doFinal(Base64.decode(envelope.getString("ciphertext"), Base64.NO_WRAP))
        return JSONObject(String(plain, Charsets.UTF_8))
    }

    private fun writeVault(context: Context, vault: JSONObject): Boolean {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key())
        val encrypted = cipher.doFinal(vault.toString().toByteArray(Charsets.UTF_8))
        val envelope = JSONObject().put("iv", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            .put("ciphertext", Base64.encodeToString(encrypted, Base64.NO_WRAP))
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putString("vault", envelope.toString()).commit()
    }

    @JvmStatic fun available(context: Context): Boolean = try {
        val browser = Intent(Intent.ACTION_VIEW, Uri.parse("https://example.invalid/"))
        val callback = Intent(Intent.ACTION_VIEW, Uri.parse(CALLBACK)).setPackage(context.packageName)
        browser.resolveActivity(context.packageManager) != null && callback.resolveActivity(context.packageManager) != null
    } catch (_: Exception) { false }

    @JvmStatic fun read(context: Context): String = synchronized(lock) {
        try { readVault(context).optString("transaction") } catch (_: Exception) { "!secure_storage_unavailable" }
    }

    @JvmStatic fun write(context: Context, value: String): Boolean = synchronized(lock) {
        try {
            if (value.length > 16384) return@synchronized false
            val tx = JSONObject(value)
            val vault = readVault(context)
            val previous = vault.optString("transaction")
            if (previous.isEmpty() || JSONObject(previous).optString("id") != tx.optString("id")) vault.remove("result")
            vault.put("transaction", value)
            writeVault(context, vault)
        } catch (_: Exception) { false }
    }

    @JvmStatic fun clear(context: Context): Boolean = synchronized(lock) {
        try { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().remove("vault").commit() }
        catch (_: Exception) { false }
    }

    @JvmStatic fun open(activity: Activity, value: String): Boolean = synchronized(lock) {
        try {
            val request = JSONObject(value)
            val tx = JSONObject(readVault(activity).optString("transaction"))
            val url = Uri.parse(request.getString("authorizeUrl"))
            if (request.optString("requestId") != tx.optString("id") || request.optString("callbackUrl") != CALLBACK ||
                tx.optString("callbackUrl") != CALLBACK || tx.optString("phase") != "authorizing" ||
                url.scheme != "https" || url.userInfo != null || url.fragment != null ||
                !url.toString().startsWith(tx.getString("origin") + "/") || !available(activity)) return@synchronized false
            activity.startActivity(Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE))
            true
        } catch (_: Exception) { false }
    }

    /** 先校验安全存储内的活跃事务，不让任意 scheme 调用唤醒主页面或覆盖结果。 */
    @JvmStatic fun receive(context: Context, uri: Uri?): Boolean = synchronized(lock) {
        try {
            if (uri == null || uri.toString().length > 8192 || uri.fragment != null ||
                "${uri.scheme}://${uri.authority}${uri.path}" != CALLBACK) return@synchronized false
            val vault = readVault(context)
            val tx = JSONObject(vault.optString("transaction"))
            if (tx.optString("phase") != "authorizing" || tx.optLong("expiresAt") <= System.currentTimeMillis() ||
                uri.getQueryParameters("state").size != 1 || uri.getQueryParameter("state") != tx.optString("state")) return@synchronized false
            if (vault.optString("result").isNotEmpty()) return@synchronized false
            vault.put("result", JSONObject().put("requestId", tx.getString("id")).put("kind", "callback").put("uri", uri.toString()).toString())
            writeVault(context, vault)
        } catch (_: Exception) { false }
    }

    @JvmStatic fun takeResult(context: Context): String = synchronized(lock) {
        try {
            val vault = readVault(context)
            val result = vault.optString("result")
            if (result.isEmpty()) return@synchronized ""
            vault.remove("result")
            if (writeVault(context, vault)) result else ""
        } catch (_: Exception) { "" }
    }
}

class NativeAuthCallbackActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (NativeAuthBridge.receive(this, intent?.data)) {
            packageManager.getLaunchIntentForPackage(packageName)?.let {
                it.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                startActivity(it)
            }
        }
        finish()
    }
}
