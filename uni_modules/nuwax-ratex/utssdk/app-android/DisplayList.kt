// DisplayList.kt — RaTeX 排版结果数据结构（纯 data class，不依赖 kotlinx.serialization）。
//
// 由 RaTeXEngine.parseBlocking 用 Android 内置 org.json 解析 Rust 返回的 JSON。
// 规避 UTS 标准基座编译期对 kotlinx Maven 依赖解析失败的问题。

package io.ratex

data class DisplayList(
    val width: Double,
    val height: Double,
    val depth: Double,
    val items: List<DisplayItem>,
)

sealed class DisplayItem {
    data class GlyphPath(
        val x: Double,
        val y: Double,
        val scale: Double,
        val font: String,
        val charCode: Int,
        val commands: List<PathCommand>,
        val color: RaTeXColor,
    ) : DisplayItem()

    data class Line(
        val x: Double,
        val y: Double,
        val width: Double,
        val thickness: Double,
        val color: RaTeXColor,
        val dashed: Boolean = false,
    ) : DisplayItem()

    data class Rect(
        val x: Double,
        val y: Double,
        val width: Double,
        val height: Double,
        val color: RaTeXColor,
    ) : DisplayItem()

    data class Path(
        val x: Double,
        val y: Double,
        val commands: List<PathCommand>,
        val fill: Boolean,
        val color: RaTeXColor,
    ) : DisplayItem()
}

sealed class PathCommand {
    data class MoveTo(val x: Double, val y: Double) : PathCommand()
    data class LineTo(val x: Double, val y: Double) : PathCommand()
    data class CubicTo(
        val x1: Double, val y1: Double,
        val x2: Double, val y2: Double,
        val x: Double, val y: Double,
    ) : PathCommand()
    data class QuadTo(
        val x1: Double, val y1: Double,
        val x: Double, val y: Double,
    ) : PathCommand()
    object Close : PathCommand()
}

data class RaTeXColor(
    val r: Float,
    val g: Float,
    val b: Float,
    val a: Float,
) {
    companion object {
        val Black = RaTeXColor(r = 0f, g = 0f, b = 0f, a = 1f)
    }

    /** 转为 Android ARGB int（供 Paint.color / Canvas 用）。 */
    fun toArgb(): Int {
        val ai = (a * 255).toInt().coerceIn(0, 255)
        val ri = (r * 255).toInt().coerceIn(0, 255)
        val gi = (g * 255).toInt().coerceIn(0, 255)
        val bi = (b * 255).toInt().coerceIn(0, 255)
        return (ai shl 24) or (ri shl 16) or (gi shl 8) or bi
    }
}
