# lime-color 颜色工具
一个功能丰富的颜色处理工具，提供颜色转换、操作和生成等多种功能。支持多种颜色格式（HEX、RGB、HSL、HSV等），可用于颜色选择器、主题定制、颜色计算等多种场景。

## 文档链接
📚 组件详细文档请访问以下站点：
- [颜色工具文档 - 站点1](https://limex.qcoon.cn/uts/color.html)
- [颜色工具文档 - 站点2](https://limeui.netlify.app/uts/color.html)
- [颜色工具文档 - 站点3](https://limeui.familyzone.top/uts/color.html)

## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-color`
2. 导入后可能需要重新编译项目

## 代码演示

### 基础用法
最简单的颜色工具用法，直接导入并使用。

```ts
import {tinyColor} from '@/uni_modules/lime-color'
```

### 颜色解析
tinyColor 接受多种类型的输入，包括字符串、数字、对象等。

```ts
// Hex, 8-digit (RGBA) Hex
tinyColor('#000');
tinyColor('000');
tinyColor('#369C');
tinyColor('369C');
tinyColor('#f0f0f6');
tinyColor('f0f0f6');
tinyColor('#f0f0f688');
tinyColor('f0f0f688');

// RGB, RGBA
tinyColor('rgb (255, 0, 0)');
tinyColor('rgb 255 0 0');
tinyColor('rgba (255, 0, 0, .5)');
tinyColor({ r: 255, g: 0, b: 0 });

// HSL, HSLA
tinyColor('hsl(0, 100%, 50%)');
tinyColor('hsla(0, 100%, 50%, .5)');
tinyColor('hsl(0, 100%, 50%)');
tinyColor('hsl 0 1.0 0.5');
tinyColor({ h: 0, s: 1, l: 0.5 });

// HSV, HSVA
tinyColor('hsv(0, 100%, 100%)');
tinyColor('hsva(0, 100%, 100%, .5)');
tinyColor('hsv (0 100% 100%)');
tinyColor('hsv 0 1 1');
tinyColor({ h: 0, s: 100, v: 100 });

// 颜色名称
tinyColor('RED');
tinyColor('blanchedalmond');
tinyColor('darkblue');

// 数字
tinyColor(0x0);
tinyColor(0xaabbcc);
```

### 颜色转换
将颜色转换为不同的格式。

```ts
const color = tinyColor('red');

// 转换为 HSV
color.toHsv(); // { h: 0, s: 1, v: 1, a: 1 }
color.toHsvString(); // "hsv(0, 100%, 100%)"

// 转换为 HSL
color.toHsl(); // { h: 0, s: 1, l: 0.5, a: 1 }
color.toHslString(); // "hsl(0, 100%, 50%)"

// 转换为 Hex
color.toHex(); // "ff0000"
color.toHexString(); // "#ff0000"
color.toHex8(); // "ff0000ff"
color.toHex8String(); // "#ff0000ff"

// 转换为 RGB
color.toRgb(); // { r: 255, g: 0, b: 0, a: 1 }
color.toRgbString(); // "rgb(255, 0, 0)"

// 转换为百分比 RGB
color.toPercentageRgb(); // { r: "100%", g: "0%", b: "0%", a: 1 }
color.toPercentageRgbString(); // "rgb(100%, 0%, 0%)"

// 转换为颜色名称
color.toName(); // "red"
```

### 颜色修改
修改颜色的亮度、饱和度、色相等属性。

```ts
const color = tinyColor('red');

// 调亮颜色
color.lighten().toString(); // "#ff3333"
color.lighten(100).toString(); // "#ffffff"

// 提高亮度
color.brighten().toString(); // "#ff1919"

// 调暗颜色
color.darken().toString(); // "#cc0000"
color.darken(100).toString(); // "#000000"

// 添加白色
color.tint().toString(); // "#ff1a1a"
color.tint(100).toString(); // "#ffffff"

// 添加黑色
color.shade().toString(); // "#e60000"
color.shade(100).toString(); // "#000000"

// 降低饱和度
color.desaturate().toString(); // "#f20d0d"
color.desaturate(100).toString(); // "#808080"

// 提高饱和度
tinyColor('hsl(0, 10%, 50%)').saturate().toString(); // "hsl(0, 20%, 50%)"

// 转为灰度
color.greyscale().toString(); // "#808080"

// 旋转色相
color.spin(180).toString(); // "#00ffff"
color.spin(-90).toString(); // "#7f00ff"
color.spin(90).toString(); // "#80ff00"

// 混合颜色
let color1 = tinyColor('#f0f');
let color2 = tinyColor('#0f0');
color1.mix(color2).toHexString(); // #808080
```

### 颜色组合
生成一组相关的颜色。

```ts
// 生成相似颜色
const analogousColors = tinyColor('#f00').analogous();
analogousColors.map(t => t.toHexString()); 
// [ "#ff0000", "#ff0066", "#ff0033", "#ff0000", "#ff3300", "#ff6600" ]

// 生成单色系列
const monochromaticColors = tinyColor('#f00').monochromatic();
monochromaticColors.map(t => t.toHexString()); 
// [ "#ff0000", "#2a0000", "#550000", "#800000", "#aa0000", "#d40000" ]

// 生成三色组合
const triadColors = tinyColor('#f00').triad();
triadColors.map(t => t.toHexString()); 
// [ "#ff0000", "#00ff00", "#0000ff" ]

// 生成四色组合
const tetradColors = tinyColor('#f00').tetrad();
tetradColors.map(t => t.toHexString()); 
// [ "#ff0000", "#80ff00", "#00ffff", "#7f00ff" ]

// 生成补色
tinyColor('#f00').complement().toHexString(); // "#00ffff"
```

### 颜色主题生成
使用 Ant Design 的颜色生成算法生成主题色系列。

```ts
import {generate, LGenerateOptions} from '@/uni_modules/lime-color'

// 生成默认主题色系列
generate('red')
// ['#2c1113', '#450f11', '#5b0e0e', '#7e0b0b', '#ad0707', '#dc0303', '#e82d27', '#f3594f', '#f88577', '#faaca0']

// 生成暗色主题色系列
generate('red', { theme: 'dark' })
```

## API文档

### 构造函数

| 方法 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| `tinyColor(color, opts)` | 创建一个 TinyColor 实例 | color: 颜色值, opts: 选项 | TinyColor 实例 |

### 属性

| 属性名 | 说明 | 类型 |
| --- | --- | --- |
| `originalInput` | 传递到构造函数中用于创建实例的原始输入 | any |
| `format` | 用于创建实例的格式 | string |
| `isValid` | 颜色是否成功被解析 | boolean |

### 颜色判断方法

| 方法 | 说明 | 返回值 |
| --- | --- | --- |
| `getBrightness()` | 返回颜色的感知亮度，范围从 0-255 | number |
| `isLight()` | 返回一个布尔值，指示颜色的感知亮度是否为浅色 | boolean |
| `isDark()` | 返回一个布尔值，指示颜色的感知亮度是否为深色 | boolean |
| `getLuminance()` | 返回颜色的感知亮度，范围从 0-1 | number |
| `isMonochrome()` | 判断当前颜色是否为单色 | boolean |

### 透明度操作

| 方法 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| `getAlpha()` | 返回颜色的透明度值，范围从 0-1 | - | number |
| `setAlpha(alpha)` | 设置颜色的透明度值 | alpha: 0-1 之间的数值 | TinyColor 实例 |
| `onBackground(background)` | 计算颜色在背景上的显示效果 | background: 背景颜色 | TinyColor 实例 |

### 颜色转换方法

| 方法 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| `toHsv()` | 转换为 HSV 对象 | - | HSVA 对象 |
| `toHsvString()` | 转换为 HSV 字符串 | - | string |
| `toHsb()` | 转换为 HSB 对象 | - | HSBA 对象 |
| `toHsbString()` | 转换为 HSB 字符串 | - | string |
| `toHsl()` | 转换为 HSL 对象 | - | HSLA 对象 |
| `toHslString()` | 转换为 HSL 字符串 | - | string |
| `toHex(allow3Char)` | 转换为十六进制字符串 | allow3Char: 是否允许3字符简写 | string |
| `toHexString(allow3Char)` | 转换为带#的十六进制字符串 | allow3Char: 是否允许3字符简写 | string |
| `toHex8(allow4Char)` | 转换为8位十六进制字符串 | allow4Char: 是否允许4字符简写 | string |
| `toHex8String(allow4Char)` | 转换为带#的8位十六进制字符串 | allow4Char: 是否允许4字符简写 | string |
| `toHexShortString(allowShortChar)` | 根据透明度返回较短的十六进制值 | allowShortChar: 是否允许简写 | string |
| `toRgb()` | 转换为 RGB 对象 | - | RGBA 对象 |
| `toRgbString()` | 转换为 RGB 字符串 | - | string |
| `toPercentageRgb()` | 转换为百分比表示的 RGB 对象 | - | RGBAString 对象 |
| `toPercentageRgbString()` | 转换为百分比表示的 RGB 字符串 | - | string |
| `toName()` | 转换为颜色名称 | - | string 或 null |
| `toNumber()` | 转换为数字 | - | number |
| `toString(format)` | 根据指定格式转换为字符串 | format: 格式名称 | string |

### 颜色修改方法

| 方法 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| `lighten(amount)` | 调亮颜色 | amount: 0-100 之间的数值 | TinyColor 实例 |
| `brighten(amount)` | 提高亮度 | amount: 0-100 之间的数值 | TinyColor 实例 |
| `darken(amount)` | 调暗颜色 | amount: 0-100 之间的数值 | TinyColor 实例 |
| `tint(amount)` | 与白色混合 | amount: 0-100 之间的数值 | TinyColor 实例 |
| `shade(amount)` | 与黑色混合 | amount: 0-100 之间的数值 | TinyColor 实例 |
| `desaturate(amount)` | 降低饱和度 | amount: 0-100 之间的数值 | TinyColor 实例 |
| `saturate(amount)` | 提高饱和度 | amount: 0-100 之间的数值 | TinyColor 实例 |
| `greyscale()` | 转为灰度 | - | TinyColor 实例 |
| `spin(amount)` | 旋转色相 | amount: -360 到 360 之间的数值 | TinyColor 实例 |
| `mix(color, amount)` | 与另一种颜色混合 | color: 颜色值, amount: 0-100 之间的数值 | TinyColor 实例 |

### 颜色组合方法

| 方法 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| `analogous(results, slices)` | 生成相似颜色 | results: 结果数量, slices: 分片数量 | TinyColor[] |
| `monochromatic(results)` | 生成单色系列 | results: 结果数量 | TinyColor[] |
| `splitcomplement()` | 生成分裂补色 | - | TinyColor[] |
| `triad()` | 生成三色组合 | - | TinyColor[] |
| `tetrad()` | 生成四色组合 | - | TinyColor[] |
| `polyad(n)` | 生成 n 色组合 | n: 颜色数量 | TinyColor[] |
| `complement()` | 生成补色 | - | TinyColor 实例 |

### 其他方法

| 方法 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| `clone()` | 克隆颜色实例 | - | TinyColor 实例 |
| `equals(color)` | 判断两个颜色是否相等 | color: 颜色值 | boolean |

### 颜色主题生成

| 方法 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| `generate(color, options)` | 生成颜色主题 | color: 颜色值, options: 选项 | string[] |

## 支持与赞赏

如果你觉得本插件解决了你的问题，可以考虑支持作者：

| 支付宝赞助 | 微信赞助 |
|------------|------------|
| ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |