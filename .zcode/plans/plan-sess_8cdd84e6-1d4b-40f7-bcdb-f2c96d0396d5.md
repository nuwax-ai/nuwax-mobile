# 用 RaTeX 全平台统一替换 KaTeX —— 实施计划(Android 先行)

## 目标与策略

新建**独立插件 `uni_modules/nuwax-ratex/`**,做一套全平台统一的 LaTeX 渲染能力:App 端用 RaTeX 原生 `.so`+Canvas,H5/微信小程序用 RaTeX WASM+Canvas 2D。渲染管线两端一致(都是 DisplayList→Canvas 绘制),最终**彻底替换现有 KaTeX 体系**(App 的 `nuwax-katex` WebView + H5/小程序的 `katex-el`)。

**本次落地范围 = Android 原生后端 + 压测页验证性能 + H5 WASM 可行性验证**。iOS、小程序全量接入、生产链路切换列为后续(性能验证通过后再推进)。

> 关键前提已核实:RaTeX 输入是 LaTeX(零迁移),1075 公式成功率 99.91%,AI 场景 38/38 全过;`ratex-wasm` 存在且 platforms/web 是 "WASM+Canvas 2D" 成熟封装;Android 封装(`RaTeXEngine`/`RaTeXRenderer`/`RaTeXView`)现成可用。

---

## 总体架构:`uni_modules/nuwax-ratex/`(全平台统一接口)

```
uni_modules/nuwax-ratex/
  package.json                              # dcloudext.type = "component-uts"
  utssdk/
    interface.uts                            # 统一契约类型
    app-android/
      config.json                            # dependencies + minSdk
      libs/<abi>/libratex_ffi.so             # 3 ABI(arm64-v8a/armeabi-v7a/x86_64)
      io/ratex/*.kt                          # 从 RaTeX 搬: RaTeXEngine/DisplayList/RaTeXRenderer/RaTeXFontLoader/RaTeXColor
      index.uts                              # 导出 renderRatexAsync(tex,opts,cb) → 位图 base64
    app-ios/index.uts                        # 占位(后续)
    web/
      index.uts                              # H5: 调 ratex-wasm renderLatex
    mp-weixin/index.uts                      # 占位(后续 WASM)
  components/
    ratex-view/ratex-view.uvue               # 统一组件,对齐 nuwax-katex 的 props
  static/fonts/KaTeX_*.ttf                   # 19 字体(供 H5/小程序 WASM 用)
  static/wasm/                               # wasm-pack 产物(.wasm + .js glue)
```

**统一 UTS 接口**(各平台实现不同,签名一致):
```ts
renderLatex(tex: string, opts: RatexOptions): RatexResult
// RatexOptions = { displayMode?, fontSize?, color? }
// RatexResult  = { imageDataURL: string, width: number, height: number, errMsg: string }
// App: Rust→DisplayList→Canvas→Bitmap→base64；H5: WASM→Canvas2D→dataURL
```

---

## 本次实施(6 步)

### Step 0｜前置:编译产物(只缺 cargo-ndk)
- `cargo install cargo-ndk`(NDK 26+、4 个 rust android targets 已就绪,仅缺此)
- `cd /Users/soddy/Documents/git-workspace/RaTeX && bash platforms/android/build-android.sh` → 产出 `platforms/android/src/main/jniLibs/{arm64-v8a,armeabi-v7a,x86_64}/libratex_ffi.so`
- `cargo install wasm-pack` + `wasm-pack build crates/ratex-wasm --target web` → 验证 WASM 可构建(为 H5 路线探路)
- 前置验证:跑 `render-svg` 抽样确认 .so 在 Android target 下逻辑正常(已用 host target 验证过覆盖率)

### Step 1｜插件骨架 + Android 后端
- 建 `uni_modules/nuwax-ratex/`,照搬 `uni-cmark` 的 `config.json` + `package.json` 范式(`dcloudext.type:"component-uts"`)
- `utssdk/app-android/config.json`:`{ minSdkVersion:21, dependencies:[androidx.annotation:annotation:1.7.1, org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.3, org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3] }`
- 复制 RaTeX 产物进插件:`libs/<abi>/libratex_ffi.so`(3 ABI)+ `io/ratex/` 下 5 个 .kt(**必须保留 `package io.ratex`,JNI 符号 `Java_io_ratex_RaTeXEngine_*` 硬绑定**)+ 19 个 `KaTeX_*.ttf` 进 `assets/fonts/`
- `utssdk/app-android/index.uts`:导出 `renderRatexAsync(tex, displayMode, fontSize, color, cb)`。核心实现(单线程 executor 串行,避免并发压 Rust):
  - `RaTeXEngine.parseBlocking(tex, displayMode, colorInt)` → `DisplayList`
  - `RaTeXRenderer(displayList, fontSizePx, RaTeXFontLoader::getTypeface).draw(canvas)` 画到 `Bitmap.createBitmap(w,h,ARGB_8888)`
  - `Bitmap.compress(WEBP,92,baos)` → base64 → `cb({ imageDataURL, width, height })`;失败 `cb({ errMsg })`
  - `.so` 加载失败的兜底日志(照搬 uni-cmark 的 `logMd2jsonLoadErrorOnce`,提示"需自定义基座")
  - **color 边界**:UTS 收 `#RRGGBB` 字符串 → 解析为 ARGB int 喂 `parseBlocking`

