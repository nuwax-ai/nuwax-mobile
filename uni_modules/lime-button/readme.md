# lime-button 按钮组件
一个功能丰富的按钮组件，用于开始一个即时操作。支持多种类型、样式、状态和尺寸，可用于表单提交、页面跳转、信息确认等多种场景。组件提供了丰富的自定义选项，可以满足各种复杂的交互设计需求。

> 插件依赖：`lime-style`、`lime-shared`、`lime-loading`、`lime-icon`

## 文档链接
📚 组件详细文档请访问以下站点：
- [按钮组件文档 - 站点1](https://limex.qcoon.cn/components/button.html)
- [按钮组件文档 - 站点2](https://limeui.netlify.app/components/button.html)
- [按钮组件文档 - 站点3](https://limeui.familyzone.top/components/button.html)

## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-button`
2. 导入后可能需要重新编译项目
3. 在页面中使用`l-button`组件

::: tip 注意🔔 
本插件依赖的[【lime-svg】](https://ext.dcloud.net.cn/plugin?id=18519)是原生插件，如果购买(收费为6元)则需要自定义基座，才能使用，
若不需要删除即可
:::

## 代码演示

### 按钮类型
按钮支持 `default`、`primary`、`success`、`warning`、`danger` 五种类型，默认为 `default`。

```html
<l-button type="primary">品牌色</l-button>
<l-button type="success">成功色</l-button>
<l-button type="warning">警告色</l-button>
<l-button type="danger">危险色</l-button>
<l-button>通用色</l-button>
```

### 按钮变体
按钮支持 `solid`、`outline`、`dashed`、`light`、`text` 五种变体，默认为 `solid`。

```html
<l-button type="primary">默认按钮</l-button>
<l-button type="primary" variant="outline">镂空按钮</l-button> 
<l-button type="primary" variant="light">高亮按钮</l-button>
<l-button type="primary" variant="text">文本按钮</l-button>
```

### 按钮尺寸
按钮支持 `large`、`medium`、`small`、`mini` 四种尺寸，默认为 `medium`。

```html
<l-button type="primary" size="large" block>通栏按钮</l-button>
<l-button type="primary" size="large">大按钮</l-button>
<l-button type="warning" size="medium">中按钮</l-button>
<l-button type="primary" size="small">小按钮</l-button>
<l-button type="success" size="mini">迷你按钮</l-button>
```

### 按钮形状
按钮支持 `circle`、`round`、`square`、`rectangle` 四种形状，默认为 `rectangle`。

```html
<l-button type="primary" shape="circle">圆形</l-button>
<l-button type="primary" shape="round">圆角矩形</l-button>
<l-button type="primary" shape="square">正方形</l-button>
<l-button type="primary">长方形</l-button>
```

### 自定义颜色
通过 `color` 属性来设置按钮的颜色。

```html
<l-button color="#7232dd">单色按钮</l-button>
<l-button color="#7232dd" variant="outline">镂空按钮</l-button>
<l-button color="linear-gradient(to right, rgb(255, 96, 52), rgb(238, 10, 36))">渐变按钮</l-button>
```

### 加载状态
通过 `loading` 属性来设置按钮的加载状态，加载状态下按钮不可点击。

```html
<l-button :loading="true" type="primary">加载中</l-button> 
```

### 禁用状态
通过 `disabled` 属性来禁用按钮，禁用状态下按钮不可点击。

```html
<l-button :disabled="true" type="primary">禁用按钮</l-button>
```

### 图标按钮
通过 `icon` 属性设置按钮图标，可以搭配文字一起使用。

```html
<l-button icon="home" type="primary">首页</l-button>
<l-button icon="plus" shape="circle" type="primary"></l-button>
```

## 快速预览
导入插件后，可以直接使用以下标签查看演示效果：

```html
<!-- 代码位于 uni_modules/lime-button/components/lime-button -->
<lime-button />
```

## 插件标签说明

| 标签名 | 说明 | 
| --- | --- | 
| `l-button` | 组件标签 |
| `lime-button` | 演示标签 |

## Vue2使用说明
main.js中添加以下代码：
```js
// vue2项目中使用
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```

详细配置请参考官方文档：[Vue Composition API](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)

## API文档

### Props 属性说明

| 属性名 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| type | 按钮类型 | _string_ | `default` |
| variant | 按钮变体 | _string_ | - |
| disabled | 是否禁用 | _boolean_ | `false` |
| loading | 是否显示加载状态 | _boolean_ | `false` |
| size | 按钮尺寸 | _string_ | `medium` |
| shape | 按钮形状 | _string_ | `rectangle` |
| icon | 图标名称 | _string_ | - |
| iconSize | 图标大小 | _string_ | - |
| block | 是否为块级元素 | _boolean_ | `false` |
| ghost | 是否为幽灵按钮 | _boolean_ | `false` |
| content | 按钮文本内容 | _string_ | - |
| color | 按钮颜色 | _string_ | - |
| radius | 按钮圆角 | _string_ | - |
| fontSize | 文字大小 | _string_ | - |
| textColor | 文字颜色 | _string_ | - |
| formType | 表单提交类型 | _string_ | - |
| openType | 微信开放能力 | _string_ | - |
| hoverClass | 按下去的样式类 | _string_ | - |
| hoverStopPropagation | 是否阻止祖先节点出现点击态 | _boolean_ | `false` |
| hoverStartTime | 按住后多久出现点击态 | _number_ | `20` |
| hoverStayTime | 手指松开后点击态保留时间 | _number_ | `70` |
| lang | 返回用户信息的语言 | _string_ | `en` |
| sessionFrom | 会话来源 | _string_ | - |
| sendMessageTitle | 会话内消息卡片标题 | _string_ | - |
| sendMessagePath | 会话内消息卡片跳转路径 | _string_ | - |
| sendMessageImg | 会话内消息卡片图片 | _string_ | - |
| appParameter | 打开APP时传递的参数 | _string_ | - |
| showMessageCard | 是否显示会话内消息卡片 | _boolean_ | `false` |
| gap | 图标与文本的间距 | _string_ | - |
| lId | 按钮ID | _string_ | - |
| lStyle | 自定义样式 | _string_ | - |

### type 可选值
| 值 | 说明 |
| --- | --- |
| default | 默认按钮 |
| primary | 主要按钮 |
| success | 成功按钮 |
| warning | 警告按钮 |
| danger | 危险按钮 |

### variant 可选值
| 值 | 说明 |
| --- | --- |
| solid | 实心按钮 |
| outline | 描边按钮 |
| dashed | 虚线按钮 |
| text | 文本按钮 |
| light | 浅色按钮 |

### size 可选值
| 值 | 说明 |
| --- | --- |
| mini | 迷你尺寸 |
| small | 小尺寸 |
| medium | 中等尺寸 |
| large | 大尺寸 |

### shape 可选值
| 值 | 说明 |
| --- | --- |
| rectangle | 长方形 |
| square | 正方形 |
| round | 圆角矩形 |
| circle | 圆形 |

### Events 事件

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| click | 点击按钮时触发 | _event: Event_ |
| getuserinfo | 用户点击该按钮时，会返回获取到的用户信息 | _event: UniEvent_ |
| contact | 客服消息回调 | _event: UniEvent_ |
| getphonenumber | 获取用户手机号回调 | _event: UniEvent_ |
| error | 当使用开放能力时，发生错误的回调 | _event: UniEvent_ |
| opensetting | 在打开授权设置页后回调 | _event: UniEvent_ |
| launchapp | 打开APP成功的回调 | _event: UniEvent_ |
| chooseavatar | 获取用户头像回调 | _event: UniEvent_ |
| agreeprivacyauthorization | 用户同意隐私协议事件回调 | _event: UniEvent_ |

### Slots 插槽

| 名称 | 说明 |
| --- | --- |
| default | 按钮内容 |

## 主题定制

组件提供了以下CSS变量，可用于自定义样式：

| 变量名称 | 默认值 | 描述 |
|---------|--------|------|
| `--l-button-border-radius` | `6rpx` | 按钮边框圆角 |
| `--l-button-border-width` | `1px` | 按钮边框宽度 |
| `--l-button-disabled-opacity` | `0.6` | 禁用状态的透明度 |
| `--l-button-solid-text-color` | `white` | 实心按钮的文字颜色 |
| `--l-button-default-color` | `$text-color-1` | 默认按钮的颜色 |
| `--l-button-default-hover-color` | `rgba(0,0,0,1)` | 默认按钮悬停时的颜色 |
| `--l-button-default-light-color` | `$gray-2` | 默认按钮浅色模式的颜色 |
| `--l-button-default-light-hover-color` | `$gray-3` | 默认按钮浅色模式悬停时的颜色 |
| `--l-button-default-border-color` | `$gray-5` | 默认按钮的边框颜色 |
| `--l-button-primary-color` | `$primary-color` | 主要按钮的颜色 |
| `--l-button-primary-hover-color` | `$primary-color-7` | 主要按钮悬停时的颜色 |
| `--l-button-primary-light-color` | `$primary-color-1` | 主要按钮浅色模式的颜色 |
| `--l-button-primary-light-hover-color` | `$primary-color-2` | 主要按钮浅色模式悬停时的颜色 |
| `--l-button-primary-border-color` | `$primary-color` | 主要按钮的边框颜色 |
| `--l-button-danger-color` | `$danger-color` | 危险按钮的颜色 |
| `--l-button-danger-hover-color` | `$danger-color-7` | 危险按钮悬停时的颜色 |
| `--l-button-danger-light-color` | `$danger-color-1` | 危险按钮浅色模式的颜色 |
| `--l-button-danger-light-hover-color` | `$danger-color-2` | 危险按钮浅色模式悬停时的颜色 |
| `--l-button-danger-border-color` | `$danger-color` | 危险按钮的边框颜色 |
| `--l-button-warning-color` | `$warning-color` | 警告按钮的颜色 |
| `--l-button-warning-hover-color` | `$warning-color-7` | 警告按钮悬停时的颜色 |
| `--l-button-warning-light-color` | `$warning-color-1` | 警告按钮浅色模式的颜色 |
| `--l-button-warning-light-hover-color` | `$warning-color-2` | 警告按钮浅色模式悬停时的颜色 |
| `--l-button-warning-border-color` | `$warning-color` | 警告按钮的边框颜色 |
| `--l-button-success-color` | `$success-color` | 成功按钮的颜色 |
| `--l-button-success-hover-color` | `$success-color-7` | 成功按钮悬停时的颜色 |
| `--l-button-success-light-color` | `$success-color-1` | 成功按钮浅色模式的颜色 |
| `--l-button-success-light-hover-color` | `$success-color-2` | 成功按钮浅色模式悬停时的颜色 |
| `--l-button-success-border-color` | `$success-color` | 成功按钮的边框颜色 |
| `--l-button-mini-height` | `56rpx` | 迷你尺寸按钮的高度 |
| `--l-button-small-height` | `64rpx` | 小尺寸按钮的高度 |
| `--l-button-medium-height` | `80rpx` | 中尺寸按钮的高度 |
| `--l-button-large-height` | `96rpx` | 大尺寸按钮的高度 |
| `--l-button-button-padding` | - | 按钮内边距 |
| `--l-button-icon-size` | - | 按钮图标尺寸 |
| `--l-button-font-size` | - | 按钮文字尺寸 |

## 支持与赞赏

如果你觉得本插件解决了你的问题，可以考虑支持作者：

| 支付宝赞助 | 微信赞助 |
|------------|------------|
| ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |