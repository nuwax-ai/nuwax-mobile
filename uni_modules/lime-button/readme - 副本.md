# lime-button 按钮
按钮用于开始一个即时操作，是用户与应用交互的基础组件。本组件提供了丰富的按钮类型、样式和状态，满足各种场景需求。

> 插件依赖：`lime-style`、`lime-shared`、`lime-loading`、`lime-icon`



## 文档链接
📚 组件详细文档请访问以下站点：
- [按钮文档 - 站点1](https://limex.qcoon.cn/components/button.html)
- [按钮文档 - 站点2](https://limeui.netlify.app/components/button.html)
- [按钮文档 - 站点3](https://limeui.familyzone.top/components/button.html)


## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-button`
2. 导入后可能需要重新编译项目
3. 在页面中使用`l-button`组件（组件）或`lime-button`（演示）

::: tip 注意🔔 
本插件依赖的[【lime-svg】](https://ext.dcloud.net.cn/plugin?id=18519)是原生插件，如果购买(收费为6元)则需要自定义基座，才能使用，
若不需要删除即可
:::


## 代码演示

### 按钮主题

按钮支持 `default`、`primary`、`success`、`warning`、`danger` 五种主题，默认为 `default`。

```html
<l-button type="primary">品牌色</l-button>
<l-button type="success">成功色</l-button>
<l-button type="warning">警告色</l-button>
<l-button type="danger">危险色</l-button>
<l-button>通用色</l-button>
```

### 按钮变体

按钮支持 `solid`、`outline`、`dashed`、`light`、`text`，默认为 `solid`。

```html
<l-button type="primary">默认按钮</l-button>
<l-button type="primary" variant="outline">镂空按钮</l-button> 
<l-button type="primary" variant="light">高亮按钮</l-button>
<l-button type="primary" variant="text">文本按钮</l-button>
```

### 按钮尺寸

按钮支持 `large`、`medium`、`small`、`mini` 四种尺寸，默认为 `medium`。还有一个通栏 `block` 或 `data-block`，之所以多加了个`data-block`是因为它会编译到节点上

```html
<l-button type="primary" size="large" data-block>通栏</l-button>
<l-button type="primary" size="large">大</l-button>
<l-button type="warning" size="medium">中</l-button>
<l-button type="primary" size="small">小</l-button>
<l-button type="success" size="mini">细</l-button>
```

### 按钮形状

按钮支持 `circle`、`round`、`square`、`rectangle` 四种尺寸，默认为 `rectangle`。

```html
<l-button type="primary" shape="circle">圆形</l-button>
<l-button type="primary" shape="round">圆角矩形</l-button>
<l-button type="primary" shape="square">正方形</l-button>
<l-button type="primary">长方形</l-button>
```


### 自定义颜色

通过 `color` 属性来设置徽标的颜色。

```html
<l-button color="#7232dd">单色按钮</l-button>
<l-button color="#7232dd" type="outline">镂空按钮</l-button>
<l-button color="linear-gradient(to right, rgb(255, 96, 52), rgb(238, 10, 36))">渐变按钮</l-button>
```

### 加载状态

通过 `loading` 属性来禁用按钮，加载状态下按钮不可点击。

```html
<l-button :loading="true" type="primary">加载中</l-button> 
```


### 禁用状态

通过 `disabled` 属性来禁用按钮，禁用状态下按钮不可点击。

```html
<l-button :disabled="true" type="primary">默认按钮</l-button>
```


## 快速预览
导入插件后，可以直接使用以下标签查看演示效果：

```html
<!-- 代码位于 uni_modules/lime-button/components/lime-button -->
<lime-button />
```

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

名称 | 类型 | 默认值 | 说明 | 必传
-- | -- | -- | -- | --
l-id | String | - | 按钮标签id | N
variant | String | solid | 按钮形式，基础、线框、文字。可选项：solid/outline/dashed/light/text | N
type | String | default | 组件风格，依次为品牌色、危险色。可选项：default/primary/danger/warning/success | N
block | Boolean | false | 是否为块级元素 | N
content | String | - | 按钮内容 | N
disabled | Boolean | false | 禁用状态 | N
ghost | Boolean | false | 幽灵按钮 | N
icon | String  | - | 图标名称。值为字符串表示图标名称。 | N
iconSize | String  | - | 图标大小。 | N
loading | Boolean | false | 是否显示为加载状态 | N
shape | String | rectangle | 按钮形状，有 4 种：长方形、正方形、圆角长方形、圆形。可选项：rectangle/square/round/circle | N
size | String | medium | 组件尺寸。可选项：mini/small/medium/large。TS 类型：`SizeEnum` | N
radius | String | - | 圆角 | N
fontSize | String | - | 文本大小 | N
gap | String | - | 文本与图标的间距 | N
textColor | String | - | 文本颜色 | N
color | String | - | 按钮颜色 | N
formType | String | - | 同小程序的 formType。可选项：submit/reset | N
open-type | String | - | 微信开放能力。<br />具体释义：<br />`contact` 打开客服会话，如果用户在会话中点击消息卡片后返回小程序，可以从 bindcontact 回调中获得具体信息，<a href="https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/customer-message/customer-message.html">具体说明</a> （*小程序插件中不能使用*）；<br />`share` 触发用户转发，使用前建议先阅读<a href="https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/share.html#使用指引">使用指引</a>；<br />`getPhoneNumber` 获取用户手机号，可以从 bindgetphonenumber 回调中获取到用户信息，<a href="https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html">具体说明</a> （*小程序插件中不能使用*）；<br />`getUserInfo` 获取用户信息，可以从 bindgetuserinfo 回调中获取到用户信息 （*小程序插件中不能使用*）；<br />`launchApp` 打开APP，可以通过 app-parameter 属性设定向 APP 传的参数<a href="https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/launchApp.html">具体说明</a>；<br />`openSetting` 打开授权设置页；<br />`feedback` 打开“意见反馈”页面，用户可提交反馈内容并上传<a href="https://developers.weixin.qq.com/miniprogram/dev/api/base/debug/wx.getLogManager.html">日志</a>，开发者可以登录<a href="https://mp.weixin.qq.com/">小程序管理后台</a>后进入左侧菜单“客服反馈”页面获取到反馈内容；<br />`chooseAvatar` 获取用户头像，可以从 bindchooseavatar 回调中获取到头像信息；<br />`agreePrivacyAuthorization`用户同意隐私协议按钮。用户点击一次此按钮后，所有隐私接口可以正常调用。可通过`bindagreeprivacyauthorization`监听用户同意隐私协议事件。隐私合规开发指南详情可见《<a href="https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html">小程序隐私协议开发指南</a>》。<br />[小程序官方文档](https://developers.weixin.qq.com/miniprogram/dev/component/button.html)。可选项：contact/share/getPhoneNumber/getUserInfo/launchApp/openSetting/feedback/chooseAvatar/agreePrivacyAuthorization | N
hover-class | String | '' | 指定按钮按下去的样式类，按钮不为加载或禁用状态时有效。当 `hover-class="none"` 时，没有点击态效果 | N
hover-stop-propagation | Boolean | false | 指定是否阻止本节点的祖先节点出现点击态 | N
hover-start-time | Number | 20 | 按住后多久出现点击态，单位毫秒 | N
hover-stay-time | Number | 70 | 手指松开后点击态保留时间，单位毫秒 | N
lang | String | en | 指定返回用户信息的语言，zh_CN 简体中文，zh_TW 繁体中文，en 英文。。<br />具体释义：<br />`en` 英文；<br />`zh_CN` 简体中文；<br />`zh_TW` 繁体中文。<br />[小程序官方文档](https://developers.weixin.qq.com/miniprogram/dev/component/button.html)。可选项：en/zh_CN/zh_TW | N
session-from | String | - | 会话来源，open-type="contact"时有效 | N
send-message-title | String | 当前标题 | 会话内消息卡片标题，open-type="contact"时有效 | N
send-message-path | String | 当前分享路径 | 会话内消息卡片点击跳转小程序路径，open-type="contact"时有效 | N
send-message-img | String | 截图 | 会话内消息卡片图片，open-type="contact"时有效 | N
app-parameter | String | - | 打开 APP 时，向 APP 传递的参数，open-type=launchApp时有效 | N
show-message-card | Boolean | false | 是否显示会话内消息卡片，设置此参数为 true，用户进入客服会话会在右下角显示"可能要发送的小程序"提示，用户点击后可以快速发送小程序消息，open-type="contact"时有效 | N
getuserinfo | Eventhandle | - | 用户点击该按钮时，会返回获取到的用户信息，回调的 detail 数据与<a href="https://developers.weixin.qq.com/miniprogram/dev/api/open-api/user-info/wx.getUserInfo.html">wx.getUserInfo</a>返回的一致，open-type="getUserInfo"时有效 | N
contact | Eventhandle | - | 客服消息回调，open-type="contact"时有效 | N
getphonenumber | Eventhandle | - | 获取用户手机号回调，open-type=getPhoneNumber时有效 | N
error | Eventhandle | - | 当使用开放能力时，发生错误的回调，open-type=launchApp时有效 | N
opensetting | Eventhandle | - | 在打开授权设置页后回调，open-type=openSetting时有效 | N
launchapp | Eventhandle | - | 打开 APP 成功的回调，open-type=launchApp时有效 | N
chooseavatar | Eventhandle | - | 获取用户头像回调，open-type=chooseAvatar时有效 | N
agreeprivacyauthorization | Eventhandle | - | 用户同意隐私协议事件回调，open-type=agreePrivacyAuthorization时有效 | N

### Slots

| 名称    | 说明             |
| ------- | ---------------- |
| default | 包裹的子元素 |


## 主题定制

### 样式变量

组件提供了下列 CSS 变量，可用于自定义样式。uvue app无效

| 名称 | 默认值 | 描述 |
| --- | --- | --- |
--l-button-border-radius | 6rpx | - 
--l-button-border-width | 1px | - 
--l-button-disabled-opacity | 0.6 | - 
--l-button-solid-text-color | white | - 
--l-button-default-color | $text-color-1 | - 
--l-button-default-hover-color | rgba(0,0,0,1) | - 
--l-button-default-light-color | $gray-2 | - 
--l-button-default-light-hover-color | $gray-3 | - 
--l-button-default-border-color | $gray-5 | - 
--l-button-primary-color | $primary-color | - 
--l-button-primary-hover-color | $primary-color-7 | - 
--l-button-primary-light-color | $primary-color-1 | - 
--l-button-primary-light-hover-color | $primary-color-2 | - 
--l-button-primary-border-color | $primary-color | - 
--l-button-danger-color | $danger-color | - 
--l-button-danger-hover-color | $danger-color-7 | - 
--l-button-danger-light-color | $danger-color-1 | - 
--l-button-danger-light-hover-color | $danger-color-2 | - 
--l-button-danger-border-color | $danger-color | - 
--l-button-warning-color | $warning-color | - 
--l-button-warning-hover-color | $warning-color-7 | - 
--l-button-warning-light-color | $warning-color-1 | - 
--l-button-warning-light-hover-color | $warning-color-2 | - 
--l-button-warning-border-color | $warning-color | - 
--l-button-success-color | $success-color | - 
--l-button-success-hover-color | $success-color-7 | - 
--l-button-success-light-color | $success-color-1 | - 
--l-button-success-light-hover-color | $success-color-2 | - 
--l-button-success-border-color | $success-color | - 
--l-button-info-color |  $blue | - 
--l-button-info-hover-color |  $blue-7 | - 
--l-button-info-light-color |  $blue-1 | - 
--l-button-info-light-hover-color |  $blue-3 | - 
--l-button-info-border-color |  $blue | - 
--l-button-mini-height | 56rpx | -
--l-button-small-height | 64rpx | -
--l-button-medium-height | 80rpx | -
--l-button-large-height | 96rpx | -
--l-button-button-padding | - | -
--l-button-icon-size | - | -
--l-button-font-size | - | -


## 支持与赞赏

如果你觉得本插件解决了你的问题，可以考虑支持作者：
| 支付宝赞助 | 微信赞助 |
|------------|------------|
| ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |