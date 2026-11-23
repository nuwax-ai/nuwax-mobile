import CoreGraphics
import CoreImage
import CoreVideo
import Foundation
import LiveKitClient

/// LiveKit 2.19 的 InAppScreenCapturer 将 ReplayKit 原始帧直接交给编码器，
/// ScreenShareCaptureOptions.dimensions 并未在该路径执行缩放。
/// 在 SDK 的串行 processingQueue 上缩放整帧，不操作 UIKit、不占用主线程。
final class MeetingScreenShareProcessor: NSObject, VideoProcessor {
  // 广播时主 App 可在后台，禁止依赖后台不可用的 GPU 渲染。
  private let context = CIContext(options: [.cacheIntermediates: false, .useSoftwareRenderer: true])
  private var pool: CVPixelBufferPool?
  private var poolWidth = 0
  private var poolHeight = 0
  private var lastFrameSlot: Int64?
  private var received = 0
  private var emitted = 0
  private var throttled = 0
  private var failed = 0
  private var lastDiagnosticTime: TimeInterval = 0
  private let diagnosticLock = NSLock()
  private var diagnosticText = "waiting-frame"
  private var lastFrameTime: TimeInterval?

  func diag() -> String {
    diagnosticLock.lock()
    let text = diagnosticText
    let frameTime = lastFrameTime
    diagnosticLock.unlock()
    let age = frameTime.map { String(Int(max(0, ProcessInfo.processInfo.systemUptime - $0) * 1000)) } ?? "na"
    return "\(text),ageMs=\(age)"
  }

  func process(frame: VideoFrame) -> VideoFrame? {
    received += 1
    var inputSize = "unknown"
    var outputSize = "none"
    var error = "none"
    defer {
      let now = ProcessInfo.processInfo.systemUptime
      diagnosticLock.lock()
      lastFrameTime = now
      if received == 1 || now - lastDiagnosticTime >= 1 || error != "none" {
        diagnosticText = "raw=\(inputSize),out=\(outputSize),in=\(received),passed=\(emitted),throttle=\(throttled),failed=\(failed),error=\(error)"
        lastDiagnosticTime = now
      }
      diagnosticLock.unlock()
    }

    // ReplayKit 提供 CVPixelBuffer。不要对来源不明的 buffer 做不安全的强制转换。
    guard let input = (frame.buffer as? CVPixelVideoBuffer)?.pixelBuffer else {
      failed += 1
      error = "unsupported-buffer"
      return nil
    }
    let width = CVPixelBufferGetWidth(input)
    let height = CVPixelBufferGetHeight(input)
    inputSize = "\(width)x\(height)"
    guard width >= 2, height >= 2 else {
      failed += 1
      error = "invalid-size"
      return nil
    }

    // 按横竖屏等比适配 1280×720，不拉伸、不裁切，不把小画面放大。
    let scale = min(1.0, min(1280.0 / Double(max(width, height)), 720.0 / Double(min(width, height))))
    let targetWidth = max(2, Int(Double(width) * scale) / 2 * 2)
    let targetHeight = max(2, Int(Double(height) * scale) / 2 * 2)
    outputSize = "\(targetWidth)x\(targetHeight)"

    // 每个 1/30 秒时间片最多处理一帧；使用原始采集时间戳，不靠主线程定时器。
    let slot = frame.timeStampNs / (1_000_000_000 / 30)
    if let previous = lastFrameSlot, slot == previous {
      throttled += 1
      return nil
    }

    guard let output = makeOutputBuffer(width: targetWidth, height: targetHeight) else {
      failed += 1
      error = "pixel-buffer-pool"
      return nil
    }
    let image = CIImage(cvPixelBuffer: input).transformed(by: CGAffineTransform(
      scaleX: CGFloat(targetWidth) / CGFloat(width),
      y: CGFloat(targetHeight) / CGFloat(height)
    ))
    context.render(image, to: output)
    lastFrameSlot = slot
    emitted += 1
    // 每帧取独立 pool buffer；编码器持有期间不会被下一帧覆盖，避免异步读写撕裂。
    return VideoFrame(
      dimensions: Dimensions(width: Int32(targetWidth), height: Int32(targetHeight)),
      rotation: frame.rotation,
      timeStampNs: frame.timeStampNs,
      buffer: CVPixelVideoBuffer(pixelBuffer: output)
    )
  }

  private func makeOutputBuffer(width: Int, height: Int) -> CVPixelBuffer? {
    if pool == nil || poolWidth != width || poolHeight != height {
      pool = nil
      let attributes: [String: Any] = [
        kCVPixelBufferWidthKey as String: width,
        kCVPixelBufferHeightKey as String: height,
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
        kCVPixelBufferMetalCompatibilityKey as String: true,
      ]
      guard CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attributes as CFDictionary, &pool) == kCVReturnSuccess else {
        return nil
      }
      poolWidth = width
      poolHeight = height
    }
    guard let pool else { return nil }
    var output: CVPixelBuffer?
    // 下游慢时丢弃新帧并记录，而不是无限分配全屏缓冲区或重用仍在编码的帧。
    let limits = [kCVPixelBufferPoolAllocationThresholdKey as String: 6] as CFDictionary
    guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool, limits, &output) == kCVReturnSuccess else {
      return nil
    }
    return output
  }
}
