import AppKit

// Feature-local vector source; exports 3x PNGs for identical iOS/Android rendering.
// Run from repository root: swift scripts/voip-ui/generate-call-icons.swift
let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let output = root.appendingPathComponent("static/voip/call-icons")
let nativeOutput = root.appendingPathComponent("uni_modules/nuwax-voip/utssdk/app-android/res/drawable-nodpi")
try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
try FileManager.default.createDirectory(at: nativeOutput, withIntermediateDirectories: true)

func path(_ c: CGContext, _ points: [CGPoint]) {
    guard let first = points.first else { return }
    c.move(to: first); for p in points.dropFirst() { c.addLine(to: p) }; c.strokePath()
}
func line(_ c: CGContext, _ x1: CGFloat, _ y1: CGFloat, _ x2: CGFloat, _ y2: CGFloat) {
    path(c, [CGPoint(x: x1, y: y1), CGPoint(x: x2, y: y2)])
}
func rounded(_ c: CGContext, _ rect: CGRect, _ radius: CGFloat) {
    c.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil)); c.strokePath()
}
func icon(_ name: String, _ c: CGContext) {
    switch name {
    case "microphone", "microphone-off":
        rounded(c, CGRect(x: 9, y: 3, width: 6, height: 12), 3)
        c.move(to: CGPoint(x: 6, y: 10)); c.addLine(to: CGPoint(x: 6, y: 12))
        c.addCurve(to: CGPoint(x: 18, y: 12), control1: CGPoint(x: 6, y: 20), control2: CGPoint(x: 18, y: 20))
        c.addLine(to: CGPoint(x: 18, y: 10)); c.strokePath()
        line(c, 12, 18, 12, 21); line(c, 9, 21, 15, 21)
    case "speaker", "speaker-off":
        path(c, [CGPoint(x: 11, y: 4), CGPoint(x: 6, y: 8), CGPoint(x: 3, y: 8), CGPoint(x: 3, y: 16), CGPoint(x: 6, y: 16), CGPoint(x: 11, y: 20), CGPoint(x: 11, y: 4)])
        c.move(to: CGPoint(x: 15, y: 8)); c.addCurve(to: CGPoint(x: 15, y: 16), control1: CGPoint(x: 18, y: 10), control2: CGPoint(x: 18, y: 14)); c.strokePath()
        c.move(to: CGPoint(x: 18, y: 4.5)); c.addCurve(to: CGPoint(x: 18, y: 19.5), control1: CGPoint(x: 23, y: 8), control2: CGPoint(x: 23, y: 16)); c.strokePath()
    case "video", "video-off":
        rounded(c, CGRect(x: 2.5, y: 6, width: 13, height: 12), 2.5)
        path(c, [CGPoint(x: 15.5, y: 10), CGPoint(x: 21.5, y: 6.5), CGPoint(x: 21.5, y: 17.5), CGPoint(x: 15.5, y: 14)])
    case "switch-camera":
        rounded(c, CGRect(x: 2.5, y: 5, width: 19, height: 15), 2.5)
        path(c, [CGPoint(x: 8, y: 5), CGPoint(x: 9.5, y: 2.5), CGPoint(x: 14.5, y: 2.5), CGPoint(x: 16, y: 5)])
        path(c, [CGPoint(x: 7, y: 10), CGPoint(x: 17, y: 10), CGPoint(x: 14.5, y: 7.5)])
        path(c, [CGPoint(x: 17, y: 15), CGPoint(x: 7, y: 15), CGPoint(x: 9.5, y: 17.5)])
    case "minimize":
        path(c, [CGPoint(x: 9, y: 3), CGPoint(x: 9, y: 9), CGPoint(x: 3, y: 9)])
        line(c, 3, 3, 9, 9)
        path(c, [CGPoint(x: 15, y: 21), CGPoint(x: 15, y: 15), CGPoint(x: 21, y: 15)])
        line(c, 15, 15, 21, 21)
    case "hangup":
        c.move(to: CGPoint(x: 3, y: 16)); c.addLine(to: CGPoint(x: 3, y: 12))
        c.addCurve(to: CGPoint(x: 21, y: 12), control1: CGPoint(x: 6, y: 7), control2: CGPoint(x: 18, y: 7))
        c.addLine(to: CGPoint(x: 21, y: 16)); c.addLine(to: CGPoint(x: 16.5, y: 15)); c.addLine(to: CGPoint(x: 16.5, y: 11.8))
        c.move(to: CGPoint(x: 3, y: 16)); c.addLine(to: CGPoint(x: 7.5, y: 15)); c.addLine(to: CGPoint(x: 7.5, y: 11.8)); c.strokePath()
    case "phone", "earpiece":
        c.move(to: CGPoint(x: 5, y: 3)); c.addLine(to: CGPoint(x: 9, y: 3)); c.addLine(to: CGPoint(x: 10.5, y: 8))
        c.addLine(to: CGPoint(x: 8, y: 10)); c.addCurve(to: CGPoint(x: 14, y: 16), control1: CGPoint(x: 9, y: 13), control2: CGPoint(x: 11, y: 15))
        c.addLine(to: CGPoint(x: 16, y: 13.5)); c.addLine(to: CGPoint(x: 21, y: 15)); c.addLine(to: CGPoint(x: 21, y: 19))
        c.addCurve(to: CGPoint(x: 3, y: 5), control1: CGPoint(x: 17, y: 26), control2: CGPoint(x: -1, y: 10))
        c.addLine(to: CGPoint(x: 5, y: 3)); c.strokePath()
    case "close": line(c, 6, 6, 18, 18); line(c, 18, 6, 6, 18)
    default: break
    }
    if name.hasSuffix("-off") {
        // A small clear halo keeps the diagonal legible over the underlying outline.
        c.saveGState(); c.setBlendMode(.clear); c.setLineWidth(4); line(c, 3, 3, 21, 21); c.restoreGState()
        line(c, 3, 3, 21, 21)
    }
}

for name in ["microphone", "microphone-off", "speaker", "speaker-off", "earpiece", "video", "video-off", "switch-camera", "minimize", "hangup", "phone", "close"] {
    for (variant, color) in [("white", NSColor.white), ("ink", NSColor(calibratedRed: 0.12, green: 0.16, blue: 0.15, alpha: 1))] {
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 96, pixelsHigh: 96, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        let graphics = NSGraphicsContext(bitmapImageRep: bitmap)!
        let context = graphics.cgContext
        context.clear(CGRect(x: 0, y: 0, width: 96, height: 96))
        context.translateBy(x: 0, y: 96); context.scaleBy(x: 4, y: -4)
        context.setStrokeColor(color.cgColor); context.setLineWidth(1.7); context.setLineCap(.round); context.setLineJoin(.round)
        context.setShouldAntialias(true); icon(name, context)
        let png = bitmap.representation(using: .png, properties: [:])!
        try png.write(to: output.appendingPathComponent("\(name)-\(variant).png"))
        if variant == "white" && name != "close" {
            let resource = "nuwax_voip_" + name.replacingOccurrences(of: "-", with: "_") + ".png"
            try png.write(to: nativeOutput.appendingPathComponent(resource))
        }
    }
}
print("Generated shared call icons and their native Android copies")
