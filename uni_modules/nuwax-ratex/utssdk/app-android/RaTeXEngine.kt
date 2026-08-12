// RaTeXEngine.kt — Kotlin JNI wrapper around libratex_ffi.so
//
// 用 Android 内置 org.json 解析 Rust 返回的 DisplayList JSON（不依赖 kotlinx.serialization
// / kotlinx.coroutines，规避 UTS 标准基座编译期 Maven 依赖解析失败）。仅保留 parseBlocking
// （UTS 侧调用），suspend 版 parse 已移除（不再依赖 coroutines）。

package io.ratex

import android.graphics.Color
import org.json.JSONObject
import org.json.JSONArray

class RaTeXException(message: String) : Exception(message)

object RaTeXEngine {

    init {
        System.loadLibrary("ratex_ffi")
    }

    // -------------------------------------------------------------------------
    // JNI declarations (implemented in crates/ratex-ffi/src/jni.rs)
    // -------------------------------------------------------------------------

    @JvmStatic
    private external fun nativeParseAndLayout(
        latex: String,
        displayMode: Boolean,
        color: FloatArray,
    ): String?

    @JvmStatic
    private external fun nativeGetLastError(): String?

    // -------------------------------------------------------------------------
    // Public API
    // -------------------------------------------------------------------------

    /**
     * 解析 [latex] 并返回 [DisplayList]（用 org.json 解析 native 返回的 JSON）。
     * 同步阻塞，可在任意线程调用（UTS 侧经 executor 在后台线程调）。
     */
    fun parseBlocking(
        latex: String,
        displayMode: Boolean = true,
        color: Int = Color.BLACK,
    ): DisplayList {
        val json = nativeParseAndLayout(
            latex = latex,
            displayMode = displayMode,
            color = rgbaFloatArray(color),
        ) ?: throw RaTeXException(nativeGetLastError() ?: "unknown error")
        return try {
            parseDisplayListJson(json)
        } catch (e: Exception) {
            throw RaTeXException("JSON decode failed: ${e.message}")
        }
    }

    private fun rgbaFloatArray(color: Int): FloatArray = floatArrayOf(
        ((color ushr 16) and 0xff) / 255f,
        ((color ushr 8) and 0xff) / 255f,
        (color and 0xff) / 255f,
        ((color ushr 24) and 0xff) / 255f,
    )

    // -------------------------------------------------------------------------
    // DisplayList JSON 解析（org.json，字段名对齐 Rust serde 约定）
    // -------------------------------------------------------------------------

    private fun parseDisplayListJson(json: String): DisplayList {
        val o = JSONObject(json)
        val arr = o.getJSONArray("items")
        val items = ArrayList<DisplayItem>()
        for (i in 0 until arr.length()) {
            items.add(parseItem(arr.getJSONObject(i)))
        }
        return DisplayList(
            o.getDouble("width"),
            o.getDouble("height"),
            o.getDouble("depth"),
            items,
        )
    }

    private fun parseItem(o: JSONObject): DisplayItem {
        val type = o.getString("type")
        return when (type) {
            "GlyphPath" -> DisplayItem.GlyphPath(
                o.getDouble("x"), o.getDouble("y"), o.getDouble("scale"),
                o.getString("font"), o.getInt("char_code"),
                parseCommands(o.optJSONArray("commands")),
                parseColor(o.getJSONObject("color")),
            )
            "Line" -> DisplayItem.Line(
                o.getDouble("x"), o.getDouble("y"), o.getDouble("width"),
                o.getDouble("thickness"), parseColor(o.getJSONObject("color")),
                o.optBoolean("dashed", false),
            )
            "Rect" -> DisplayItem.Rect(
                o.getDouble("x"), o.getDouble("y"), o.getDouble("width"),
                o.getDouble("height"), parseColor(o.getJSONObject("color")),
            )
            "Path" -> DisplayItem.Path(
                o.getDouble("x"), o.getDouble("y"),
                parseCommands(o.getJSONArray("commands")),
                o.getBoolean("fill"), parseColor(o.getJSONObject("color")),
            )
            else -> DisplayItem.Rect(0.0, 0.0, 0.0, 0.0, RaTeXColor.Black)
        }
    }

    private fun parseColor(o: JSONObject): RaTeXColor = RaTeXColor(
        o.getDouble("r").toFloat(), o.getDouble("g").toFloat(),
        o.getDouble("b").toFloat(), o.getDouble("a").toFloat(),
    )

    private fun parseCommands(arr: JSONArray?): List<PathCommand> {
        if (arr == null) return emptyList()
        val list = ArrayList<PathCommand>()
        for (i in 0 until arr.length()) {
            val c = arr.getJSONObject(i)
            when (c.getString("type")) {
                "MoveTo" -> list.add(PathCommand.MoveTo(c.getDouble("x"), c.getDouble("y")))
                "LineTo" -> list.add(PathCommand.LineTo(c.getDouble("x"), c.getDouble("y")))
                "CubicTo" -> list.add(PathCommand.CubicTo(
                    c.getDouble("x1"), c.getDouble("y1"),
                    c.getDouble("x2"), c.getDouble("y2"),
                    c.getDouble("x"), c.getDouble("y")))
                "QuadTo" -> list.add(PathCommand.QuadTo(
                    c.getDouble("x1"), c.getDouble("y1"),
                    c.getDouble("x"), c.getDouble("y")))
                "Close" -> list.add(PathCommand.Close)
            }
        }
        return list
    }
}
