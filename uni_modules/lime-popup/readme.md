# lime-popup 弹出层
弹出层容器，用于展示弹窗、信息提示等内容，支持多种弹出位置和动画效果，兼容uniapp/uniappx。

> 插件依赖：`lime-style`、`lime-shared`、`lime-overlay`、`lime-transition`、`lime-icon`。
> 注意：`lime-svg`为收费插件，若不需要svg功能可删除依赖。

## 文档链接
📚 组件详细文档请访问以下站点：
- [弹出层文档 - 站点1](https://limex.qcoon.cn/components/popup.html)
- [弹出层文档 - 站点2](https://limeui.netlify.app/components/popup.html)
- [弹出层文档 - 站点3](https://limeui.familyzone.top/components/popup.html)

## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-popup`
2. 导入后可能需要重新编译项目
3. 在页面中使用`l-popup`组件（组件）或`lime-popup`（演示）
::: tip 注意🔔 
本插件依赖的[【lime-svg】](https://ext.dcloud.net.cn/plugin?id=18519)是原生插件，如果购买(收费为6元)则需要自定义基座，才能使用，
若不需要删除即可
:::



## 代码演示
### 基础用法

通过 `v-model` 控制弹出层是否展示。

```html
<button @click="show = true">展示弹出层</button>
<l-popup v-model="show">
	<view style="padding: 100px;"></view>
</l-popup>
```

```js
 const show = ref(false);
```


### 弹出位置

通过 `position` 属性设置弹窗的弹出位置，默认为居中弹出，可以设置为 `top`、`bottom`、`left`、`right`、`center`。

- 当弹窗从顶部或底部弹出时，默认宽度与屏幕宽度保持一致，弹窗高度取决于内容的高度。
- 当弹窗从左侧或右侧弹出时，默认不设置宽度和高度，弹窗的宽高取决于内容的宽高。

```html
<!-- 顶部弹出 -->
<l-popup v-model"showTop" position="top">
	<view style="padding: 100px;"></view>
</l-popup>
<!-- 左边弹出 -->
<l-popup v-model"showTop" position="left">
	<view style="padding: 100px;"></view>
</l-popup>
<!-- 底部弹出 -->
<l-popup v-model"showTop" position="bottom">
	<view style="padding: 100px;"></view>
</l-popup>
<!-- 右边弹出 -->
<l-popup v-model"showTop" position="right">
	<view style="padding: 100px;"></view>
</l-popup>
```

### 关闭图标

设置 `closeable` 属性后，会在弹出层的右上角显示关闭图标，并且可以通过 `close-icon` 属性自定义图标。

```html
<l-popup v-model"showTop" :closeable="true">
	<view style="padding: 100px;"></view>
</l-popup>
```



### 监听点击事件

Popup 支持以下点击事件：

- `click-overlay`: 点击遮罩层时触发。
- `click-close`: 点击关闭图标时触发。

```html
<button @click="show = true">展示弹出层</button>
<l-popup
  v-model"show"
  position="bottom"
  :closeable="true"
  @click-overlay="onClickOverlay"
  @click-close="onClickClose"
/>
```

```js
const onClickOverlay = () => {
    console.log('click-overlay');
};
const onClickClose = () => {
    console.log('click-close');
};
```

### 监听显示事件

当 Popup 被打开或关闭时，会触发以下事件：

- `open`: 打开弹出层时立即触发。
- `opened`: 打开弹出层且动画结束后触发。
- `close`: 关闭弹出层时立即触发。
- `closed`: 关闭弹出层且动画结束后触发。

```html
<button @click="show = true">展示弹出层</button>
<l-popup
  v-model="show"
  position="bottom"
  @open="handlePopupOpen"
  @opened="handlePopupOpened("
  @close="handlePopupClose"
  @closed="handlePopupClosed"
/>
```

```js
const show = ref(false);
 const handlePopupOpen = () => {
    // 处理弹出框打开前的逻辑
}
 const handlePopupOpened = () => {
    // 处理弹出框打开后的逻辑
}
 const handlePopupClose = () => {
    // 处理弹出框关闭前的逻辑
}
const  handlePopupClosed = () => {
    // 处理弹出框关闭后的逻辑
}
```


## 快速预览
导入插件后，可以直接使用以下标签查看演示效果：

```html
<!-- 代码位于 uni_modules/lime-popup/components/lime-popup -->
<lime-popup />
```

## 插件标签说明
- `l-popup`: 组件标签，用于实际开发中
- `lime-popup`: 演示标签，用于查看示例效果

## Vue2使用说明
本插件使用了`composition-api`，如需在Vue2项目中使用，请按照[官方教程](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)配置。

关键配置代码（在main.js中添加）：
```js
// vue2
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```

## API文档

### Props

| 参数 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| v-model | 是否显示弹出层 | _boolean_ | `false` |
| visible | 是否显示弹出层 | _boolean_ | `false` |
| overlay | 是否显示遮罩层 | _boolean_ | `true` |
| position | 弹出位置，可选值为 `top` `bottom` `right` `left` | _string_ | `center` |
| position | 弹出层内容区的动画名 | _string_ | `` |
| transitionName | 动画时长，单位毫秒，设置为 0 可以禁用动画 | _number_ | `300` |
| z-index | 将弹窗的 z-index 层级设置为一个固定值 | _number_ | `999` |
| preventScrollThrough | 是否锁定背景滚动 | _boolean_ | `true` |
| closeOnClickOverlay | 是否在点击遮罩层后关闭 | _boolean_ | `true` |
| safeAreaInsetBottom | 适配底部安全区域 | _boolean_ | `true` |
| safeAreaInsetTop | 适配顶部安全区域 | _boolean_ | `true` |
| destroyOnClose | 关闭后是否销毁 | _boolean_ | `false` |
| closeable | 是否显示关闭图标 | _boolean_ | `false` |
| closeIcon | 关闭图标名称或图片链接，等同于 Icon 组件的 [name 属性](https://ext.dcloud.net.cn/plugin?id=14057) | _string_ | `cross` |
| bgColor | 背景色 | _string_ | `-` |
| iconColor | 图标色 | _string_ | `-` |
| lStyle | 自定义样式 | _string\|object_ | `-` |
| overlayStyle | 遮罩层自定义样式 | _string\|object_ | `-` |
| radius | 圆角，可以是字符，数值，数组 | _string\|number\|Array\<string\|number\>_ | `-` |

### Events

| 事件名           | 说明                       | 回调参数            |
| ---------------- | -------------------------- | ------------------- |
| click-overlay    | 点击遮罩层时触发           | - |
| click-close | 点击关闭图标时触发         | - |
| open             | 打开弹出层时立即触发       | -                   |
| close            | 关闭弹出层时立即触发       | -                   |
| opened           | 打开弹出层且动画结束后触发 | -                   |
| closed           | 关闭弹出层且动画结束后触发 | -                   |

### Slots

| 名称            | 说明         |
| --------------- | ------------ |
| default         | 弹窗内容     |
| close-btn | 关闭按钮 |



## 主题定制

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称                           | 默认值                               | 描述 |
| ------------------------------ | ------------------------------------ | ---- |
| `--l-popup-bg-color`              | _#fff_            | 弹出层背景颜色    |
| `--l-popup-close-icon-color`      | _rgba(0,0,0,0.6)_            | 关闭图标颜色    |
| `--l-popup-border-radius`        | _$border-radius_            | 弹出层边框圆角    |
| `--l-overlay-bg-color` | `rgba(0, 0, 0, 0.6)` | 遮罩层的背景颜色和透明度 |
| `--l-overlay-blur` | `4px` | 遮罩层的模糊效果程度 |

## 支持与赞赏

如果你觉得本插件解决了你的问题，可以考虑支持作者：
| 支付宝赞助 | 微信赞助 |
|------------|------------|
| ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |