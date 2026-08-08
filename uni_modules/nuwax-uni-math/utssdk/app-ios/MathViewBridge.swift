// Copyright Nuwax. All rights reserved.
//
// MathViewBridge.swift
// nuwax-uni-math (iOS 混编 Swift 文件)
//
// iOS 原生数学视图桥：把 iosMath 的 MTMathView（CoreText 矢量数学排版，自带 latinmodern 等
// OTF 数学字体）包成 UTS 可调的静态方法，供 <x-native-math> 的 <native-view> 经 bindIOSView 绑定。
//
// 与 Android 端 utssdk/app-android/index.uts 的 NativeMathView 语义对齐（AndroidMath 是 iosMath
// 的 Java/Kotlin 移植，MTMathView API 几乎一致：latex / labelMode / fontSize / textColor）。
//
// 混编约定（同 MathSvgBridge.swift / esp EspProvisioningBridge）：public final class : NSObject，
// 纯 Swift 无 @objc，index.uts 无需 import 直接以「MathViewBridge.静态方法」调用；
// number 跨 UTS↔Swift 边界映射为 NSNumber（fontSize / colorArgb 用 NSNumber，内部转 CGFloat/Int64）。
//
// ★ 待 Xcode 真机验证（本环境只能 appResource 转译，不跑 swiftc / 不解析 pod）：
//   1. iosMath pod 版本：0.9.4 是最后的 CocoaPods 版本（1.x/2.x 已转 SPM，2.x 还把类改名 MTMathUILabel）。
//      config.json 钉 0.9.4；若你的 pod 镜像有更高 1.x（同名 MTMathView API）可改用之；勿用 2.x。
//   2. `import iosMath`：现代 pod 一般 DEFINES_MODULE=YES 可直接 import；若该 pod 未设模块，
//      删掉本行、靠自动 bridging header 用 MTMathView（类名全局可见）。
//   3. MTMathViewMode 枚举：ObjC NS_ENUM 在 Swift 下常剥前缀（kMTMathViewModeDisplay → .display）。
//      下面用原 ObjC 名 kMTMathViewModeDisplay；若 swiftc 报错改 MTMathViewMode.display / .text。

import Foundation
import UIKit
import iosMath

public final class MathViewBridge: NSObject {

  /// 创建 MTMathView（按 app 默认配置），返回 UIView 供 UTS 侧 bindIOSView 绑定。
  /// MTMathView 是 UIView 子类，CoreText 排版在原生层完成（不过 proxy web-view，无 evalJS 桥）。
  public static func createView() -> UIView {
    let v = MTMathView(frame: CGRect.zero)
    // 解析失败时把错误内联显示（红字），便于真机调试 LaTeX 覆盖度；可视情况关。
    v.displayErrorInline = true
    return v
  }

  /// 一次性下发 latex / 块级模式 / 字号 / 颜色。
  /// UTS NativeMathView 的各 setter（setLatex/DisplayMode/FontSize/TextColor）统一经此重排，
  /// 与 Android NativeMathView 的 setter API 一一对应（x-native-math.uvue 无需平台分叉）。
  public static func applyLatex(
    _ view: UIView,
    _ latex: String,
    _ display: Bool,
    _ fontSize: NSNumber,
    _ colorArgb: NSNumber
  ) {
    guard let v = view as? MTMathView else { return }
    v.latex = latex
    // ★ 枚举名见文件头注释；若 swiftc 报错改 .display / .text。
    v.labelMode = display ? MTMathViewMode.kMTMathViewModeDisplay : MTMathViewMode.kMTMathViewModeText
    let size = fontSize.doubleValue
    if size > 0 {
      v.fontSize = CGFloat(size)
    }
    let argb = colorArgb.int64Value
    if argb != -1 {
      v.textColor = uiColor(fromArgb: argb)
    }
    // iOS 无 requestLayout/invalidate；触发 CoreText 重排 + 重绘
    v.setNeedsLayout()
    v.setNeedsDisplay()
  }

  /// ARGB int (0xAARRGGBB) → UIColor，与 Android setTextColor(ARGB int) 对齐。
  private static func uiColor(fromArgb argb: Int64) -> UIColor {
    let a = CGFloat((argb >> 24) & 0xFF) / 255.0
    let r = CGFloat((argb >> 16) & 0xFF) / 255.0
    let g = CGFloat((argb >> 8) & 0xFF) / 255.0
    let b = CGFloat(argb & 0xFF) / 255.0
    return UIColor(red: r, green: g, blue: b, alpha: a)
  }
}
