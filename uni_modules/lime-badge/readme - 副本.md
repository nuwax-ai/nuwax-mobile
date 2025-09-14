# lime-badge 徽标
- 在右上角展示徽标数字或小红点。
- 插件依赖`lime-shared`,`lime-style`不喜勿下

## 文档
  [badge【站点1】](https://limex.qcoon.cn/components/badge.html)
  [badge【站点2】](https://limeui.netlify.app/components/badge.html)
  [badge【站点3】](https://limeui.familyzone.top/components/badge.html)




## 安装
插件市场导入即可，首次导入可能需要重新编译

## 代码演示

### 基础用法

设置 `content` 属性后，Badge 会在子元素的右上角显示对应的徽标，也可以通过 `dot` 来显示小红点。

```html
<l-badge :content="5">
  <view class="child" />
</l-badge>
<l-badge :content="10">
  <view class="child" />
</l-badge>
<l-badge content="Hot">
  <view class="child" />
</l-badge>
<l-badge dot>
  <view class="child" />
</l-badge>

<style>
  .child {
    width: 40px;
    height: 40px;
    background: #f2f3f5;
    border-radius: 4px;
  }
</style>
```

### 最大值

设置 `max` 属性后，当 `content` 的数值超过最大值时，会自动显示为 `{max}+`。

```html
<l-badge :content="20" max="9">
  <view class="child" />
</l-badge>
<l-badge :content="50" max="20">
  <view class="child" />
</l-badge>
<l-badge :content="200" max="99">
  <view class="child" />
</l-badge>
```

### 自定义颜色

通过 `color` 属性来设置徽标的颜色。

```html
<l-badge :content="5" color="#1989fa">
  <view class="child" />
</l-badge>
<l-badge :content="10" color="#1989fa">
  <view class="child" />
</l-badge>
<l-badge dot color="#1989fa">
  <view class="child" />
</l-badge>
```

### 自定义徽标内容

通过 `content` 插槽可以自定义徽标的内容，比如插入一个图标。

```html
<l-badge>
  <view class="child" />
  <template #content>
    你好
  </template>
</l-badge>

```

```css
.badge-icon {
  display: block;
  font-size: 10px;
  line-height: 16px;
}
```

### 自定义徽标位置

通过 `position` 属性来设置徽标的位置。

```html
<l-badge :content="10" position="top-left">
  <view class="child" />
</l-badge>
<l-badge :content="10" position="bottom-left">
  <view class="child" />
</l-badge>
<l-badge :content="10" position="bottom-right">
  <view class="child" />
</l-badge>
```

### 独立展示

当 Badge 没有子元素时，会作为一个独立的元素进行展示。

```html
<l-badge :content="20" />

<l-badge :content="200" max="99" />
```

### 查看示例
- 导入后直接使用这个标签查看演示效果

```html
<!-- // 代码位于 uni_modules/lime-badge/compoents/lime-badge -->
<lime-badge />
```


### 插件标签
- 默认 l-badge 为 component
- 默认 lime-badge 为 demo

### Vue2使用
- 插件使用了`composition-api`, 如果你希望在vue2中使用请按官方的教程[vue-composition-api](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)配置
- 关键代码是: 在main.js中 在vue2部分加上这一段即可
```js
// vue2
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```



## API

### Props

| 参数 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| content | 徽标内容 | _number \| string_ | - |
| color | 徽标背景颜色 | _string_ | `#ee0a24` |
| dot | 是否展示为小红点 | _boolean_ | `false` |
| max | 最大值，超过最大值会显示 `{max}+`，仅当 content 为数字时有效 | _number \| string_ | - |
| offset | 设置徽标的偏移量，数组的两项分别对应水平向右和垂直向下方向的偏移量，默认单位为 `px` | _[number \| string, number \| string]_ | - |
| show-zero | 当 content 为数字 0 或字符串 '0' 时，是否展示徽标 | _boolean_ | `true` |
| position | 徽标位置，可选值为 `top-left` `bottom-left` `bottom-right` | _string_ | `top-right` |

### Slots

| 名称    | 说明             |
| ------- | ---------------- |
| default | 徽标包裹的子元素 |
| content | 自定义徽标内容   |


## 主题定制

### 样式变量

组件提供了下列 CSS 变量，可用于自定义样式。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --l-badge-size | _16px_ | - |
| --l-badge-color | _white_ | - |
| --l-badge-padding | _0 3px_ | - |
| --l-badge-font-size | _12px_ | - |
| --l-badge-font-weight | _bold)_ | - |
| --l-badge-border-width | _1px_ | - |
| --l-badge-background | _#F53F3F_ | - |
| --l-badge-dot-color | _#F53F3F_ | - |
| --l-badge-dot-size | _8px_ | - |
| --l-badge-font | _-apple-system-font, Helvetica Neue, Arial, sans-serif_ | - |
| --l-badge-border-radius | _999px_ | - |


## 打赏

如果你觉得本插件，解决了你的问题，赠人玫瑰，手留余香。  
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png)
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png)