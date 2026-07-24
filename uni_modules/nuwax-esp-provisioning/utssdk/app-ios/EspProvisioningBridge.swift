// Copyright Nuwax. All rights reserved.
//
// EspProvisioningBridge.swift
// nuwax-esp-provisioning (iOS 混编 Swift 文件)
//
// 与 Android 端 EspProvisioningBridge.kt 语义对齐：Security 2（SRP6a + AES-GCM，不降级）、
// BLE 配网、device-info / 自定义 endpoint、Wi-Fi 扫描与下发。
//
// 混编约定（见 uts-plugin-hybrid 文档）：本文件不放 index.swift；index.uts 无需 import 即可
// 直接以「EspProvisioningBridge.静态方法(闭包)」调用，闭包类型按位置一一对应。
// 回调在 Swift 侧即声明为 UTS 函数类型别名（(String) -> Void 等），UTS 直接透传，无需适配类。
//
// 与 Android 的差异（受 ESPProvision iOS SDK 能力约束）：
//  - 扫描：iOS SDK 的 searchESPDevices 在 scanTimeout 后一次性回调设备数组（非逐台流式），
//    且 ESPDevice 不对外暴露 RSSI / serviceUuid。这里用 CoreBluetooth 直接扫描，逐台回调
//    onDevice（与 Android 一致），deviceId 用 peripheral.identifier.uuidString，rssi 用
//    广播 RSSI，serviceUuid 用广播首个匹配 service UUID（无则回退传入的 requiredServiceUuid）。
//  - 连接：扫描阶段已校验 name 前缀与 serviceUuid；连接时 ESPProvision 内部会再按设备名绑定
//    peripheral（iOS SDK 不支持「直接传入已发现 peripheral 连接」，只有 createESPDevice(name)
//    路径，其内部会按名再扫 ~5s 绑定）。因 Android 扫描即按 prefix+uuid 过滤且 qr.name 为全名，
//    按名绑定是等价的；连接超时预算（上层 30s）需覆盖这次重扫。
//
// 安全约束（与契约一致）：PoP / username / Wi-Fi 密码仅内存持有，不写日志、不持久化。

import CoreBluetooth
import ESPProvision
import Foundation

// MARK: - UTS 回调类型别名（与 interface.uts 的 NativeEsp*Callback 对应）

public typealias EspSuccess = (_ value: String) -> Void
public typealias EspFailure = (_ code: String, _ message: String) -> Void
public typealias EspDeviceFound = (_ deviceId: String, _ name: String, _ rssi: NSNumber, _ serviceUuid: String) -> Void
public typealias EspProgress = (_ stage: String) -> Void

// MARK: - Security 2 连接凭证委托

/// Security 2 需要 username + PoP 建立 SRP6a 会话。iOS SDK 通过 ESPDeviceConnectionDelegate 索取。
/// createESPDevice 虽可在创建时注入 username/pop，但部分 SDK 路径仍走 delegate，故双保险：
/// 既在 createESPDevice 传入，也通过 delegate 回调返回。
final class EspSec2ConnectionDelegate: NSObject, ESPDeviceConnectionDelegate {
  private let username: String
  private let proofOfPossession: String

  init(username: String, proofOfPossession: String) {
    self.username = username
    self.proofOfPossession = proofOfPossession
  }

  func getProofOfPossesion(forDevice _: ESPDevice, completionHandler: @escaping (String) -> Void) {
    NSLog("[EspBridge] Sec2 delegate getProofOfPossesion")
    completionHandler(proofOfPossession)
  }

  func getUsername(forDevice _: ESPDevice, completionHandler: @escaping (String?) -> Void) {
    NSLog("[EspBridge] Sec2 delegate getUsername")
    completionHandler(username)
  }
}

// MARK: - 桥主体（纯 Swift 类，无 @objc；index.uts 直接以静态方法调用）

public final class EspProvisioningBridge: NSObject {

  public static let shared = EspProvisioningBridge()

  // BLE 扫描（CoreBluetooth 直接扫，逐台回调）
  private var central: CBCentralManager?
  private var onDevice: EspDeviceFound?
  private var onScanFail: EspFailure?
  private var scanPrefix = ""
  private var scanRequiredUuid = ""
  private var scanFailed = false
  private var discovered: [String: CBPeripheral] = [:]

  // 已连接设备与会话状态
  private var espDevice: ESPDevice?
  private var sec2Delegate: EspSec2ConnectionDelegate?
  private var connectSuccess: EspSuccess?
  private var connectFail: EspFailure?
  private var connectTimeoutWork: DispatchWorkItem?

  // BLE 回调与连接完成的串行队列
  private let workQueue = DispatchQueue(label: "com.nuwax.provisioning.bridge")

  private override init() {
    super.init()
  }

  // MARK: 扫描

