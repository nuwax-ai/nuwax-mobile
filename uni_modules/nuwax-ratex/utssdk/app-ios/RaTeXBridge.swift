// RaTeXBridge.swift — RaTeX → UIImage → PNG base64 桥（供 UTS iOS 调用）。
//
// 封装 RaTeXEngine.parse + RaTeXRenderer.draw(in:) + UIGraphicsImageRenderer 位图编码，
// 使 UTS 侧无需直接处理 CoreGraphics / CoreText / DisplayList / 颜色解析。
//
// 返回编码字符串（与 Android RaTeXBridge.kt 约定一致）：
//   成功："data:image/png;base64,<b64>|<w>|<h>"
//   失败："ERR:<message>"

import UIKit
import CoreText
import RaTeXFFI

@objc(RaTeXBridge)
public class RaTeXBridge: NSObject {

    /// 位图最长边像素上限：等比 clamp，防超宽/病态公式产生超大位图 → 内存峰值。
    private static let maxDim = 1600
    private static var fontsLoaded = false

    /// 字体加载：RaTeXFontLoader.ensureLoaded() 默认方式 + Bundle 兜底扫描。
    /// uni-app x 把插件资源打包进 app bundle；首次渲染时扫描 KaTeX_*.ttf 所在目录。
    private static func ensureFonts() {
        if fontsLoaded { return }
        fontsLoaded = true
        RaTeXFontLoader.ensureLoaded()
        // 兜底：在 main bundle 里找 KaTeX_Main-Regular.ttf 所在目录，整体加载
        if let url = Bundle.main.url(forResource: "KaTeX_Main-Regular", withExtension: "ttf") {
            RaTeXFontLoader.loadFromDirectory(url.deletingLastPathComponent())
        }
    }

    /**
     把一条 LaTeX 渲染成 PNG dataURL（同步，建议在后台队列或 setTimeout 内调用）。
     - returns: 编码结果串（见文件头约定）
     */
    @objc public static func renderToPngDataUrl(
        _ tex: String,
        displayMode: Bool,
        fontSizePx: CGFloat,
        colorHex: String
    ) -> String {
        ensureFonts()
        let color = UIColor.ratex_fromHex(colorHex)
        do {
            let dl = try RaTeXEngine.shared.parse(tex, displayMode: displayMode, color: color)
            let renderer = RaTeXRenderer(displayList: dl, fontSize: fontSizePx)
            var w = Int(ceil(renderer.width))
            var h = Int(ceil(renderer.totalHeight))
            if w < 1 { w = 1 }
            if h < 1 { h = 1 }
            if w > maxDim { h = h * maxDim / w; w = maxDim }
            if h > maxDim { w = w * maxDim / h; h = maxDim }

            let format = UIGraphicsImageRendererFormat()
            format.scale = 1
            let uiRenderer = UIGraphicsImageRenderer(size: CGSize(width: w, height: h), format: format)
            // UIGraphicsImageRenderer 的 cgContext 是 UIKit 坐标（y 向下），
            // 与 RaTeXRenderer.draw(in:) 设计一致（UIView draw 坐标系）。
            let img = uiRenderer.image { ctx in
                renderer.draw(in: ctx.cgContext)
            }
            guard let pngData = img.pngData() else { return "ERR:png_encode" }
            let b64 = pngData.base64EncodedString()
            return "data:image/png;base64," + b64 + "|" + String(w) + "|" + String(h)
        } catch {
            return "ERR:" + error.localizedDescription
        }
    }
}

extension UIColor {
    /// "#RRGGBB" → UIColor（非法回退黑）。
    static func ratex_fromHex(_ hex: String) -> UIColor {
        var s = hex
        if s.hasPrefix("#") { s.removeFirst() }
        var rgb: UInt32 = 0
        Scanner(string: s).scanHexInt32(&rgb)
        let r = CGFloat((rgb >> 16) & 0xff) / 255.0
        let g = CGFloat((rgb >> 8) & 0xff) / 255.0
        let b = CGFloat(rgb & 0xff) / 255.0
        return UIColor(red: r, green: g, blue: b, alpha: 1)
    }
}
