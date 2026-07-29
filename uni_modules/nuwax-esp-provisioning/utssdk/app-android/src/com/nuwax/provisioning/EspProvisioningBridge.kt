package com.nuwax.provisioning

import android.bluetooth.BluetoothDevice
import android.bluetooth.le.ScanResult
import android.content.Context
import android.os.Handler
import android.os.Looper
import com.espressif.provisioning.DeviceConnectionEvent
import com.espressif.provisioning.ESPConstants
import com.espressif.provisioning.ESPDevice
import com.espressif.provisioning.ESPProvisionManager
import com.espressif.provisioning.WiFiAccessPoint
import com.espressif.provisioning.listeners.BleScanListener
import com.espressif.provisioning.listeners.ProvisionListener
import com.espressif.provisioning.listeners.ResponseListener
import com.espressif.provisioning.listeners.WiFiScanListener
import org.greenrobot.eventbus.EventBus
import org.greenrobot.eventbus.Subscribe
import org.greenrobot.eventbus.ThreadMode
import org.json.JSONArray
import org.json.JSONObject
import java.nio.charset.StandardCharsets
import java.util.ArrayList
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicBoolean

interface BridgeResultCallback {
  fun onSuccess(value: String)
  fun onFailure(code: String, message: String)
}

interface BridgeScanCallback {
  fun onDevice(deviceId: String, name: String, rssi: Int, serviceUuid: String)
  fun onFailure(code: String, message: String)
}

interface BridgeProgressCallback {
  fun onProgress(stage: String)
}

class EspProvisioningBridge(context: Context) {
  private data class CachedPeripheral(
    val device: BluetoothDevice,
    val serviceUuid: String,
  )

  private val appContext = context.applicationContext
  private val manager = ESPProvisionManager.getInstance(appContext)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val peripherals = ConcurrentHashMap<String, CachedPeripheral>()
  private var espDevice: ESPDevice? = null
  private var pendingConnect: BridgeResultCallback? = null
  private var connectTimeout: Runnable? = null
  private var registered = false

  init {
    registerEvents()
  }

  private fun registerEvents() {
    if (!registered) {
      EventBus.getDefault().register(this)
      registered = true
    }
  }

  /** 是否应持续扫描：scanCompleted 时据此决定是否重启扫描窗口，stopScan 置 false。 */
  @Volatile
  private var scanning = false

  fun startScan(prefix: String, requiredServiceUuid: String, callback: BridgeScanCallback) {
    registerEvents()
    peripherals.clear()
    scanning = true
    val listener = object : BleScanListener {
      override fun scanStartFailed() {
        dispatchToMain {
          callback.onFailure("BLUETOOTH_OFF", "Bluetooth is disabled")
        }
      }

      override fun onPeripheralFound(device: BluetoothDevice, scanResult: ScanResult) {
        val record = scanResult.scanRecord ?: return
        val name = record.deviceName ?: runCatching { device.name }.getOrNull().orEmpty()
        if (!name.startsWith(prefix)) return
        val matchedUuid = record.serviceUuids
          ?.map { it.uuid.toString().lowercase(Locale.US) }
          ?.firstOrNull { it.equals(requiredServiceUuid, ignoreCase = true) }
          ?: return
        val address = runCatching { device.address }.getOrNull() ?: return
        peripherals[address] = CachedPeripheral(device, matchedUuid)
        dispatchToMain {
          callback.onDevice(address, name, scanResult.rssi, matchedUuid)
        }
      }

      override fun scanCompleted() {
        // ESP 库默认扫描窗口较短（实测 ~6s），单次易漏掉广播间隔较长的设备。
        // 窗口结束但仍在 scanning（未被 stopScan）时自动重启，直到找到设备或上层超时调用 stopScan。
        if (scanning) {
          manager.searchBleEspDevices(prefix, this)
        }
      }

      override fun onFailure(error: Exception) {
        val message = safeMessage(error)
        dispatchToMain {
          callback.onFailure("SCAN_FAILED", message)
        }
      }
    }
    manager.searchBleEspDevices(prefix, listener)
  }

  fun stopScan() {
    scanning = false
    manager.stopBleScan()
  }

  fun connect(
    deviceId: String,
    serviceUuid: String,
    username: String,
    proofOfPossession: String,
    timeoutMs: Long,
    callback: BridgeResultCallback,
  ) {
    val peripheral = peripherals[deviceId]
    if (peripheral == null) {
      dispatchToMain {
        callback.onFailure("DEVICE_NOT_FOUND", "BLE scan result is no longer available")
      }
      return
    }
    stopScan()
    clearPendingConnect()
    val device = manager.createESPDevice(
      ESPConstants.TransportType.TRANSPORT_BLE,
      ESPConstants.SecurityType.SECURITY_2,
    )
    device.setUserName(username)
    device.setProofOfPossession(proofOfPossession)
    device.setDeviceName(deviceId)
    espDevice = device
    pendingConnect = callback
    val timeout = Runnable {
      val pending = pendingConnect ?: return@Runnable
      pendingConnect = null
      dispatchToMain {
        pending.onFailure("CONNECT_FAILED", "BLE connection timed out")
      }
      device.disconnectDevice()
    }
    connectTimeout = timeout
    mainHandler.postDelayed(timeout, timeoutMs)
    device.connectBLEDevice(peripheral.device, serviceUuid.ifBlank { peripheral.serviceUuid })
  }

