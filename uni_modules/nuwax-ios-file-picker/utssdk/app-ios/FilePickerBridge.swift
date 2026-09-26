// Copyright Nuwax. All rights reserved.
//
// IosFilePickerBridge.swift
// nuwax-ios-file-picker (iOS 混编 Swift 文件)
//
// uni.chooseFile 的 iOS Swift 实现缺位（uniapp-uts-v1 modules.json 里 app.swift=false，
// Android/鸿蒙已实现），聊天页「文件」入口在 iOS 用本桥补齐：弹系统
// UIDocumentPickerViewController（文件 App，含 iCloud），asCopy=true 把选中文件拷进
// App 沙盒 tmp 目录，回传可直接上传的绝对路径（uploadSingleFile 无需安全作用域）。
//
// 混编约定（同 nuwax-esp-provisioning）：本文件的 public 类对同目录 index.uts 直接可见
// （无需 import，Swift 同编译单元符号全局可见）；回调即 UTS 函数类型别名，按位置对应。

import UIKit
import UniformTypeIdentifiers

// MARK: - UTS 回调类型别名

/// 每选中一个文件回调一次（path=沙盒拷贝绝对路径，name=文件名含扩展名）。
public typealias IosFilePicked = (_ path: String, _ name: String) -> Void
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
    for url in urls {
      // asCopy=true 已拷进沙盒 tmp：直接回传绝对路径与文件名
      onPicked(url.path, url.lastPathComponent)
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
