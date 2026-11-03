// Copyright Nuwax. All rights reserved.
//
// IosFilePickerBridge.swift
// nuwax-ios-file-picker (iOS 混编 Swift 文件)
//
// uni.chooseFile 的 iOS Swift 实现缺位（uniapp-uts-v1 modules.json 里 app.swift=false，
// Android/鸿蒙已实现），聊天页「文件」入口在 iOS 用本桥补齐：弹系统
// UIDocumentPickerViewController（文件 App，含 iCloud），asCopy=true 把选中文件拷进
// App 沙盒 tmp 目录后，再物化为 ASCII 安全名（中文名会使 uni.uploadFile URL 编码失败）、
// 一并回传文件字节数（体积闸门用），uploadSingleFile 无需安全作用域。
//
// 混编约定（同 nuwax-esp-provisioning）：本文件的 public 类对同目录 index.uts 直接可见
// （无需 import，Swift 同编译单元符号全局可见）；回调即 UTS 函数类型别名，按位置对应。

import UIKit
import UniformTypeIdentifiers

// MARK: - UTS 回调类型别名

/// 每选中一个文件回调一次（path=ASCII 物化绝对路径，name=原文件名含扩展名，size=字节数）。
public typealias IosFilePicked = (_ path: String, _ name: String, _ size: NSNumber) -> Void
/// 失败/用户取消（code="cancel" 为用户取消，调用方静默处理）。
public typealias IosFileFailure = (_ code: String, _ message: String) -> Void

// MARK: - 选择器委托（picker.delegate 弱引用，由桥静态持有防释放）

final class IosFilePickerDelegate: NSObject, UIDocumentPickerDelegate {
  private let onPicked: IosFilePicked
  private let onFail: IosFileFailure

  init(onPicked: @escaping IosFilePicked, onFail: @escaping IosFileFailure) {
    self.onPicked = onPicked
    self.onFail = onFail
    super.init()
  }

  func documentPicker(
    _ controller: UIDocumentPickerViewController,
    didPickDocumentsAt urls: [URL]
  ) {
    // 选择结束即释放静态持有（下次可再弹）
    IosFilePickerBridge.pickerDelegate = nil
    if urls.isEmpty {
      onFail("EMPTY", "no document picked")
      return
    }
    // 物化挪后台队列（大文件 tmp 拷贝不卡主线程），完成后整批回主线程逐个回调
    DispatchQueue.global(qos: .userInitiated).async { [onPicked] in
      let picked = urls.map { IosFilePickerBridge.materializeSafeCopy($0) }
      DispatchQueue.main.async { [picked] in
        for item in picked {
          onPicked(item.path, item.name, item.size)
        }
      }
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    IosFilePickerBridge.pickerDelegate = nil
    // 与 uni.chooseFile 同口径：取消走 fail，调用方静默
    onFail("cancel", "user cancelled")
  }
}

// MARK: - 桥主体（index.uts 直接以静态方法调用）

public final class IosFilePickerBridge: NSObject {

  /// 委托强引用（UIDocumentPickerViewController.delegate 是 weak）：选择器关闭后释放。
  static var pickerDelegate: IosFilePickerDelegate?