  @Subscribe(threadMode = ThreadMode.MAIN)
  fun onConnectionEvent(event: DeviceConnectionEvent) {
    when (event.eventType) {
      ESPConstants.EVENT_DEVICE_CONNECTED -> {
        val callback = pendingConnect ?: return
        clearConnectTimer()
        pendingConnect = null
        dispatchToMain {
          callback.onSuccess("")
        }
      }
      ESPConstants.EVENT_DEVICE_CONNECTION_FAILED -> failPendingConnect("CONNECT_FAILED", "BLE connection failed")
      ESPConstants.EVENT_DEVICE_DISCONNECTED -> failPendingConnect("DISCONNECTED", "BLE device disconnected")
    }
  }

  fun getCapabilities(callback: BridgeResultCallback) {
    val device = espDevice
    if (device == null) {
      dispatchToMain {
        callback.onFailure("DISCONNECTED", "Device is not connected")
      }
      return
    }
    try {
      val root = JSONObject(device.versionInfo ?: "{}")
      val prov = root.optJSONObject("prov") ?: JSONObject()
      val nuwax = root.optJSONObject("nuwax") ?: JSONObject()
      val capabilities = JSONArray()
      device.deviceCapabilities?.forEach { capabilities.put(it) }
      val result = JSONObject()
        .put("appVersion", nuwax.optString("ver", ""))
        .put("protocolVersion", prov.optString("ver", ""))
        .put("securityVersion", prov.optInt("sec_ver", -1))
        .put("capabilities", capabilities)
      val payload = result.toString()
      dispatchToMain {
        callback.onSuccess(payload)
      }
    } catch (error: Exception) {
      val message = safeMessage(error)
      dispatchToMain {
        callback.onFailure("SERVICE_MISMATCH", message)
      }
    }
  }

  fun getDeviceInfo(callback: BridgeResultCallback) {
    val device = espDevice
    if (device == null) {
      dispatchToMain {
        callback.onFailure("DISCONNECTED", "Device is not connected")
      }
      return
    }
    device.sendDataToCustomEndPoint(
      "device-info",
      "{}".toByteArray(StandardCharsets.UTF_8),
      object : ResponseListener {
        override fun onSuccess(returnData: ByteArray) {
          val payload = String(returnData, StandardCharsets.UTF_8)
          dispatchToMain {
            callback.onSuccess(payload)
          }
        }

        override fun onFailure(error: Exception) {
          val code = mapSessionError(error)
          val message = safeMessage(error)
          dispatchToMain {
            callback.onFailure(code, message)
          }
        }
      },
    )
  }

  /** 向固件自定义 protocomm endpoint 写数据（如 vox-config 下发 deviceSecret），走已加密的 Security 2 会话 */
  fun sendCustomData(endpoint: String, payload: String, callback: BridgeResultCallback) {
    val device = espDevice
    if (device == null) {
      dispatchToMain {
        callback.onFailure("DISCONNECTED", "Device is not connected")
      }
      return
    }
    device.sendDataToCustomEndPoint(
      endpoint,
      payload.toByteArray(StandardCharsets.UTF_8),
      object : ResponseListener {
        override fun onSuccess(returnData: ByteArray) {
          val response = String(returnData, StandardCharsets.UTF_8)
          dispatchToMain {
            callback.onSuccess(response)
          }
        }

        override fun onFailure(error: Exception) {
          val code = mapSessionError(error)
          val message = safeMessage(error)
          dispatchToMain {
            callback.onFailure(code, message)
          }
        }
      },
    )
  }

  fun scanNetworks(callback: BridgeResultCallback) {
    val device = espDevice
    if (device == null) {
      dispatchToMain {
        callback.onFailure("DISCONNECTED", "Device is not connected")
      }
      return
    }
    device.scanNetworks(object : WiFiScanListener {
      override fun onWifiListReceived(wifiList: ArrayList<WiFiAccessPoint>) {
        val result = JSONArray()
        wifiList.forEach { network ->
          result.put(
            JSONObject()
              .put("ssid", network.wifiName)
              .put("rssi", network.rssi)
              .put("security", network.security),
          )
        }
        val payload = result.toString()
        dispatchToMain {
          callback.onSuccess(payload)
        }
      }

      override fun onWiFiScanFailed(error: Exception) {
        val message = safeMessage(error)
        dispatchToMain {
          callback.onFailure("UNKNOWN", message)
        }
      }
    })
  }

