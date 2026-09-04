# =============================================================================
# nuwax 自定义基座 R8/ProGuard keep 规则
# =============================================================================
# 策略：minifyEnabled true + shrinkResources true + -dontobfuscate
#   - 裁剪未引用的第三方 SDK 类/资源（Fresco/ExoPlayer/ML Kit/广告 SDK 等子组件）
#   - 不改名（-dontobfuscate），规避 DCloud 运行时大量 Class.forName 反射加载
#     （UTSRegisterComponents / UTSRegisterProviders / UTSHooksClassArray / UTSEasyCom
#      这些建立在 buildConfigField 字符串类名之上，R8 静态分析看不到引用）。
# DCloud 官方对离线打包无 R8/keep 支持，本规则自担验证。
# 用法：构建时设 NUWAX_ENABLE_R8=1，configure_app.py 会把本文件拷成 app/proguard-rules.pro。
# 验证：真机全量冒烟（每个 EasyCom 组件、支付/OAuth/分享/定位、扫码、cmark、ESP 配网）。
# =============================================================================

-dontobfuscate
-allowaccessmodification
-keepattributes *Annotation*, Signature, InnerClasses, EnclosingMethod, Exceptions, Deprecated, SourceFile, LineNumberTable, RuntimeVisibleAnnotations, AnnotationDefault

# ---- DCloud uni-app x 运行时（app-runtime / uts-runtime / uniappxv 渲染引擎）----
-keep class io.dcloud.** { *; }
-dontwarn io.dcloud.**

# ---- UTS 模块：buildConfigField 字符串类名反射注册（不可静态分析，必须保留）----
-keep class uts.sdk.modules.** { *; }
-dontwarn uts.sdk.modules.**

# ---- 业务原生桥（ESP 配网等 UTS 插件生成的 Kotlin）----
-keep class com.nuwax.** { *; }
-dontwarn com.nuwax.**

# ---- appid 包：HX/构建期生成的 UniAppConfig / IndexKt 引导类（vapor 反射查找）----
-keep class uni.** { *; }
-dontwarn uni.**

# ---- JNI 桥（cmark NativeBridge：System.loadLibrary + external fun md2json）----
-keepclasseswithmembernames class * {
    native <methods>;
}

# ---- kotlinx.serialization（反射访问序列化器）----
-keepclassmembers class **$$serializer { *; }
-keepclassmembers class * {
    *** companion;
}
-keep @kotlinx.serialization.Serializable class ** {
    <init>();
    *** INSTANCE;
    kotlinx.serialization.KSerializer serializer(...);
}
-dontwarn kotlinx.serialization.**

# ---- Kotlin 反射（运行时直接依赖，反射读写成员）----
-keep class kotlin.reflect.** { *; }
-dontwarn kotlin.reflect.**

# ---- fastjson（反射序列化，DCloud/部分 SDK 在用）----
-keep class com.alibaba.fastjson.** { *; }
-dontwarn com.alibaba.fastjson.**

# ---- 通用：枚举 / Parcelable / R 文件引用 ----
-keepclassmembers enum * {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
-keepclassmembers class * implements android.os.Parcelable {
    public static final android.os.Parcelable$Creator CREATOR;
}
-keepclassmembers class **.R$* { <fields>; }
