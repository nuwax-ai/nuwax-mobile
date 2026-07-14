# lime-checkbox 复选框
一个功能丰富的复选框组件，支持v-model双向数据绑定，提供多种自定义样式选项，包括不同形状、颜色和大小的复选框。组件支持单独使用和组合使用，可以实现全选、限制最大可选数等功能，兼容uniapp/uniappx。

> 插件依赖：`lime-shared`、`lime-icon`、`lime-style`

## 文档链接
📚 组件详细文档请访问以下站点：
- [复选框文档 - 站点1](https://limex.qcoon.cn/components/checkbox.html)
- [复选框文档 - 站点2](https://limeui.netlify.app/components/checkbox.html)
- [复选框文档 - 站点3](https://limeui.familyzone.top/components/checkbox.html)

## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-checkbox`
2. 首次导入可能需要重新编译
3. 在页面中使用`l-checkbox`和`l-checkbox-group`组件

## 代码演示

### 基础演示
通过 `v-model` 绑定复选框的勾选状态。

```html
<l-checkbox v-model="checked">复选框</l-checkbox>
```

```js
const checked = ref(false)
```

### 选项组
通过 v-model 绑定值当前选中项的 `value`或`name`。

```html
<l-checkbox-group v-model="checked" @change="onChange">
  <l-checkbox value="Beijing" label="北京" />
  <l-checkbox value="Shanghai" label="上海" />
  <l-checkbox value="Guangzhou" label="广州" />
  <l-checkbox value="Shenzen" label="深圳" />
</l-checkbox-group>
```

```js
const checked = ref(['Beijing']);

const onChange = (e: string[]) => {
  console.log('onChange', e)
}
```

### 禁用
通过 `disabled` 属性禁止选项切换，在 checkbox 上设置 `disabled` 可以禁用单个选项。

```html
<l-checkbox-group v-model="checked" disabled>
  <l-checkbox value="Beijing" label="北京" />
  <l-checkbox value="Shanghai" label="上海" />
  <l-checkbox value="Guangzhou" label="广州" />
  <l-checkbox value="Shenzen" label="深圳" />
</l-checkbox-group>
```

### 样式
`icon` 属性可选值为`circle`(圆) `line`(线) `dot`(点)，复选框形状。

```html
<!-- 点状复选框 -->
<l-checkbox-group icon="dot">
  <l-checkbox value="Beijing" label="北京" />
  <l-checkbox value="Guangzhou" label="广州" />
  <l-checkbox value="Shenzen" label="深圳" />
</l-checkbox-group>

<!-- 圆形复选框 -->
<l-checkbox-group icon="circle">
  <l-checkbox value="Beijing" label="北京" />
  <l-checkbox value="Guangzhou" label="广州" />
  <l-checkbox value="Shenzen" label="深圳" />
</l-checkbox-group>

<!-- 线形复选框 -->
<l-checkbox-group icon="line">
  <l-checkbox value="Beijing" label="北京" />
  <l-checkbox value="Guangzhou" label="广州" />
  <l-checkbox value="Shenzen" label="深圳" />
</l-checkbox-group>
```

### 自定义颜色
通过 `checked-color` 属性设置选中状态的图标颜色。

```html
<l-checkbox-group checked-color="#ee0a24">
  <l-checkbox value="Beijing" label="北京" />
  <l-checkbox value="Guangzhou" label="广州" />
  <l-checkbox value="Shenzen" label="深圳" />
</l-checkbox-group>
```

### 自定义大小
通过 `icon-size` 属性可以自定义图标的大小。

```html
<l-checkbox-group>
  <l-checkbox icon-size="44px" value="Beijing" label="北京" />
  <l-checkbox icon-size="34px" value="Guangzhou" label="广州" />
  <l-checkbox icon-size="24px" value="Shenzen" label="深圳" />
</l-checkbox-group>
```

### 自定义图标
通过 `icon` 插槽自定义图标，并通过 `slotProps` 判断是否为选中状态。

```html
<l-checkbox-group>
  <l-checkbox value="Beijing" label="北京">
    <template #icon="{checked}">
      <image 
        v-show="checked" 
        style="width:20px; height:20px" 
        src="https://fastly.jsdelivr.net/npm/@vant/assets/user-active.png"
      ></image>
      <image 
        v-show="!checked" 
        style="width:20px; height:20px" 
        src="https://fastly.jsdelivr.net/npm/@vant/assets/user-inactive.png"
      ></image>
    </template>
  </l-checkbox>
  <l-checkbox value="Guangzhou" label="广州">
    <template #icon="{checked}">
      <image 
        v-show="checked" 
        style="width:20px; height:20px" 
        src="https://fastly.jsdelivr.net/npm/@vant/assets/user-active.png"
      ></image>
      <image 
        v-show="!checked" 
        style="width:20px; height:20px" 
        src="https://fastly.jsdelivr.net/npm/@vant/assets/user-inactive.png"
      ></image>
    </template>
  </l-checkbox>
  <l-checkbox value="Shenzen" label="深圳">
    <template #icon="{checked}">
      <image 
        v-show="checked" 
        style="width:20px; height:20px" 
        src="https://fastly.jsdelivr.net/npm/@vant/assets/user-active.png"
      ></image>
      <image 
        v-show="!checked" 
        style="width:20px; height:20px" 
        src="https://fastly.jsdelivr.net/npm/@vant/assets/user-inactive.png"
      ></image>
    </template>
  </l-checkbox>
</l-checkbox-group>
```

### 限制最大可选数
通过 `max` 属性可以限制复选框组的最大可选数。

```html
<l-checkbox-group :max="3">
  <l-checkbox value="Beijing" label="北京" />
  <l-checkbox value="Shanghai" label="上海" />
  <l-checkbox value="Guangzhou" label="广州" />
  <l-checkbox value="Shenzen" label="深圳" />
</l-checkbox-group>
```

### 全选与反选
通过 `CheckboxGroup` 实例上的 `toggleAll` 方法可以实现全选与反选。

```html
<l-checkbox-group ref="checkboxGroupRef" @change="onChange" direction="vertical">
  <l-checkbox value="all" checkAll label="全选" />
  <l-checkbox value="Beijing" label="北京" />
  <l-checkbox value="Shanghai" label="上海" />
  <l-checkbox value="Guangzhou" label="广州" />
  <l-checkbox value="Shenzen" label="深圳" />
</l-checkbox-group>
<button type="primary" @click="checkAll">全选</button>
<button @click="toggleAll">反选</button>
```

```js
const checkboxGroupRef = ref<LCheckboxGroupComponentPublicInstance|null>(null);
const onChange = (e: string[]) => {
  console.log('onChange', e)
}
const checkAll = () => {
  if(checkboxGroupRef.value == null) return
  checkboxGroupRef.value!.toggleAll(true)
}
const toggleAll = () => {
  if(checkboxGroupRef.value == null) return
  checkboxGroupRef.value!.toggleAll(false)
}
```

## 快速预览
导入插件后，可以直接使用以下标签查看演示效果：

```html
<!-- 代码位于 uni_modules/lime-checkbox/components/lime-checkbox -->
<lime-checkbox />
```

## 插件标签说明
- 默认 `l-checkbox` 为组件标签
- 默认 `lime-checkbox` 为演示标签

## Vue2使用说明
插件使用了`composition-api`，如果你希望在Vue2中使用，请按官方教程[vue-composition-api](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)配置。

关键代码是在main.js中的Vue2部分添加以下代码：

```js
// vue2
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```

## API文档

### Checkbox Props

| 参数 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| name | 标识符，通常为一个唯一的字符串或数字 | <em>string\|number</em> | - |
| value | 复选按钮的值 | <em>any</em> | - |
| v-model | 是否选中 | <em>any</em> | - |
| indeterminate | 是否为半选 | <em>boolean</em> | `false` |
| checked | 是否选中 | <em>boolean</em> | `false` |
| disabled | 是否为禁用态 | <em>boolean</em> | `false` |
| readonly | 是否为只读 | <em>boolean</em> | `false` |
| checkAll | 用于标识是否为「全选选项」，单独使用无效 | <em>boolean</em> | `false` |
| icon | 自定义选中图标和非选中图标，可选值：`rectangle`、`circle`、`line`、`dot` | <em>string</em> | `rectangle` |
| label | 主文案 | <em>string</em> | - |
| fontSize | 文本大小 | <em>string</em> | - |
| iconSize | 图标大小 | <em>string</em> | - |
| checkedColor | 选中状态颜色 | <em>string</em> | - |
| iconBgColor | 图标背景颜色 | <em>string</em> | - |
| iconBorderColor | 图标描边颜色 | <em>string</em> | - |
| iconDisabledColor | 图标禁用颜色 | <em>string</em> | - |
| iconDisabledBgColor | 图标禁用背景颜色 | <em>string</em> | - |
| labelStyle | label的样式 | <em>string\|object</em> | - |

### CheckboxGroup Props

| 参数 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| v-model | 标识符，通常为一个唯一的字符串或数字 | <em>string\|number[]</em> | - |
| name | 标识符，通常为一个唯一的字符串或数字 | <em>string\|number</em> | - |
| value | 复选按钮的值 | <em>any[]</em> | - |
| indeterminate | 是否为半选 | <em>boolean</em> | `false` |
| disabled | 是否为禁用态 | <em>boolean</em> | `false` |
| direction | 排列方向，可选值为`vertical` | <em>string</em> | `horizontal` |
| icon | 自定义选中图标和非选中图标，可选值：`rectangle`、`circle`、`line`、`dot` | <em>string</em> | `rectangle` |
| fontSize | 文本大小 | <em>string</em> | - |
| iconSize | 图标大小 | <em>string</em> | - |
| checkedColor | 选中状态颜色 | <em>string</em> | - |
| iconBgColor | 图标背景颜色 | <em>string</em> | - |
| iconBorderColor | 图标描边颜色 | <em>string</em> | - |
| iconDisabledColor | 图标禁用颜色 | <em>string</em> | - |
| iconDisabledBgColor | 图标禁用背景颜色 | <em>string</em> | - |
| max | 最大可选数 | <em>number</em> | - |

### Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 当绑定值变化时触发的事件 | <em>currentValue: any</em> |

### Checkbox Slots

| 名称 | 说明 | 参数 |
| --- | --- | --- |
| default | 自定义文本 | <em>{ checked: boolean, disabled: boolean }</em> |
| icon | 自定义图标 | <em>{ checked: boolean, disabled: boolean }</em> |

## 主题定制

组件提供了下列 CSS 变量，可用于自定义样式。

| 变量名称 | 默认值 | 描述 |
|---------|--------|------|
| `--l-checkbox-icon-size` | `20px` | 标准尺寸复选框图标大小 |
| `--l-checkbox-font-size` | `16px` | 标准尺寸文本字体大小 |
| `--l-checkbox-small-icon-size` | `14px` | 小尺寸复选框图标大小 |
| `--l-checkbox-small-font-size` | `15px` | 小尺寸文本字体大小 |
| `--l-checkbox-large-icon-size` | `22px` | 大尺寸复选框图标大小 |
| `--l-checkbox-large-font-size` | `18px` | 大尺寸文本字体大小 |
| `--l-checkbox-icon-border-width` | `1rpx` | 复选框边框宽度 |
| `--l-checkbox-icon-border-radius` | `3px` | 矩形复选框圆角半径 |
| `--l-checkbox-icon-bg-color` | `$bg-color-container` | 复选框背景色 |
| `--l-checkbox-icon-border-color` | `$gray-5` | 复选框边框颜色 |
| `--l-checkbox-icon-disabled-color` | `$gray-5` | 禁用状态颜色 |
| `--l-checkbox-icon-disabled-bg-color` | `$gray-1` | 禁用状态背景色 |
| `--l-checkbox-icon-checked-color` | `$primary-color` | 选中状态颜色 |
| `--l-checkbox-text-color` | `$text-color-1` | 文本颜色 |
| `--l-checkbox-icon-text-gap` | `$spacer-xs` | 图标与文本间距 |

## 支持与赞赏

如果你觉得本插件解决了你的问题，可以考虑支持作者：

| 支付宝赞助 | 微信赞助 |
|------------|------------|
| ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |