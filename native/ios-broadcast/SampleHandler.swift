import ReplayKit
import CoreImage
import CoreMedia
import CoreVideo
import CoreGraphics
import LiveKitClient

/// 扩展只采集并通过 LiveKit IPC 传帧，不创建第二个 Room，不接触会议 JWT。
final class SampleHandler: LKSampleHandler, @unchecked Sendable {
  private let context = CIContext(options: [.useSoftwareRenderer: true, .cacheIntermediates: false])
  private var pool: CVPixelBufferPool?
  private var outputWidth = 0
  private var outputHeight = 0
  private var lastPTS: CMTime?

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with type: RPSampleBufferType) {
    // 麦克风沿用主 App 的会议音轨，不能在广播扩展再采一次而形成回声。
    guard type == .video, CMSampleBufferDataIsReady(sampleBuffer),
          let input = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)
    if let previous = lastPTS, CMTimeCompare(pts, previous) >= 0,
       CMTimeGetSeconds(CMTimeSubtract(pts, previous)) < 1.0 / 30.0 { return }
    let width = CVPixelBufferGetWidth(input)
    let height = CVPixelBufferGetHeight(input)
    guard width >= 2, height >= 2 else { return }
    let scale = min(1.0, min(1280.0 / Double(max(width, height)), 720.0 / Double(min(width, height))))
    let w = max(2, Int(Double(width) * scale) / 2 * 2)
    let h = max(2, Int(Double(height) * scale) / 2 * 2)
    if pool == nil || w != outputWidth || h != outputHeight {
      pool = nil
      let attributes: [String: Any] = [
        kCVPixelBufferWidthKey as String: w, kCVPixelBufferHeightKey as String: h,
        kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
        kCVPixelBufferIOSurfacePropertiesKey as String: [:] as [String: Any],
      ]
      guard CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, attributes as CFDictionary, &pool) == kCVReturnSuccess else { return }
      outputWidth = w
      outputHeight = h
    }
    guard let pool else { return }
    var output: CVPixelBuffer?
    let limits = [kCVPixelBufferPoolAllocationThresholdKey as String: 3] as CFDictionary
    guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, pool, limits, &output) == kCVReturnSuccess,
          let output else { return }
    let image = CIImage(cvPixelBuffer: input).transformed(by: CGAffineTransform(
      scaleX: CGFloat(w) / CGFloat(width), y: CGFloat(h) / CGFloat(height)))
    context.render(image, to: output)
    var format: CMVideoFormatDescription?
    guard CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault,
      imageBuffer: output, formatDescriptionOut: &format) == noErr, let format else { return }
    var timing = CMSampleTimingInfo(duration: CMSampleBufferGetDuration(sampleBuffer),
      presentationTimeStamp: pts, decodeTimeStamp: .invalid)
    var resized: CMSampleBuffer?
    guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault,
      imageBuffer: output, formatDescription: format, sampleTiming: &timing,
      sampleBufferOut: &resized) == noErr, let resized else { return }
    // SDK 从该附件读取方向；缩放后必须继承，横竖屏切换才不会倒置。
    if let orientation = CMGetAttachment(sampleBuffer, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil) {
      CMSetAttachment(resized, key: RPVideoSampleOrientationKey as CFString, value: orientation, attachmentMode: .shouldPropagate)
    }
    lastPTS = pts
    super.processSampleBuffer(resized, with: type)
  }

  override func broadcastFinished() {
    super.broadcastFinished()
    pool = nil
    lastPTS = nil
  }
}
