# lime-overlay 遮罩层
- 通过遮罩层，可以强调部分内容
- 插件依赖`lime-style`,`lime-shared`,`lime-transition`,不喜勿下


> 插件依赖：`lime-style`、`lime-shared`、`lime-transition`
  [overlay【站点1】](https://limex.qcoon.cn/components/overlay.html)
  [overlay【站点2】](https://limeui.netlify.app/components/overlay.html)
  [overlay【站点3】](https://limeui.familyzone.top/components/overlay.html)


## 安装
在插件市场导入即可，首次安装可能需要重新编译

## 代码演示
### 基础用法
```html
<button @click="onClick">显示</button>
<l-overlay :visible="show" @click="onClick"></l-overlay>
```
```js
const show =    refl(lflalse);
const onClick = () => {
	show.value = !show.value
}
```

### 嵌入内容
通过默认插槽可以在遮罩层上嵌入任意内容。
```html
<button @click="onClick">显示</button>
<l-overlay :visible="show" @click="onClick">
	<view class="wrapper">
		<view class="block" />
	</view>
</l-overlay>
```
```js
const show = ref(false);
const onClick = () => {
	show.value = !show.value
}
```

### 查看示例
- 导入后直接使用这个标签查看演示效果

```html
<!-- // 代码位于 uni_modules/lime-overlay/compoents/lime-overlay -->
<lime-overlay />
```


### 插件标签
- 默认 l-overlay 为 component
- 默认 lime-overlay 为 demo

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
| visible | 是否展示遮罩层 | _boolean_ | `false` |
| z-index | z-index 层级 | _number_ | `1000` |
| duration | 动画时长，单位ms，设置为 0 可以禁用动画 | _number_ | `300` |
| lStyle | 样式 | _string_ | `` |
| destoryOnClose | 隐藏时是否销毁 | _boolean_ | `false` |

### Events

| 事件名 | 说明       | 回调参数            |
| ------ | ---------- | ------------------- |
| click  | 点击时触发 | _-_ |

### Slots

| 名称    | 说明                               |
| ------- | ---------------------------------- |
| default | 默认插槽，用于在遮罩层上方嵌入内容 |


## 主题定制

### 样式变量

组件提供了下列 CSS 变量，可用于自定义样式，uvue app无效。

| 名称                     | 默认值               | 描述 |
| ------------------------ | -------------------- | ---- |
| --l-overlay-z-index    | _1000_                  | -    |
| --l-overlay-background | _rgba(0, 0, 0, 0.6)_ | -    |

## 打赏

如果你觉得本插件，解决了你的问题，赠人玫瑰，手留余香。  
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png)
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png)