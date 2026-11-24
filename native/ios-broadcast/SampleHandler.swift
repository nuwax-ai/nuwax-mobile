import LiveKitClient

// 扩展使用 LiveKit 的 ReplayKit 回调经 IPC 传帧，由主 App 在发布前缩放和限帧。
final class SampleHandler: LKSampleHandler, @unchecked Sendable {}
