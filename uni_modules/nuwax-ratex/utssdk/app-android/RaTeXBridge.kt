// RaTeXBridge.kt — RaTeX → Bitmap → WebP base64 桥（供 UTS 调用）。
//
// 封装 RaTeXEngine.parseBlocking + RaTeXRenderer.draw + Bitmap 编码，使 UTS 侧无需
// 直接处理 Typeface / Canvas / DisplayList / 颜色解析等 Android 图形细节。
//
// 返回编码字符串，规避 UTS ↔ Kotlin 跨边界 data class 类型问题：
//   成功："data:image/webp;base64,<b64>|<w>|<h>"
//   失败："ERR:<message>"
//
// UTS 侧（utssdk/app-android/index.uts）按此约定解析。

package io.ratex

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.util.Base64
import java.io.ByteArrayOutputStream
import kotlin.math.ceil

object RaTeXBridge {

    /** 位图最长边像素上限：等比 clamp，防超宽/病态公式产生超大位图 → OOM。 */
    private const val MAX_DIM = 1600

    /**
     * 把一条 LaTeX 渲染成 WebP dataURL（同步，须在工作线程调用）。
     *
     * @param tex         原始 LaTeX（不含 $ / $$ 定界符）
     * @param displayMode true=块级（display style），false=行内（text style）
     * @param fontSizePx  字号 px（作用于公式根；KaTeX 内部 em 相对缩放）
     * @param colorHex    颜色 "#RRGGBB" / "#AARRGGBB"；非法回退黑
     * @param context     Android Context（用于加载 assets 字体）
     * @return 编码结果串（见文件头约定）
     */
    @JvmStatic
    fun renderToWebpDataUrl(
        tex: String,
        displayMode: Boolean,
        fontSizePx: Float,
        colorHex: String,
        context: Context,
    ): String {
        try {
            // ---- 字体：先试 assets/fonts（标准 Android library assets），空则试 uni-app x static 镜像路径 ----
            if (RaTeXFontLoader.ensureLoaded(context, "fonts") == 0) {
                RaTeXFontLoader.loadFromAssets(
                    context,
                    "apps/__UNI__8BF05E4/www/uni_modules/nuwax-ratex/static/fonts"
                )
            }

            // ---- 颜色 ----
            val colorInt: Int = try {
                Color.parseColor(colorHex)
            } catch (_: Exception) {
                Color.BLACK
            }

            // ---- 解析 + 排版（Rust，~1ms）----
            val dl = RaTeXEngine.parseBlocking(tex, displayMode, colorInt)

            // ---- 渲染到 Bitmap（原生 Canvas，矢量字形）----
            // 乘以 DPI density 生成高分辨率位图，避免高清屏放大模糊
            val density = context.resources.displayMetrics.density
            val renderFontSize = fontSizePx * density
            val renderer = RaTeXRenderer(dl, renderFontSize) { fontId ->
                RaTeXFontLoader.getTypeface(fontId)
            }
            var w = ceil(renderer.widthPx.toDouble()).toInt()
            var h = ceil(renderer.totalHeightPx.toDouble()).toInt()
            if (w < 1) w = 1
            if (h < 1) h = 1
            // 等比 clamp 到最长边 MAX_DIM，限制单张位图内存
            if (w > MAX_DIM) { h = h * MAX_DIM / w; w = MAX_DIM }
            if (h > MAX_DIM) { w = w * MAX_DIM / h; h = MAX_DIM }

            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            val canvas = Canvas(bmp)
            renderer.draw(canvas)

            // ---- 编码 WebP base64 ----
            val baos = ByteArrayOutputStream()
            bmp.compress(Bitmap.CompressFormat.WEBP, 92, baos)
            bmp.recycle()
            val b64 = Base64.encodeToString(baos.toByteArray(), Base64.NO_WRAP)
            baos.close()

            // 返回逻辑像素尺寸（除以 density），前端 image 按此尺寸显示
            val logicalW = (w / density).toInt()
            val logicalH = (h / density).toInt()
            return "data:image/webp;base64," + b64 + "|" + logicalW + "|" + logicalH
        } catch (e: Exception) {
            return "ERR:" + (e.message ?: "unknown")
        }
    }
}
