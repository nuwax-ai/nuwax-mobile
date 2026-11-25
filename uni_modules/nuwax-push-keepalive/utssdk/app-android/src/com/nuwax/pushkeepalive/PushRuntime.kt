package com.nuwax.pushkeepalive

import android.content.Context
import android.content.pm.ApplicationInfo
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.lang.reflect.Method

/**
 * 保留 DCloud 的 GTIntentService，只替换它读取的 PushActionHolder 回调对象。
 *
 * Getui 3.x 会记住并直接启动 DCloudUniPush.UniPushIntentService。真机已验证，运行时
 * 禁用该组件或注册另一个 GTIntentService 不会让 SDK 改绑，只会反复启动失败。因此这里
 * 不修改 Manifest/组件状态，也不调用 Getui 的接收器改绑 API。
 */
object PushRuntime {
    private const val TAG = "NuwaxPushKeepAlive"
    private const val VOIP_TAG = "NuwaxVoip"
    private const val INDEX = "uts.sdk.modules.DCloudUniPush.IndexKt"
    private const val HOLDER = "uts.sdk.modules.DCloudUniPush.PushActionHolder"
    private const val OPTIONS = "uts.sdk.modules.DCloudUniPush.GTPushActionOptions"
    private const val ACTION = "uts.sdk.modules.DCloudUniPush.UserPushAction"
    private const val VOIP_PAYLOAD = "com.nuwax.voip.VoipPushPayload"
    private const val VOIP_BRIDGE = "com.nuwax.voip.VoipBridge"

    private val main = Handler(Looper.getMainLooper())
    private var installedAction: Any? = null

    /**
     * 在 Getui initialize 前安装；进程被划掉后由 STICKY 服务再次安装。
     * DCloud 前台初始化稍后覆盖本桥也安全：有 Activity 时本来就由其原回调处理。
     */
    @JvmStatic
    @Synchronized
    fun installDCloudBridge(context: Context): Boolean {
        val app = context.applicationContext
        return try {
            val current = getPushAction()
            if (current != null && current === installedAction) return true

            // getGTCallBack 会创建 DCloud 的标准回调（CID 持久化、前台事件、点击恢复等），
            // 本桥只在它外面加一层，不能重写这些既有行为。
            val delegate = current ?: invokeStatic(INDEX, "getGTCallBack")
                ?: error("DCloud callback unavailable")
            val delegateOptions = delegate.javaClass.getDeclaredMethod("getOptions").run {
                isAccessible = true
                invoke(delegate)
            } ?: error("DCloud callback options unavailable")

            val callbacks = arrayOf<(Any?) -> Unit>(
                { value -> forward(delegateOptions, "getOnReceiveServicePid", value) },
                { value -> forward(delegateOptions, "getOnReceiveClientId", value) },
                { value ->
                    val raw = value as? String
                    main.post {
                        if (raw == null ||
                            !routeVoip(app, raw, "transmission") &&
                            !ImHeadlessPush.receive(app, raw, null)) {
                            forward(delegateOptions, "getOnReceiveMessageData", value)
                        }
                    }
                },
                { value ->
                    forward(delegateOptions, "getOnReceiveOnlineState", value)
                },
                { value -> forward(delegateOptions, "getOnReceiveCommandResult", value) },
                { value -> forward(delegateOptions, "getOnNotificationMessageClicked", value) },
                { value -> forward(delegateOptions, "getOnNotificationMessageArrived", value) }
            )
            val optionsClass = Class.forName(OPTIONS)
            val options = optionsClass.constructors.first { it.parameterTypes.size == callbacks.size }
                .newInstance(*callbacks.map { it as Any }.toTypedArray())
            val action = Class.forName(ACTION).getConstructor(optionsClass).newInstance(options)
            setPushAction(action)
            installedAction = action
            true
        } catch (error: Throwable) {
            // 增强失败不能阻断 DCloud 原推送初始化，更不能影响登录和 WebSocket。
            Log.w(TAG, "DCloud push action bridge failed type=${error.javaClass.simpleName}")
            false
        }
    }

    private fun getPushAction(): Any? = invokeCompanion(HOLDER, "getPushAction")

    private fun setPushAction(action: Any) {
        invokeCompanion(HOLDER, "setPushAction", action)
    }

    private fun forward(options: Any, getter: String, value: Any?) {
        try {
            val callback = options.javaClass.getMethod(getter).invoke(options) ?: return
            findMethod(callback.javaClass, "invoke", arrayOf(value))?.invoke(callback, value)
                ?: Log.w(TAG, "DCloud callback invoke missing getter=$getter")
        } catch (error: Throwable) {
            Log.w(TAG, "DCloud callback failed getter=$getter type=${error.javaClass.simpleName}")
        }
    }

    private fun routeVoip(context: Context, raw: String, source: String): Boolean {
        return try {
            val invitation = invokeStatic(VOIP_PAYLOAD, "invitation", raw) as? String ?: return false
            val handled = invokeStatic(VOIP_BRIDGE, "receiveUniPush", context, invitation, source) as? Boolean == true
            if (context.applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE != 0) {
                Log.d(VOIP_TAG, "push received: $source, call=true, handled=$handled")
            }
            handled
        } catch (_: ClassNotFoundException) {
            false
        } catch (error: Throwable) {
            Log.w(VOIP_TAG, "push route failed type=${error.javaClass.simpleName}")
            false
        }
    }

    private fun invokeStatic(className: String, name: String, vararg args: Any?): Any? {
        val type = Class.forName(className)
        val method = findMethod(type, name, args)
            ?: throw NoSuchMethodException("$className.$name/${args.size}")
        return method.invoke(null, *args)
    }

    private fun invokeCompanion(className: String, name: String, vararg args: Any?): Any? {
        val type = Class.forName(className)
        val companion = type.getField("Companion").get(null)
        val method = findMethod(companion.javaClass, name, args)
            ?: throw NoSuchMethodException("$className.Companion.$name/${args.size}")
        return method.invoke(companion, *args)
    }

    private fun findMethod(type: Class<*>, name: String, args: Array<out Any?>): Method? =
        type.methods.firstOrNull { method ->
            method.name == name && method.parameterTypes.size == args.size &&
                method.parameterTypes.indices.all { compatible(method.parameterTypes[it], args[it]) }
        }

    private fun compatible(parameter: Class<*>, value: Any?): Boolean {
        if (value == null) return !parameter.isPrimitive
        val boxed = when (parameter) {
            java.lang.Boolean.TYPE -> java.lang.Boolean::class.java
            java.lang.Integer.TYPE -> java.lang.Integer::class.java
            java.lang.Long.TYPE -> java.lang.Long::class.java
            java.lang.Double.TYPE -> java.lang.Double::class.java
            java.lang.Float.TYPE -> java.lang.Float::class.java
            java.lang.Short.TYPE -> java.lang.Short::class.java
            java.lang.Byte.TYPE -> java.lang.Byte::class.java
            java.lang.Character.TYPE -> java.lang.Character::class.java
            else -> parameter
        }
        return boxed.isAssignableFrom(value.javaClass) || parameter == Any::class.java
    }
}
