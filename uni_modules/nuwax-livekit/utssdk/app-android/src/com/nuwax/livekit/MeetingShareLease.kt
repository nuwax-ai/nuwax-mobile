package com.nuwax.livekit

import java.net.HttpURLConnection
import java.net.URL
import org.json.JSONObject

/** 原生系统录屏停止时释放自己的占位，不依赖 UTS 页面是否在前台。 */
class MeetingShareLease {
  private var endpoint = ""
  private var token = ""
  private var owned = false
  @Volatile var isReleasing = false
    private set

  @Synchronized fun configure(endpoint: String, token: String) {
    this.endpoint = endpoint
    this.token = token
    owned = false
  }
  @Synchronized fun acquired() { owned = true }
  @Synchronized fun release() {
    if (!owned || endpoint.isEmpty() || token.isEmpty()) return
    owned = false
    val releaseEndpoint = endpoint
    isReleasing = true
    val body = JSONObject().put("token", token).toString()
    Thread {
      var connection: HttpURLConnection? = null
      try {
        connection = URL(releaseEndpoint).openConnection() as HttpURLConnection
        connection.instanceFollowRedirects = false
        connection.requestMethod = "POST"
        connection.connectTimeout = 10000
        connection.readTimeout = 10000
        connection.doOutput = true
        connection.setRequestProperty("Content-Type", "application/json")
        connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
        connection.responseCode
      } catch (_: Exception) {
        android.util.Log.w("MeetingBridge", "share lease release incomplete; foreground reconciliation required")
      } finally { connection?.disconnect(); isReleasing = false }
    }.start()
  }
  @Synchronized fun clear() { release(); endpoint = ""; token = "" }
}