  /// 选中文件物化为 ASCII 安全名（nuwax_pick_<UUID>.<ext>，tmp 同区）。
  /// 原名含中文/空格时 uni.uploadFile 拼 URL 未编码会同步失败（NSURLErrorDomain），
  /// .uts 层 FileSystemManager 又不认 Inbox 真实绝对路径（copyFileSync 1300002 静默失败），
  /// 只能在原生层用 FileManager 兜底。物化失败回落原路径（老行为），绝不回传不存在的路径。
  fileprivate static func materializeSafeCopy(_ url: URL) -> (path: String, name: String, size: NSNumber) {
    let fm = FileManager.default
    let displayName = url.lastPathComponent
    let ext = url.pathExtension
    let safeName = "nuwax_pick_" + UUID().uuidString + (ext.isEmpty ? "" : "." + ext)
    let dest = fm.temporaryDirectory.appendingPathComponent(safeName)
    do {
      try fm.copyItem(at: url, to: dest)
      // asCopy 的 Inbox 拷贝件已无用途，顺手清掉防 tmp 堆积（清理失败无害）
      try? fm.removeItem(at: url)
      let size = (try? dest.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
      return (dest.path, displayName, NSNumber(value: size))
    } catch {
      NSLog("[IosFilePicker] materialize safe copy failed (\(error)), fallback origin path")
      let size = (try? url.resourceValues(forKeys: [.fileSizeKey]))?.fileSize ?? 0
      return (url.path, displayName, NSNumber(value: size))
    }
  }

  /// 本地文件是否存在（真实绝对路径）。★不能改用 .uts 的 FileSystemManager.accessSync：
  /// iOS 上该 API 失败只打 log 不抛异常（1300002），判定恒为 true，重试会把已失效的
  /// 沙盒临时件一路放行到 uploadFile 才报 "Illegal file"。unifile:// 虚拟路径不归这里管。
  public static func localFileExists(_ path: String) -> Bool {
    guard path.hasPrefix("/") else { return false }
    return FileManager.default.fileExists(atPath: path)
  }

  /// 上传前兜底：旧失败行重试不经过选择器，路径可能已失效或含中文/空格。
  /// 返回可直接传给 uni.uploadFile 的路径；文件不存在返回空串（调用方提示重新选择）。
  public static func prepareUploadPath(_ path: String) -> String {
    guard path.hasPrefix("/") else { return path }
    let fm = FileManager.default
    guard fm.fileExists(atPath: path) else {
      NSLog("[IosFilePicker] prepare upload path: file not found \(path)")
      return ""
    }
    guard hasUnsafeChars(path) else { return path }
    let url = URL(fileURLWithPath: path)
    let ext = url.pathExtension
    let safeName = "nuwax_pick_" + UUID().uuidString + (ext.isEmpty ? "" : "." + ext)
    let dest = fm.temporaryDirectory.appendingPathComponent(safeName)
    do {
      try fm.copyItem(at: url, to: dest)
      NSLog("[IosFilePicker] upload path materialized \(dest.path)")
      return dest.path
    } catch {
      NSLog("[IosFilePicker] upload path materialize failed (\(error))")
      return ""
    }
  }

  /// 路径含空格或非可打印 ASCII（中文/emoji）：uni.uploadFile 拼 URL 不编码必失败。
  fileprivate static func hasUnsafeChars(_ path: String) -> Bool {
    for byte in path.utf8 where byte == 32 || byte > 126 {
      return true
    }
    return false
  }

  /// 弹系统文件选择器（多选）。UTS 调 native 的线程无 runloop，统一切主线程后再弹。
  public static func pickFiles(
    _ onPicked: @escaping IosFilePicked,
    _ onFail: @escaping IosFileFailure
  ) {
    DispatchQueue.main.async {
      guard let top = IosFilePickerBridge.topViewController() else {
        onFail("NO_WINDOW", "no presenting window found")
        return
      }
      // UTType.data：全部非目录内容（文档/压缩包/音视频等皆入列，微信同口径）
      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: [UTType.data],
        asCopy: true
      )
      picker.allowsMultipleSelection = true
      picker.shouldShowFileExtensions = true
      let delegate = IosFilePickerDelegate(onPicked: onPicked, onFail: onFail)
      picker.delegate = delegate
      IosFilePickerBridge.pickerDelegate = delegate
      top.present(picker, animated: true)
    }
  }

  /// 取最顶层 VC：keyWindow.rootViewController 沿 presented 链下钻
  /// （正在 dismiss 的跳过，避免 present 到即将消失的页面导致弹不出来）。
  private static func topViewController() -> UIViewController? {
    for scene in UIApplication.shared.connectedScenes {
      guard let windowScene = scene as? UIWindowScene else { continue }
      if let key = windowScene.keyWindow, let root = key.rootViewController {
        return topFrom(root)
      }
      for window in windowScene.windows {
        if let root = window.rootViewController {
          return topFrom(root)
        }
      }
    }
    return nil
  }

  private static func topFrom(_ root: UIViewController) -> UIViewController {
    var top = root
    while let presented = top.presentedViewController, !presented.isBeingDismissed {
      top = presented
    }
    return top
  }
}