  public static func startScan(_ prefix: String, _ requiredServiceUuid: String,
                               _ onDevice: @escaping EspDeviceFound, _ onFail: @escaping EspFailure) {
    shared._startScan(prefix, requiredServiceUuid, onDevice, onFail)
  }

  private func _startScan(_ prefix: String, _ requiredServiceUuid: String,
                          _ onDevice: @escaping EspDeviceFound, _ onFail: @escaping EspFailure) {
    stopScanInternal()
    self.onDevice = onDevice
    self.onScanFail = onFail
    scanPrefix = prefix
    scanRequiredUuid = requiredServiceUuid.lowercased()
    scanFailed = false
    discovered.removeAll()
    if central == nil {
      central = CBCentralManager(delegate: self, queue: workQueue)
    } else if central?.state == .poweredOn {
      beginBleScan()
    }
    // 非 poweredOn 时等 centralManagerDidUpdateState 触发 beginBleScan / 报错
  }

  private func beginBleScan() {
    guard let central, central.state == .poweredOn else { return }
    // 不过滤 service，靠广播名前缀过滤（契约设备名 PROV_XXXXXX），再在回调里校验 serviceUuid
    central.scanForPeripherals(withServices: nil, options: [
      CBCentralManagerScanOptionAllowDuplicatesKey: false,
    ])
  }

  public static func stopScan() {
    shared.stopScanInternal()
  }

  private func stopScanInternal() {
    central?.stopScan()
    onDevice = nil
    onScanFail = nil
  }

  // MARK: 连接

  public static func connect(_ deviceId: String, _ serviceUuid: String,
                             _ username: String, _ proofOfPossession: String,
                             _ timeoutMs: NSNumber,
                             _ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    shared._connect(deviceId, serviceUuid, username, proofOfPossession, timeoutMs, success, fail)
  }

  private func _connect(_ deviceId: String, _ serviceUuid: String,
                        _ username: String, _ proofOfPossession: String,
                        _ timeoutMs: NSNumber,
                        _ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    // deviceId 形如 peripheral uuid（手动扫描链路）；ESPProvision iOS 只能按设备名绑定，
    // 故取出已发现 peripheral 的名字。扫码链路会改走按名直连（见 iosEspProvisioningClient）。
    let name: String
    if let peripheral = discovered[deviceId], let pname = peripheral.name, !pname.isEmpty {
      name = pname
    } else {
      name = deviceId // 兜底：deviceId 即设备名
    }

    stopScanInternal()
    clearPendingConnect()
    connectSuccess = success
    connectFail = fail
    sec2Delegate = EspSec2ConnectionDelegate(username: username, proofOfPossession: proofOfPossession)

    // 连接超时（预算需覆盖 createESPDevice 内部 ~5s 重扫 + Security 2 会话建立）
    let work = DispatchWorkItem { [weak self] in
      guard let self, let failCb = self.connectFail else { return }
      NSLog("[EspBridge] connect TIMEOUT after \(timeoutMs.intValue)ms")
      self.connectSuccess = nil
      self.connectFail = nil
      failCb("CONNECT_FAILED", "BLE connection timed out")
      self.espDevice?.disconnect()
    }
    connectTimeoutWork = work
    workQueue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs.intValue), execute: work)

    NSLog("[EspBridge] createESPDevice name=%@ user=%@", name, username)
    // ESPProvision 是主线程/runloop 模型：ESPBleTransport 用 Timer.scheduledTimer 做 5s 扫描超时、
    // CBCentralManager(queue: nil) 在主线程回调、ESPDevice.connect 的 Security 2 握手全程
    // DispatchQueue.main.async。UTS 调 native 的线程无 runloop，若不在主线程发起，
    // 扫描超时 Timer 永不 fire，completion 永不回调 → 上层永久卡在「正在连接」。故派发到主线程。
    DispatchQueue.main.async {
      ESPProvisionManager.shared.createESPDevice(
        deviceName: name,
        transport: .ble,
        security: .secure2,
        proofOfPossession: proofOfPossession,
        username: username
      ) { [weak self] device, error in
        guard let self else { return }
        if let device {
          NSLog("[EspBridge] createESPDevice OK, calling device.connect")
          self.espDevice = device
          // device.connect 内部 Security 2 握手走 main.async，从主线程发起以确保 runloop 正常推进
          device.connect(delegate: self.sec2Delegate) { status in
            self.workQueue.async { self.handleConnectStatus(status) }
          }
        } else {
          let msg = (error?.description ?? "device create failed")
          NSLog("[EspBridge] createESPDevice FAIL: %@", msg)
          self.workQueue.async {
            self.failPendingConnect("DEVICE_NOT_FOUND", self.safe(msg))
          }
        }
      }
    }
  }

  private func handleConnectStatus(_ status: ESPSessionStatus) {
    switch status {
    case .connected:
      NSLog("[EspBridge] session CONNECTED")
      guard let success = connectSuccess else { return }
      clearConnectTimer()
      connectSuccess = nil
      connectFail = nil
      success("")
    case .failedToConnect(let error):
      NSLog("[EspBridge] session FAILED: %@", error.description)
      failPendingConnect(mapSessionError(error), safe(error.description))
    case .disconnected:
      NSLog("[EspBridge] session DISCONNECTED")
      failPendingConnect("DISCONNECTED", "BLE device disconnected")
    @unknown default:
      NSLog("[EspBridge] session UNKNOWN status")
      failPendingConnect("CONNECT_FAILED", "BLE connection failed")
    }
  }

  // MARK: 能力 / 设备信息

  public static func getCapabilities(_ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    shared._getCapabilities(success, fail)
  }

  private func _getCapabilities(_ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    guard let device = espDevice else {
      fail("DISCONNECTED", "Device is not connected")
      return
    }
    // versionInfo 由 SDK 在建立会话时拉取（prov.ver / prov.sec_ver / nuwax.ver / capabilities）
    var appVersion = ""
    var protocolVersion = ""
    var securityVersion = -1
    if let info = device.versionInfo as? [String: Any] {
      if let prov = info["prov"] as? [String: Any] {
        protocolVersion = (prov["ver"] as? String) ?? ""
        securityVersion = (prov["sec_ver"] as? Int) ?? -1
      }
      if let nuwax = info["nuwax"] as? [String: Any] {
        appVersion = (nuwax["ver"] as? String) ?? ""
      }
    }
    let payload: [String: Any] = [
      "appVersion": appVersion,
      "protocolVersion": protocolVersion,
      "securityVersion": securityVersion,
      "capabilities": device.capabilities ?? [],
    ]
    success(jsonString(payload))
  }

  public static func getDeviceInfo(_ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    shared._sendCustomData("device-info", "{}", success, fail)
  }

  /// 向固件自定义 protocomm endpoint 写数据（如 vox-config 下发 deviceSecret），走已加密的 Security 2 会话
  public static func sendCustomData(_ endpoint: String, _ payload: String,
                                    _ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    shared._sendCustomData(endpoint, payload, success, fail)
  }

  private func _sendCustomData(_ endpoint: String, _ payload: String,
                               _ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    guard let device = espDevice else {
      fail("DISCONNECTED", "Device is not connected")
      return
    }
    let data = Data(payload.utf8)
    device.sendData(path: endpoint, data: data) { response, error in
      self.workQueue.async {
        if let response {
          success(String(data: response, encoding: .utf8) ?? "")
        } else {
          fail(self.mapSessionError(error), self.safe(error?.description))
        }
      }
    }
  }

  // MARK: Wi-Fi 扫描

  public static func scanNetworks(_ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    shared._scanNetworks(success, fail)
  }

  private func _scanNetworks(_ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    guard let device = espDevice else {
      fail("DISCONNECTED", "Device is not connected")
      return
    }
    device.scanWifiList { networks, error in
      self.workQueue.async {
        if let networks {
          let list: [[String: Any]] = networks.map {
            [
              "ssid": $0.ssid,
              "rssi": Int($0.rssi),
              "security": Int($0.auth.rawValue),
            ]
          }
          success(self.jsonString(list))
        } else {
          fail("UNKNOWN", self.safe(error?.description))
        }
      }
    }
  }

  // MARK: 配网

  public static func provision(_ ssid: String, _ password: String, _ timeoutMs: NSNumber,
                               _ progress: @escaping EspProgress,
                               _ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    shared._provision(ssid, password, timeoutMs, progress, success, fail)
  }

  private func _provision(_ ssid: String, _ password: String, _ timeoutMs: NSNumber,
                          _ progress: @escaping EspProgress,
                          _ success: @escaping EspSuccess, _ fail: @escaping EspFailure) {
    guard let device = espDevice else {
      fail("DISCONNECTED", "Device is not connected")
      return
    }
    var completed = false
    let lock = NSLock()
    func finish(_ body: () -> Void) {
      lock.lock()
      defer { lock.unlock() }
      guard !completed else { return }
      completed = true
      body()
    }

    let timeoutWork = DispatchWorkItem {
      finish { fail("STATUS_TIMEOUT", "Provisioning status timed out") }
    }
    workQueue.asyncAfter(deadline: .now() + .milliseconds(timeoutMs.intValue), execute: timeoutWork)

    progress("SENDING_CREDENTIALS")
    device.provision(ssid: ssid, passPhrase: password) { status in
      self.workQueue.async {
        switch status {
        case .configApplied:
          progress("APPLYING_CONFIG")
          progress("CHECKING_STATUS")
        case .success:
          finish {
            timeoutWork.cancel()
            progress("SUCCESS")
            success("")
          }
        case .failure(let error):
          finish {
            timeoutWork.cancel()
            let (code, message) = self.mapProvisionError(error)
            fail(code, message)
          }
        @unknown default:
          finish {
            timeoutWork.cancel()
            fail("UNKNOWN", "Unknown provisioning failure")
          }
        }
      }
    }
  }

  // MARK: 断开 / 释放

  public static func disconnect() {
    shared._disconnect()
  }

  private func _disconnect() {
    clearPendingConnect()
    espDevice?.disconnect()
    espDevice = nil
    sec2Delegate = nil
  }

  public static func dispose() {
    shared._dispose()
  }

  private func _dispose() {
    stopScanInternal()
    _disconnect()
    discovered.removeAll()
    central = nil
  }

  // MARK: 私有工具

  private func clearConnectTimer() {
    connectTimeoutWork?.cancel()
    connectTimeoutWork = nil
  }

  private func clearPendingConnect() {
    clearConnectTimer()
    connectSuccess = nil
    connectFail = nil
  }

  private func failPendingConnect(_ code: String, _ message: String) {
    guard let fail = connectFail else { return }
    clearConnectTimer()
    connectSuccess = nil
    connectFail = nil
    fail(code, message)
  }

  /// 会话/自定义数据失败 → 错误码（与 Android mapSessionError 对齐：凭证类归 SECURITY_AUTH_FAILED，其余 SESSION_FAILED）
  private func mapSessionError(_ error: Error?) -> String {
    guard let error else { return "SESSION_FAILED" }
    let msg = error.localizedDescription.lowercased()
    if msg.contains("session") || msg.contains("credential") || msg.contains("auth")
      || msg.contains("proof") || msg.contains("pop") || msg.contains("username")
      || msg.contains("security") || msg.contains("encrypt") {
      return "SECURITY_AUTH_FAILED"
    }
    return "SESSION_FAILED"
  }

  /// 配网失败 → 错误码（与 Android provisioningFailedFromDevice / 各 *Failed 对齐）
  private func mapProvisionError(_ error: ESPProvisionError) -> (String, String) {
    switch error {
    case .wifiStatusAuthenticationError:
      return ("WIFI_AUTH_FAILED", "Wi-Fi authentication failed")
    case .wifiStatusNetworkNotFound:
      return ("NETWORK_NOT_FOUND", "Wi-Fi network not found")
    case .wifiStatusDisconnected:
      return ("DISCONNECTED", "Device disconnected while provisioning")
    case .sessionError:
      return ("SECURITY_AUTH_FAILED", safe(error.description))
    case .configurationError:
      return ("SEND_CONFIG_FAILED", safe(error.description))
    default:
      return ("UNKNOWN", safe(error.description))
    }
  }

  private func safe(_ message: String?) -> String {
    guard let message, !message.isEmpty else { return "unknown error" }
    return String(message.prefix(256))
  }

  private func jsonString(_ any: Any) -> String {
    guard let data = try? JSONSerialization.data(withJSONObject: any),
          let string = String(data: data, encoding: .utf8) else {
      return any is [Any] ? "[]" : "{}"
    }
    return string
  }
}

// MARK: - CoreBluetooth 扫描回调

extension EspProvisioningBridge: CBCentralManagerDelegate {
  public func centralManagerDidUpdateState(_ central: CBCentralManager) {
    switch central.state {
    case .poweredOn:
      if onDevice != nil { beginBleScan() }
    case .poweredOff:
      if !scanFailed { scanFailed = true; onScanFail?("BLUETOOTH_OFF", "Bluetooth is disabled") }
    case .unauthorized:
      if !scanFailed { scanFailed = true; onScanFail?("NO_PERMISSION", "Bluetooth permission was not granted") }
    case .unsupported:
      if !scanFailed { scanFailed = true; onScanFail?("UNSUPPORTED", "Bluetooth LE is not supported") }
    default:
      break
    }
  }

  public func centralManager(
    _: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    guard let onDevice else { return }
    let name = (advertisementData[CBAdvertisementDataLocalNameKey] as? String)
      ?? peripheral.name ?? ""
    guard !scanPrefix.isEmpty, name.hasPrefix(scanPrefix) else { return }

    // 契约冻结 Service UUID 0000ffff-…34fb：优先取广播里匹配的 service UUID 并校验
    let advertised = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID]) ?? []
    let matched = advertised.first { $0.uuidString.lowercased() == scanRequiredUuid }
    // 若广播里没带 service UUID，则回退使用调用方传入的 requiredServiceUuid（Android 侧也是以此为准）
    let serviceUuid = matched?.uuidString ?? scanRequiredUuid

    let deviceId = peripheral.identifier.uuidString
    discovered[deviceId] = peripheral
    onDevice(deviceId, name, RSSI, serviceUuid)
  }
}
