import Bugly

public enum BuglyBridge {
    public static func start(_ appId: String, _ serviceHost: String, _ environment: String) {
        let config = BuglyConfig(appId: appId, appKey: "")
        config.channel = serviceHost
        config.debugMode = false
        config.setEnableAllPersonalInfoCollection(false)
        Bugly.start(with: config)
        Bugly.setUserValue(serviceHost, forKey: "service_host")
        Bugly.setUserValue(environment, forKey: "environment")
    }

    public static func stop() {
        Bugly.closeCrashReport()
    }
}
