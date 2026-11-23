import Foundation

/// 后台停止广播也必须释放共享占位。只使用入会 JWT，不能释放另一席位的共享。
/// 凭据仅存在于主 App 内存中，不写入 App Group，不交给广播扩展。
final class MeetingShareLease: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
  static let shared = MeetingShareLease()
  private var endpoint: URL?
  private var token = ""
  private var owned = false
  private let pendingLock = NSLock()
  private var pending = false
  var isReleasing: Bool {
    pendingLock.lock()
    defer { pendingLock.unlock() }
    return pending
  }
  private lazy var session = URLSession(configuration: .ephemeral, delegate: self, delegateQueue: nil)

  func urlSession(_ session: URLSession, task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void) {
    // 席位凭据不能跟随重定向被转发到其他站点。
    completionHandler(nil)
  }

  // 全部由桥接层在主线程调用。
  func configure(_ endpoint: String, token: String) {
    self.endpoint = URL(string: endpoint)
    self.token = token
    owned = false
  }

  func acquired() { owned = true }

  func release() {
    guard owned, let endpoint, !token.isEmpty else { return }
    owned = false
    pendingLock.lock()
    pending = true
    pendingLock.unlock()
    var request = URLRequest(url: endpoint)
    request.httpMethod = "POST"
    request.timeoutInterval = 10
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try? JSONSerialization.data(withJSONObject: ["token": token])
    // URLSession 不依赖页面/UTS 定时器；不打印令牌、URL 参数或响应正文。
    session.dataTask(with: request) { [self] _, response, error in
      pendingLock.lock()
      pending = false
      pendingLock.unlock()
      if error != nil || (response as? HTTPURLResponse)?.statusCode != 200 {
        NSLog("[MeetingBridge] share lease release incomplete; foreground reconciliation required")
      }
    }.resume()
  }

  func clear() { release(); endpoint = nil; token = "" }
}
