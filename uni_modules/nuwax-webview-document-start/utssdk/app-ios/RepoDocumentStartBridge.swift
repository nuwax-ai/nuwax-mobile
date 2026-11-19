import WebKit

/// 用与 Android / 鸿蒙相同的同源文档写入 ACCESS_TOKEN，再由文档跳到资料库。
public class RepoDocumentStartBridge {
  public static func loadTokenPage(_ webView: WKWebView, _ html: String, _ baseUrl: String) -> Bool {
    guard let url = URL(string: baseUrl) else {
      return false
    }
    webView.loadHTMLString(html, baseURL: url)
    return true
  }
}
