# lime-tabs 选项卡
一个功能丰富的选项卡组件，用于在不同的内容区域之间进行切换，支持：
- 多种展示方式（等分/滚动）
- 手势滑动切换
- 与swiper联动
- 兼容uniapp/uniappx

> 插件依赖：`lime-shared`、`lime-badge`、`lime-style`

## 文档链接
📚 组件详细文档请访问以下站点：
- [选项卡文档 - 站点1](https://limex.qcoon.cn/components/tabs.html)
- [选项卡文档 - 站点2](https://limeui.netlify.app/components/tabs.html)
- [选项卡文档 - 站点3](https://limeui.familyzone.top/components/tabs.html)

## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-tabs`
2. 首次导入可能需要重新编译

## 代码演示

### 基础使用
通过`v-model`绑定当前激活标签的索引值，通过`list`设置选项卡列表。

```html
<l-tabs v-model="value" :list="list" />
```

```js
const value = ref(0)
const list = [
    {
        value: 1,
        label: '选项一',
    },
    {
        value: 2,
        label: '选项二',
    },
    {
        value: 3,
        label: '选项三',
    },
    {
        value: 4,
        label: '选项四',
    }
]
```

### 使用子组件
除了使用`list`属性，还可以通过`l-tab-panel`子组件设置标签内容。

```html
<l-tabs v-model="activeTab">
    <l-tab-panel :value="0" label="首页" />
    <l-tab-panel :value="1" label="分类" />
    <l-tab-panel :value="2" label="购物车" />
</l-tabs>
```

### 标签栏滚动
当标签数量较多时，可通过设置`:space-evenly="false"`取消等分布局，实现横向滚动。

```html
<l-tabs :space-evenly="false">
    <l-tab-panel :value="0" label="推荐" />
    <l-tab-panel :value="1" label="关注" />
    <l-tab-panel :value="2" label="热门" />
    <l-tab-panel :value="3" label="体育" />
    <l-tab-panel :value="4" label="科技" />
    <l-tab-panel :value="5" label="财经" />
    <l-tab-panel :value="6" label="娱乐" />
</l-tabs>
```

### 徽标提示
支持在标签上显示徽标或小红点，可自定义偏移位置。

```html
<l-tabs :space-evenly="false">
    <l-tab-panel :value="0" label="消息" />
    <!-- 显示小红点 -->
    <l-tab-panel :value="1" label="联系人" :dot="true" />
    <!-- 显示数字徽标 -->
    <l-tab-panel :value="2" label="通知" badge="8" :offset="[-8,3]"/>
    <l-tab-panel :value="3" label="设置" />
</l-tabs>
```

### 切换动画
通过`:animated="true"`开启标签内容切换时的转场动画。

```html
<l-tabs v-model="value" :animated="true">
    <l-tab-panel :value="0" label="选项一">
        <view class="content-panel">选项卡内容1</view>
    </l-tab-panel>
    <l-tab-panel :value="1" label="选项二">
        <view class="content-panel">选项卡内容2</view>
    </l-tab-panel>
    <l-tab-panel :value="2" label="选项三">
        <view class="content-panel">选项卡内容3</view>
    </l-tab-panel>
</l-tabs>
```

### 滑动切换
通过`:swipeable="true"`开启手势左右滑动切换标签页功能。

```html
<l-tabs v-model="value" :animated="true" :swipeable="true">
    <l-tab-panel :value="0" label="选项一">
        <view class="content-panel">向左滑动查看下一个选项</view>
    </l-tab-panel>
    <l-tab-panel :value="1" label="选项二">
        <view class="content-panel">可以左右滑动切换选项</view>
    </l-tab-panel>
    <l-tab-panel :value="2" label="选项三">
        <view class="content-panel">向右滑动查看上一个选项</view>
    </l-tab-panel>
</l-tabs>
```

### 受控模式
通过`@click`事件可以在切换标签前执行特定的逻辑，实现受控切换。

```html
<l-tabs :value="value" @click="onClick">
    <l-tab-panel :value="0" label="选项一">
        <view class="content-panel">选项卡内容1</view>
    </l-tab-panel>
    <l-tab-panel :value="1" label="选项二">
        <view class="content-panel">选项卡内容2</view>
    </l-tab-panel>
    <l-tab-panel :value="2" label="选项三">
        <view class="content-panel">选项卡内容3</view>
    </l-tab-panel>
</l-tabs>
```

```js
const value = ref(1);
const onClick = (index) => {
    // 在切换前执行一些逻辑，如数据校验
    uni.showLoading({title:'校验中'})
    setTimeout(() => {
        uni.hideLoading()
        value.value = index // 手动更新选中的标签
    }, 1000)
}
```

## 快速预览
导入插件后，可以直接使用以下标签查看演示效果：

```html
<!-- 代码位于 uni_modules/lime-tabs/components/lime-tabs -->
<lime-tabs />
```

## 插件标签说明
- `l-tabs`：选项卡容器组件
- `l-tab-panel`：选项卡面板组件
- `lime-tabs`：演示标签

## Vue2使用说明
插件使用了`composition-api`，请按官方教程[vue-composition-api](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)配置。

关键代码是在main.js中的Vue2部分添加以下代码：

```js
// vue2
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```

## API文档

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
| lStyle | 自定义样式 | _string\|Object_ | `-` |

### Tabs Events

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| click | 点击标签时触发 | <em>index: number</em> |
| change | 当前激活标签改变时触发 | <em>index: number</em> |

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
| value | 选项卡的唯一标识 | <em>number</em> | - |
| label | 选项卡名称 | <em>string</em> | - |
| disabled | 是否禁用 | <em>boolean</em> | `false` |
| dot | 是否显示小红点 | <em>boolean</em> | `false` |
| badge | 徽标内容 | <em>string \| number</em> | - |
| offset | 徽标偏移量 | <em>number[]</em> | `[]` |

## 主题定制
组件提供了以下CSS变量用于自定义样式：

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
| --l-tab-font-size | <em>28rpx</em> | 标签文字大小 |
| --l-tab-nav-bg-color | <em>white</em> | 导航栏背景色 |
| --l-tab-content-bg-color | <em>white</em> | 导航栏内容背景色 |
| --l-tab-item-height | <em>96rpx</em> | 标签项高度 |
| --l-tab-item-padding-x | <em>32rpx</em> | 标签项内边距 |
| --l-tab-item-padding-y | <em>0</em> | 标签项内边距 |
| --l-tab-item-color | <em>$text-color-1</em> | 标签文字颜色 |
| --l-tab-item-active-color | <em>$primary-color</em> | 激活状态文字颜色 |
| --l-tab-item-disabled-color | <em>$text-color-disabled</em> | 禁用状态文字颜色 |
| --l-tab-split-color | <em>$primary-color</em> | 下划线颜色 |
| --l-tab-track-color | <em>$border-color-1</em> | 指示线颜色 |
| --l-tab-track-height | <em>6rpx</em> | 底部指示线高度 |
| --l-tab-track-width | <em>32rpx</em> | 底部指示线宽度 |
| --l-tab-track-radius | <em>8rpx</em> | 底部指示线圆角 |

## 支持与赞赏

如果这个组件对您有帮助，可以考虑支持开发者：

| 支付宝 | 微信支付 |
|--------|--------|
| ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |