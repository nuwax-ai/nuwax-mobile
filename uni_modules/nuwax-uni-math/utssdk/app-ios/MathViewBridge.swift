// Copyright Nuwax. All rights reserved.
//
// MathViewBridge.swift
// nuwax-uni-math (iOS 混编 Swift 文件)
//
// iOS 原生数学视图桥：把 iosMath 的 MTMathUILabel（CoreText 矢量数学排版，自带 latinmodern 等
// OTF 数学字体）包成 UTS 可调的静态方法，供 <x-native-math> 的 <native-view> 经 bindIOSView 绑定。
//
// 与 Android 端 utssdk/app-android/index.uts 的 NativeMathView 语义对齐（AndroidMath 是 iosMath
// 的 Java/Kotlin 移植；Android 类叫 MTMathView，iOS 原版类叫 MTMathUILabel——API 镜像但类名不同：
// latex / labelMode / fontSize / textColor）。
//
// 混编约定（同 MathSvgBridge.swift / esp EspProvisioningBridge）：public final class : NSObject，
// 纯 Swift 无 @objc，index.uts 无需 import 直接以「MathViewBridge.静态方法」调用；
// number 跨 UTS↔Swift 边界映射为 NSNumber（fontSize / colorArgb 用 NSNumber，内部转 CGFloat/Int64）。
//
// ★ 已核对（搜 uni-app x 官方 + iosMath 0.9.4 头文件 + 仓库 ESP 混编范式，2026-08-08）：
//   1. iosMath 0.9.4 主类是 MTMathUILabel（iosMath/render/MTMathUILabel.h : MTView : UIView），
//      【不存在 MTMathView】——MTMathView 是 Android 端 com.agog.mathdisplay 的移植命名。
//   2. `import iosMath` 正确：与同仓 esp 插件 `import ESPProvision` 同构（config.json
//      dependencies-pods 声明 pod，.swift 里 import <模块名>）。UTS 侧无需 import 同目录 .swift
//      的 public 类（见 uts-plugin-hybrid；ESP index.uts 即裸调 EspProvisioningBridge）。
//   3. 枚举 MTMathUILabelMode（typedef NS_ENUM(unsigned int, ...)）：ObjC kMTMathUILabelModeDisplay/
//      kMTMathUILabelModeText → Swift 导入剥前缀+去 k → .display / .text（与 SwiftMath 移植一致）。

import Foundation
import UIKit
import iosMath

public final class MathViewBridge: NSObject {

  /// 创建 MTMathUILabel（按 app 默认配置），返回 UIView 供 UTS 侧 bindIOSView 绑定。
  /// MTMathUILabel : MTView : UIView，CoreText 排版在原生层完成（不过 proxy web-view，无 evalJS 桥）。
  public static func createView() -> UIView {
    let v = MTMathUILabel(frame: CGRect.zero)
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
    guard let v = view as? MTMathUILabel else { return }
    v.latex = latex
    // MTMathUILabelMode：display=true 块级（$$ \displaystyle）/ false 行内（$ text 模式）
    v.labelMode = display ? MTMathUILabelMode.display : MTMathUILabelMode.text
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
