package com.nuwax.bugly

import android.content.Context
import com.tencent.bugly.crashreport.CrashReport

object BuglyBridge {
    fun start(context: Context, appId: String, serviceHost: String, environment: String) {
        val strategy = CrashReport.UserStrategy(context)
        strategy.setBuglyLogUpload(false)
        strategy.setEnableUserInfo(false)
        strategy.setEnableNativeCrashMonitor(true)
        strategy.setEnableANRCrashMonitor(true)
        strategy.setAppChannel(serviceHost)
        strategy.setReplaceOldChannel(true)
        CrashReport.setPersonalInfoCollectEnable(false)
        CrashReport.setCollectPrivacyInfo(context, false)
        CrashReport.setAnrProcessInfoCollectEnable(false)
        CrashReport.initCrashReport(context, appId, false, strategy)
        CrashReport.putUserData(context, "service_host", serviceHost)
        CrashReport.putUserData(context, "environment", environment)
    }

    fun stop() {
        CrashReport.closeBugly()
    }
}
