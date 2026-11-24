import UIKit

// 仅用于生成可导出的扩展 IPA；业务 App 仍由 HBuilderX 构建。
@main
final class HostApp: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    let controller = UIViewController()
    controller.view.backgroundColor = .white
    window.rootViewController = controller
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}
