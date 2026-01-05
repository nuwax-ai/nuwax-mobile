# lime-tabs 选项卡
- 标签页选项卡组件，用于在不同的内容区域之间进行切换。兼容uniapp/uniappx
- 插件依赖`lime-shared`,`lime-badge`,`lime-style`不喜勿下

## 安装
在插件市场导入即可，首次导入可能需要重新编译

## 文档
[tabs](https://limex.qcoon.cn/components/tabs.html)

## 代码演示
### 基础使用
通过 `v-model` 绑定当前激活标签对应的索引值，默认情况下启用第一个标签。通过`list`设置选项卡列表

```html
<l-tabs v-model="value" :list="list" />
```
```js
const value = ref(0)
const list = [
	{
		value: 1,
		label: '选项',
	},
	{
		value: 2,
		label: '选项',
	},
	{
		value: 3,
		label: '选项',
	},
	{
		value: 4,
		label: '选项',
	}
]
```

### 子组件
除了使用`list`设置列表，还可以通过`l-tab-panel`子组件设置标签

```html
<l-tabs>
    <l-tab-panel :value="0" label="选项" />
    <l-tab-panel :value="1" label="选项" />
    <l-tab-panel :value="2" label="选项" />
</l-tabs>
```

### 标签栏滚动
通过设置`space-evenly`取消等距，当数量宽度超过父级时可滚动。

```html
<l-tabs :space-evenly="false">
    <l-tab-panel :value="0" label="选项" />
    <l-tab-panel :value="1" label="选项" />
    <l-tab-panel :value="2" label="选项" />
    <l-tab-panel :value="3" label="选项" />
    <l-tab-panel :value="4" label="选项" />
    <l-tab-panel :value="5" label="选项" />
    <l-tab-panel :value="6" label="选项" />
</l-tabs>
```


### 徽标
通过设置`dot`为`true`可显示小红点，通过设置`badge`设置徽标内容，通过设置`offset`设置徽标偏移量。

```html
<l-tabs :space-evenly="false">
    <l-tab-panel :value="0" label="选项" />
    <l-tab-panel :value="1" label="选项" :dot="true" />
    <l-tab-panel :value="2" label="选项" />
    <l-tab-panel :value="3" label="选项" badge="8" :offset="[-8,3]"/>
    <l-tab-panel :value="4" label="选项" />
    <l-tab-panel :value="5" label="选项" />
    <l-tab-panel :value="6" label="选项" />
</l-tabs>
```

### 切换动画
通过 `animated` 属性可以开启切换标签内容时的转场动画。

```html
<l-tabs v-model="value" :space-evenly="false" :animated="true">
    <l-tab-panel :value="0" label="选项">
		<text style="padding: 15px;">选项卡内容1</text>
	</l-tab-panel>
    <l-tab-panel :value="1" label="选项">
		<text style="padding: 15px;">选项卡内容2</text>
	</l-tab-panel>
    <l-tab-panel :value="2" label="选项">
		<text style="padding: 15px;">选项卡内容3</text>
	</l-tab-panel>
    <l-tab-panel :value="3" label="选项">
		<text style="padding: 15px;">选项卡内容4</text>
	</l-tab-panel>
</l-tabs>
```

### 滑动切换
通过 `swipeable` 属性可以开启滑动切换标签页。

```html
<l-tabs v-model="value" :space-evenly="false" :animated="true" :swipeable="true">
    <l-tab-panel :value="0" label="选项">
		<text style="padding: 15px;">选项卡内容1</text>
	</l-tab-panel>
    <l-tab-panel :value="1" label="选项">
		<text style="padding: 15px;">选项卡内容2</text>
	</l-tab-panel>
    <l-tab-panel :value="2" label="选项">
		<text style="padding: 15px;">选项卡内容3</text>
	</l-tab-panel>
    <l-tab-panel :value="3" label="选项">
		<text style="padding: 15px;">选项卡内容4</text>
	</l-tab-panel>
</l-tabs>
```


### 受控
通过 `onClick` 属性可以在切换标签前执行特定的逻辑。

```html
<l-tabs :value="value" @click="onClick">
    <l-tab-panel :value="0" label="选项">
		<text style="padding: 15px;">选项卡内容1</text>
	</l-tab-panel>
    <l-tab-panel :value="1" label="选项">
		<text style="padding: 15px;">选项卡内容2</text>
	</l-tab-panel>
    <l-tab-panel :value="2" label="选项">
		<text style="padding: 15px;">选项卡内容3</text>
	</l-tab-panel>
    <l-tab-panel :value="3" label="选项">
		<text style="padding: 15px;">选项卡内容4</text>
	</l-tab-panel>
</l-tabs>
```
```js
const value = ref(1);
const onClick = (index: number) => {
	uni.showLoading({title:'校验中'})
	setTimeout(()=>{
		uni.hideLoading()
		value.value = index
	},1000)
}
```


### 查看示例
- 导入后直接使用这个标签查看演示效果

```html
 // 代码位于 uni_modules/lime-tabs/compoents/lime-tabs 
<lime-tabs />
```

### 插件标签
- 默认 l-tabs 为 component
- 默认 l-tab-panel 为 component
- 默认 lime-tabs 为 demo

### 关于vue2的使用方式
- 插件使用了`composition-api`, 如果你希望在vue2中使用请按官方的教程[vue-composition-api](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)配置
- 关键代码是: 在main.js中 在vue2部分加上这一段即可.

```js
// vue2
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```

## API

### Tabs Props

| 参数   | 说明                   | 类型      | 默认值  |
| ------ | ---------------------- | --------- | ------- |
| v-model  | 绑定当前选中标签的标识符  | _number_  | `0`     |
| value  | 当前选中标签的标识符  | _number_  | `0`     |
| list  | 选项卡列表 | _TabPanelProps[]_ | `[]` |
| animated | 是否开启切换标签内容时的转场动画 | _boolean_ | `false` |
| duration | 动画时间，单位秒，设置为 0 可以禁用动画 | _number_ | `0.3` |
| spaceEvenly | 选项卡头部空间是否均分 | _boolean_ | `true` |
| swipeable | 是否开启手势左右滑动切换 | _boolean_ | `false` |
| split | 是否展示分割线 | _boolean_ | `true` |
| color | 标签文本颜色 | _string_ | `-` |
| activeColor | 标签激活文本颜色 | _string_ | `-` |
| lineColor | 底部条颜色 | _string_ | `-` |
| lineWidth | 底部条宽度 | _string_ | `-` |
| lineHeight | 底部条高度 | _string_ | `-` |
| bgColor | 选项卡背景色 | _string_ | `-` |
| size | 组件尺寸，内置'medium', 'large'，如果传具体的值就是设置高度 | _string_ | `-` |
| padding | 标题 padding | _string_ | `-` |
| swiperProgress | 与swiper联动，传入[-1, 1] 范围的滚动进度 uniappx有效 | _number_ | `-` |
| syncSwiper | 是否启用与swiper的同步联动, uniappx有效 | _boolean_ | `false` |

### Tabs Slots 插槽

| 插槽名称       | 作用域参数                                 | 说明                                                                 |
|----------------|--------------------------------------------|---------------------------------------------------------------------|
| **label**      | `{ item: TabPanel, active: boolean, disabled: boolean }` | 自定义标签内容（会覆盖默认的标签渲染逻辑）                          |
| **left**       | -                                          | 导航栏左侧扩展区域（支持固定位置内容，如返回按钮）                  |
| **right**      | -                                          | 导航栏右侧扩展区域（支持固定位置内容，如更多按钮）                  |
| **default**    | -                                          | 内容区域（需配合 `<l-tab-panel>` 子组件使用或`list`属性）           |


### TabPanel Props

| 参数 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| value | 选项卡的值，唯一标识 | _number_ | - |
| label | 选项卡名称 | _string_ | - |
| disabled | 是否禁用选项 | _boolean_ | `false` |
| dot | 是否显示标签右上角小红点 | _boolean_ | `false` |
| badge | 标签右上角徽标的内容 | _string \| number_ | `_` |
| offset | 徽标偏移 | _string \| number[]_ | `[]` |

### GridItem Events

| 事件名 | 说明             | 回调参数            |
| ------ | ---------------- | ------------------- |
| click  | 点击标签时触发 | _index: number_ |
| change  | 当前激活的标签改变时触发 | _index: number_ |



## 主题定制

### 样式变量

组件提供了下列 CSS 变量，可用于自定义样式)。uvue app无效。

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --l-tab-font-size: | _28rpx_ | - |
| --l-tab-nav-bg-color: | _white_ | - |
| --l-tab-item-height: | _96rpx_ | - |
| --l-tab-item-padding: | _0 32rpx_ | - |
| --l-tab-item-color: | _$text-color-1_ | - |
| --l-tab-item-active-color: | _$primary-color_ | - |
| --l-tab-item-disabled-color: | _$text-color-disabled_ | - |
| --l-tab-track-color: | _$primary-color_ | - |
| --l-tab-track-height: | _6rpx_ | - |
| --l-tab-track-width: | _32rpx_ | - |
| --l-tab-track-radius: | _8rpx_ | - |



## 打赏

如果你觉得本插件，解决了你的问题，赠人玫瑰，手留余香。  
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png)
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png)