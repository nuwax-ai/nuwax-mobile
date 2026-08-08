// Copyright Nuwax. All rights reserved.
//
// MathSvgBridge.swift
// nuwax-uni-math (iOS 混编 Swift 文件)
//
// 与 Android 端 utssdk/app-android/index.uts 的 renderMathAsync 语义对齐：
// LaTeX →（JavaScriptCore + MathJax tex-svg bundle）→ SVG →（UIImage 栅格化）→ PNG dataURL。
//
// 混编约定（见 uts-plugin-hybrid 文档，同 nuwax-esp-provisioning/EspProvisioningBridge.swift）：
// 本文件不放 index.swift；index.uts 无需 import，直接以「MathSvgBridge.静态方法(闭包)」调用，
// 闭包类型按位置一一对应（见下方 MathSvgResult typealias）。回调在 Swift 侧声明为 UTS 函数类型别名。
//
// 与 Android 的差异（受 iOS 能力约束）：
//  - JS 引擎：用系统 JavaScriptCore（免 vendor，iOS 7+ 自带），比 QuickJS 快、兼容性更好；
//    bundle 同一份 DOM-free MathJax（liteAdaptor，JSC 是完整 ES 引擎可直接跑）。
//  - SVG 栅格化：iOS 13+ UIImage(data:) 支持 SVG，draw 进 UIGraphicsImageRenderer 位图（PNG）。
//    ★ TODO(Xcode 验证)：UIImage(data:) 对 MathJax SVG 若解析不稳（iOS 原生 SVG 支持有限），
//    改用 SVGKit pod（见 config.json 注释的 dependencies-pods），或 WKWebView 离屏渲染。
//  - 位图格式：PNG（iOS 无原生 WebP 编码；iOS 设备快，PNG 可接受；导出仍走 svg 矢量无损）。
//  - 线程：JSContext 单实例非线程安全 → 全部 eval + 栅格化在专用串行 DispatchQueue 上；
//    结果经 DispatchQueue.main.async 切回主线程回调（UTS 侧无需再切）。

import Foundation
import JavaScriptCore
import UIKit

/// 渲染结果回调（字段顺序对应 index.uts 的 UTSJSONObject 组装）。
/// error 非空时其余字段为空/0。
/// 注意：number 跨 UTS↔Swift 边界映射为 NSNumber（同 esp EspDeviceFound 的 rssi: NSNumber），
/// 故 width/height 用 NSNumber，不能用 Double（否则 Xcode 编译失败）。
public typealias MathSvgResult = (
  _ imageDataURL: String,
  _ width: NSNumber,
  _ height: NSNumber,
  _ svg: String,
  _ error: String
) -> Void

public final class MathSvgBridge: NSObject {

  /// 专用串行队列：JSContext 非线程安全，所有 eval + 栅格化串行在此队列（同 Android 单线程 executor）。
  private static let workQueue = DispatchQueue(label: "com.nuwax.uni-math.svgjs")
  private static var context: JSContext?
  private static var renderFn: JSValue?
  private static var loaded = false
  private static var loadError = ""

  /// 位图最长边上限（等比 clamp，防超大位图 OOM；同 Android BITMAP_MAX_DIM）。
  private static let bitmapMaxDim: CGFloat = 1600

  /// 同 Android 契约：异步渲染一条公式，结果在主线程回调。
  /// dpiScale：UTS number → NSNumber，故参数类型用 NSNumber（非 Double）。
  public static func renderMathAsync(
    _ latex: String,
    _ display: Bool,
    _ dpiScale: NSNumber,
    _ color: String,
    _ onResult: @escaping MathSvgResult
  ) {
    workQueue.async {
      ensureLoaded()
      if !loadError.isEmpty {
        DispatchQueue.main.async { onResult("", 0, 0, "", loadError) }
        return
      }
      guard let fn = renderFn else {
        DispatchQueue.main.async { onResult("", 0, 0, "", "render_no_fn") }
        return
      }
      let val = fn.call(withArguments: [latex, display])
      let svg = val?.toString() ?? ""
      if svg.isEmpty {
        DispatchQueue.main.async { onResult("", 0, 0, "", "render_empty") }
        return
      }
      let dpiScaleF = CGFloat(dpiScale.doubleValue)
      var dataURL = ""
      var w = 0.0
      var h = 0.0
      var err = ""
      do {
        (dataURL, w, h, err) = try rasterize(svg: svg, dpiScale: dpiScaleF, color: color)
      } catch {
        err = "rasterize_failed:\(error)"
      }
      let svgCopy = svg
      DispatchQueue.main.async {
        if err.isEmpty {
          // width/height 回 NSNumber（MathSvgResult 契约）；0 字面量可作 NSNumber（ExpressibleByIntegerLiteral）。
          onResult(dataURL, NSNumber(value: w), NSNumber(value: h), svgCopy, "")
        } else {
          onResult("", 0, 0, "", err)
        }
      }
    }
  }

  // MARK: - JSContext 懒加载（首调时在 workQueue 上执行，与使用线程一致）

  private static func ensureLoaded() {
    if loaded { return }
    loaded = true
    guard let bundleString = readBundle() else {
      loadError = "bundle_read_failed"
      return
    }
    guard let ctx = JSContext() else {
      loadError = "jscontext_create_failed"
      return
    }
    ctx.exceptionHandler = { _, exception in
      // 转发到 NSLog（HBuilderX console 可见），便于定位 bundle 加载 / 渲染异常
      NSLog("[MathSvg] JS exception: %@", exception?.toString() ?? "nil")
    }
    // 与 Android 同款 require/dirname/module 存根（belt-and-suspenders，MathJax 已 define PACKAGE_VERSION）
    let stub = "var require=function(){return{}};var __dirname='/';var module={exports:{}};var global=globalThis;"
    ctx.evaluateScript(stub + bundleString)
    renderFn = ctx.objectForKeyedSubscript("renderLatexToSvg")
    if renderFn == nil {
      loadError = "bundle_no_renderFn"
      return
    }
    context = ctx
  }

  /// 从 app bundle 读 MathJax bundle。
  /// ★ TODO(Xcode 验证)：uni-app x 把 static/ 资源打进 iOS app bundle 的确切子目录，
  /// 下面按 Android 镜像规则列了候选 + 全 bundle 兜底；真机首次跑用 NSLog 打印 Bundle.main 资源
  /// 路径定位（Android 是 assets/apps/__UNI__8BF05E4/www/uni_modules/.../static/...）。
  private static func readBundle() -> String? {
    let candidates: [String] = [
      "apps/__UNI__8BF05E4/www/uni_modules/nuwax-uni-math/static/x-math",
      "www/apps/__UNI__8BF05E4/www/uni_modules/nuwax-uni-math/static/x-math",
      "uni_modules/nuwax-uni-math/static/x-math",
      "static/x-math",
    ]
    for dir in candidates {
      if let url = Bundle.main.url(forResource: "mathjax-tex-svg", withExtension: "js", subdirectory: dir) {
        return try? String(contentsOf: url, encoding: .utf8)
      }
    }
    // 兜底：全 bundle 找（不指定子目录）
    if let url = Bundle.main.url(forResource: "mathjax-tex-svg", withExtension: "js") {
      return try? String(contentsOf: url, encoding: .utf8)
    }
    return nil
  }

  // MARK: - SVG → PNG 位图

  private static func rasterize(svg: String, dpiScale: CGFloat, color: String) throws -> (String, Double, Double, String) {
    // MathJax 用 currentColor，UIImage 无 CSS 上下文 → 替换为显式颜色
    let colored = svg.replacingOccurrences(of: "currentColor", with: color)
    guard let svgData = colored.data(using: .utf8) else {
      return ("", 0, 0, "svg_data_failed")
    }
    // iOS 13+ UIImage(data:) 支持 SVG（矢量，draw 时栅格化）。★ TODO：若不稳改 SVGKit。
    guard let image = UIImage(data: svgData) else {
      return ("", 0, 0, "svg_load_failed")
    }
    let natW = image.size.width
    let natH = image.size.height
    if natW <= 0 || natH <= 0 {
      return ("", 0, 0, "rasterize_zero_size")
    }
    // 等比 clamp 到 bitmapMaxDim（同 Android clamp 逻辑）
    var scale = dpiScale
    let maxSide = max(natW * scale, natH * scale)
    if maxSide > bitmapMaxDim {
      scale = scale * (bitmapMaxDim / maxSide)
    }
    let targetW = max(1, Int(natW * scale))
    let targetH = max(1, Int(natH * scale))
    let renderer = UIGraphicsImageRenderer(size: CGSize(width: targetW, height: targetH))
    let pngData = renderer.pngData { _ in
      image.draw(in: CGRect(x: 0, y: 0, width: targetW, height: targetH))
    }
    let b64 = pngData.base64EncodedString()
    let dataURL = "data:image/png;base64," + b64
    return (dataURL, Double(targetW), Double(targetH), "")
  }
}