### Step 2｜`<ratex-view>` 统一组件
- `components/ratex-view/ratex-view.uvue`,props **对齐 nuwax-katex** 便于后续直接替换:`tex: string`、`displayMode?: boolean`、`fontSize?/color?`;emit `load({width,height})`/`error`
- 模板:`<image :src="imageDataURL" :style="sizeStyle" mode="aspectFit"/>`,内部 watch `tex` → 调 `renderRatexAsync` → 更新 `imageDataURL` + 尺寸
- 行内/块级:块级居中 + 外层 scroll-view 横滚(对齐 uni-ai-x-msg 的 `.msg-root-math-scroll`);行内 flex 嵌入
- 流式友好:`tex` 变化即重渲(Rust parseBlocking <1ms,远快于 WebView 启动)

### Step 3｜H5 WASM 后端(验证"彻底替换 KaTeX"可行性)
- `utssdk/web/index.uts`:`renderLatex` 内部 `import` wasm 产物,调 `renderLatex(tex, opts)`(ratex-wasm 导出)
- 把 `wasm-pack` 产出的 `.wasm`+glue 放 `static/wasm/`,字体放 `static/fonts/`(WASM Canvas 2D 需要 @font-face 加载 KaTeX 字体)
- **验证点**:H5 能否正常加载 WASM + 字体并渲染(若可行,则"H5 用 RaTeX WASM 替代 katex-el"成立;小程序 WASM 限制更多,列为后续单独验证)

### Step 4｜压测页 `pages/test-ratex-perf/`(模拟大量 agent chat + 大量公式)
- 注册 `pages.json` + `index.uvue` 加测试入口按钮(仿现有 `∑` 按钮)
- **三模式**(照搬 test-nuwax-katex 骨架,升级为对话模拟):
  1. **对话压测模式**(核心):复用 `mockStreamPerf.uts` 的 `buildMockMessageList(H轮)` + `FORMULA_SAMPLE`(富公式正文)+ `startMockStream`(流式逐字)。用 `<nuwax-virtual-list>` 渲染多轮 user/assistant 交替消息,assistant 正文含密集公式(矩阵/align/cases/mhchem/积分)。每条 assistant 消息挂 `<ai-msg>` 走真实 markdown→math 解析链路。**对比开关**:后端在 nuwax-ratex(RaTeX)与 nuwax-katex(WebView)间切换,同一批数据跑两遍
  2. **纯公式压力模式**:3000 条公式虚拟滚动(复用 `STRESS_POOL` ~80 模板),统计 loaded/error/anomaly/min-max 尺寸
  3. **样本模式**:分组展示 + 单公式尺寸实测
- **统计指标**:首帧延迟(从 setData 到 load 的耗时)、总渲染数、错误数、异常率(w/h 缺失或越界)、滚动 FPS(打点)、峰值公式数。RaTeX vs WebView 并排数值对比
- 公式数据池:合并 `STRESS_POOL` + `FORMULA_SAMPLE` + 本次验证用的 38 个 AI 场景公式,确保覆盖矩阵/align/cases/mhchem/嵌套分数等高难度类型

### Step 5｜验证与判定
- 用 HBuilderX CLI(`pnpm hx:android:custom` 自定义基座)在 Android 真机/模拟器跑压测页
- 判定标准(达标才推进后续):RaTeX 首帧延迟 < WebView 的 50%、3000 公式无 OOM、流式逐字无卡顿、错误率 <1%
- 产出对比报告(数值 + 截图)

---

## 后续路线(本次不做,验证通过后)
1. **生产链路切换**:`uni-ai-x-msg.uvue` 4 处行内分支(L64/L101/L138/L207)+ 块级分支(L195),把 `<nuwax-katex>`/`<katex-el>` 换成 `<ratex-view>`;H5 分支切 WASM
2. **iOS 接入**:`build-ios.sh` 产 `RaTeX.xcframework` + Swift 桥(对照 nuwax-uni-math 的 MathViewBridge),接 `utssdk/app-ios/`
3. **微信小程序 WASM**:单独验证小程序 WASM 加载限制,接 `utssdk/mp-weixin/`
4. **KaTeX 彻底移除**:nuwax-katex、katex-el、proxy-web katexRender 链路、mathjax-tex-svg.js 全部下线

---

## 风险与注意
- **需自定义基座调试**(含 .so,标准基座加载不到;项目已有 nuwax-esp 等原生插件的自定义基座流程可复用)
- **RaTeX 仅 3 个 ABI**(无 x86 32 位),32 位 Intel 模拟器跑不了,用 arm64 真机或 x86_64 模拟器
- **字体路径**:RaTeXFontLoader 硬编码读 `assets/fonts/`,需实测 uni-app x 打包时插件 `assets/` 是否落到 APK 的 `assets/fonts/`(若否,改 RaTeXFontLoader 默认 assetPath)
- **RaTeX 0.1.x**:复杂公式(交换图等边缘场景)覆盖率有限,但 AI 高频公式已验证 100%;接入后保留 KaTeX 兜底能力一个版本
- **WASM 体积**:`.wasm`+字体可能 1-2MB,H5 首次加载需评估(可用 embed-fonts 把字体内嵌 .wasm,或懒加载字体)