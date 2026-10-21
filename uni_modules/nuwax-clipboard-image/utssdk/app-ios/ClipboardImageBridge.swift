// Copyright Nuwax. All rights reserved.
//
// ClipboardImageBridge.swift
// nuwax-clipboard-image (iOS 混编 Swift 文件)
//
// 聊天页「粘贴剪贴板图片」的 iOS 桥：
// - 探测：hasImages / changeCount 是元数据访问，不触发 iOS 14+ 粘贴隐私横幅（免费探测）
// - 读取：优先取 PNG/JPEG 原始字节（截图为 PNG），否则 UIImage 重压 JPEG，写沙盒 tmp
//   回传 file:// URL；iOS 16+ 首次真正读取时系统弹「允许粘贴」，用户拒绝时读不到数据 → EMPTY
//
// 混编约定（同 nuwax-ios-file-picker）：本文件的 public 类对同目录 index.uts 直接可见
// （无需 import）；回调即 UTS 函数类型别名，按位置对应（无标签参数）。

import UIKit
import UniformTypeIdentifiers

// MARK: - UTS 回调类型别名

/// 探测结果（hasImage=是否含图片；fingerprint=changeCount 内容指纹，供上层去重）。
public typealias ClipboardProbeResult = (_ hasImage: Bool, _ fingerprint: String) -> Void
/// 读图成功（path=沙盒 tmp 的 file:// URL——iOS 的 <image>/previewImage/uploadFile
/// 只认这个形态，同 chooseImage 的 tempFilePath；裸绝对路径三处全不认）。
public typealias ClipboardReadSuccess = (_ path: String) -> Void
/// 读图失败（code：EMPTY/READ/DECODE/WRITE）。
public typealias ClipboardReadFailure = (_ code: String, _ message: String) -> Void

// MARK: - 桥主体（index.uts 直接以静态方法调用）

public final class ClipboardImageBridge: NSObject {

  /// 元数据探测：剪贴板当前是否含图片（不触发粘贴隐私提示）。
  public static func hasImage() -> Bool {
    return UIPasteboard.general.hasImages
  }

  /// 内容指纹：changeCount 随每次复制单调递增，同值=同一份内容（上层只提示一次）。
  public static func clipFingerprint() -> String {
    return "paste-\(UIPasteboard.general.changeCount)"
  }

  /// 读取剪贴板图片写 tmp 后回传路径。统一切主线程（系统粘贴弹窗需前台手势上下文）。
  public static func readImage(
    _ onSuccess: @escaping ClipboardReadSuccess,
    _ onFail: @escaping ClipboardReadFailure
  ) {
    DispatchQueue.main.async {
      let board = UIPasteboard.general
      // 截屏工具拷出的多为 PNG；JPEG 直接落原始字节（免重压）
      if let png = board.data(forPasteboardType: UTType.png.identifier) {
        ClipboardImageBridge.writeTemp(png, "png", onSuccess, onFail)
        return
      }
      if let jpeg = board.data(forPasteboardType: UTType.jpeg.identifier) {
        ClipboardImageBridge.writeTemp(jpeg, "jpg", onSuccess, onFail)
        return
      }
      // 其他图片表示（GIF/HEIC 等）：落 UIImage 统一重压 JPEG
      if let image = board.image, let data = image.jpegData(compressionQuality: 0.92) {
        ClipboardImageBridge.writeTemp(data, "jpg", onSuccess, onFail)
        return
      }
      // 含无图与用户拒绝系统「允许粘贴」弹窗（拒绝后读数即空，两者不可区分）
      onFail("EMPTY", "no readable image in clipboard")
    }
  }

  /// 写沙盒 tmp（覆写同毫秒名概率为零，不做清理，随系统 tmp 策略回收）。
  private static func writeTemp(
    _ data: Data,
    _ ext: String,
    _ onSuccess: @escaping ClipboardReadSuccess,
    _ onFail: @escaping ClipboardReadFailure
  ) {
    let name = "clipboard_\(Int(Date().timeIntervalSince1970 * 1000)).\(ext)"
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
    do {
      try data.write(to: url)
      onSuccess(url.absoluteString)
    } catch {
      onFail("WRITE", error.localizedDescription)
    }
  }
}