  fun provision(
    ssid: String,
    password: String,
    timeoutMs: Long,
    progress: BridgeProgressCallback,
    callback: BridgeResultCallback,
  ) {
    val device = espDevice
    if (device == null) {
      dispatchToMain {
        callback.onFailure("DISCONNECTED", "Device is not connected")
      }
      return
    }
    val completed = AtomicBoolean(false)
    val timeout = Runnable {
      if (completed.compareAndSet(false, true)) {
        dispatchToMain {
          callback.onFailure("STATUS_TIMEOUT", "Provisioning status timed out")
        }
      }
    }
    mainHandler.postDelayed(timeout, timeoutMs)

    fun success() {
      if (completed.compareAndSet(false, true)) {
        mainHandler.removeCallbacks(timeout)
        dispatchToMain {
          callback.onSuccess("")
        }
      }
    }

    fun failure(code: String, message: String) {
      if (completed.compareAndSet(false, true)) {
        mainHandler.removeCallbacks(timeout)
        dispatchToMain {
          callback.onFailure(code, message)
        }
      }
    }

    device.provision(ssid, password, object : ProvisionListener {
      override fun createSessionFailed(error: Exception) {
        failure("SECURITY_AUTH_FAILED", safeMessage(error))
      }

      override fun wifiConfigSent() {
        dispatchToMain {
          progress.onProgress("SENDING_CREDENTIALS")
        }
      }

      override fun wifiConfigFailed(error: Exception) {
        failure("SEND_CONFIG_FAILED", safeMessage(error))
      }

      override fun wifiConfigApplied() {
        dispatchToMain {
          progress.onProgress("APPLYING_CONFIG")
          progress.onProgress("CHECKING_STATUS")
        }
      }

      override fun wifiConfigApplyFailed(error: Exception) {
        failure("APPLY_CONFIG_FAILED", safeMessage(error))
      }

      override fun provisioningFailedFromDevice(reason: ESPConstants.ProvisionFailureReason) {
        when (reason) {
          ESPConstants.ProvisionFailureReason.AUTH_FAILED -> failure("WIFI_AUTH_FAILED", "Wi-Fi authentication failed")
          ESPConstants.ProvisionFailureReason.NETWORK_NOT_FOUND -> failure("NETWORK_NOT_FOUND", "Wi-Fi network not found")
          ESPConstants.ProvisionFailureReason.DEVICE_DISCONNECTED -> failure("DISCONNECTED", "Device disconnected while provisioning")
          else -> failure("UNKNOWN", "Unknown provisioning failure")
        }
      }

      override fun deviceProvisioningSuccess() {
        dispatchToMain {
          progress.onProgress("SUCCESS")
        }
        success()
      }

      override fun onProvisioningFailed(error: Exception) {
        failure("UNKNOWN", safeMessage(error))
      }
    })
  }

  fun disconnect() {
    clearPendingConnect()
    espDevice?.disconnectDevice()
    espDevice = null
  }

  fun dispose() {
    runCatching { stopScan() }
    disconnect()
    peripherals.clear()
    if (registered) {
      EventBus.getDefault().unregister(this)
      registered = false
    }
  }

  private fun clearConnectTimer() {
    connectTimeout?.let { mainHandler.removeCallbacks(it) }
    connectTimeout = null
  }

  private fun clearPendingConnect() {
    clearConnectTimer()
    pendingConnect = null
  }

  private fun failPendingConnect(code: String, message: String) {
    val callback = pendingConnect ?: return
    clearConnectTimer()
    pendingConnect = null
    dispatchToMain {
      callback.onFailure(code, message)
    }
  }

  /**
   * ESP SDK 的扫描、ResponseListener 与 ProvisionListener 回调线程不固定。
   * UTS 回调会进一步触发 Vue 响应式调度；若从多个线程同时入队，
   * flushJobs 对队列排序时可能抛出 ConcurrentModificationException。
   * 所有跨 UTS 边界的回调统一串行到 Android 主线程。
   */
  private fun dispatchToMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) {
      action()
    } else {
      mainHandler.post {
        action()
      }
    }
  }

  private fun mapSessionError(error: Exception): String {
    val message = safeMessage(error).lowercase(Locale.US)
    return if (
      message.contains("session") ||
      message.contains("credential") ||
      message.contains("auth") ||
      message.contains("proof")
    ) "SECURITY_AUTH_FAILED" else "SESSION_FAILED"
  }

  private fun safeMessage(error: Exception): String =
    error.message?.take(256) ?: error.javaClass.simpleName
}
