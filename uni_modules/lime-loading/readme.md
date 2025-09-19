# lime-loading 加载动画

一个功能丰富的加载动画组件，提供多种加载效果，支持自定义颜色、大小和文本，适用于各种加载场景。

> 插件依赖：`lime-shared`、`lime-style`

## 文档链接
📚 组件详细文档请访问以下站点：
- [加载动画文档 - 站点1](https://limex.qcoon.cn/components/loading.html)
- [加载动画文档 - 站点2](https://limeui.netlify.app/components/loading.html)
- [加载动画文档 - 站点3](https://limeui.familyzone.top/components/loading.html)

## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-loading`
2. 导入后可能需要重新编译项目
3. 在页面中使用`l-loading`组件

## 代码演示

### 基础使用
最简单的加载动画使用方式。

```html
<l-loading></l-loading>
```

### 不同类型
通过 `type` 属性可以设置加载图标的类型，默认为 `circular`，可选值为 `spinner`。nvue只有`circular`，因为其使用的是原生组件。


```html
<l-loading type="circular"></l-loading>
<l-loading type="spinner"></l-loading>
```

### 自定义颜色和大小
可以通过`color`和`size`属性自定义加载动画的颜色和大小。

```html
<l-loading color="#1677ff" size="40"></l-loading>
```

### 带文本的加载动画
通过设置`text`属性可以在加载动画下方显示文本。

```html
<l-loading text="加载中..."></l-loading>
```

### 垂直排列
通过`vertical`属性可以设置加载动画和文本的排列方式。

```html
<l-loading text="加载中..." vertical></l-loading>
```

### 自定义文本样式
可以通过`textSize`和`textColor`属性自定义文本的大小和颜色。

```html
<l-loading text="加载中..." text-size="16" text-color="#1677ff"></l-loading>
```

## Vue2使用说明
main.js中添加以下代码：
```js
// vue2项目中使用
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```

详细配置请参考官方文档：[Vue Composition API](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)

## 插件标签说明
`l-loading` 为组件标签   
`lime-loading` 为演示标签

## API文档

### Props 属性说明

| 参数       | 说明                          | 类型               | 默认值     |
| ---------- | ----------------------------- | ------------------ | ---------- |
| color      | 颜色                          | _string_           | ``  |
| type       | 类型，可选值为 `spinner`      | _string_           | `circular` |
| size       | 加载图标大小，默认单位为 `px`,uvue只支持string | _number \| string_ | `40rpx`     |
| text       | 加载文本 |  _string_ | `-`     |
| textColor       | 文本颜色 |  _string_ | `-`     |
| textSize       | 文本大小 `px`,uvue只支持string | _number \| string_ | `-`     |
| vertical   | 是否垂直排列图标和文字内容    | _boolean_          | `false`    |
| mode   | 动画实现的模式.只针对APP,可选值有：`animate`    | _string_          | `raf`    |

## 主题定制

组件提供了丰富的CSS变量，可以通过自定义CSS变量来自定义组件样式：

| 变量名 | 默认值 | 说明 |
| ---- | ---- | ---- |
| --l-loading-color | #1677ff | 加载动画颜色 |
| --l-loading-size | 20px | 加载动画大小 |
| --l-loading-text-color | `$text-color-3` | 文本颜色 |
| --l-loading-text-size | `$font-size`| 文本大小 |

由于`uniappx app`是基于canvas故暂时`uniappx app`无效


## 支持与赞赏

如果你觉得本插件解决了你的问题，可以考虑支持作者：

| 支付宝赞助 | 微信赞助 |
|------------|------------|
| ![支付宝赞赏码](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![微信赞赏码](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |