# lime-transition 动画
lime-transition是一个强大的过渡动画组件，使元素从一种样式逐渐变化为另一种样式，提供丰富的动画效果。组件兼容uni-app和uni-app x，支持多种动画类型，可自定义动画时长和过渡效果，适用于各种交互场景。

> 插件依赖：`lime-shared`

## 文档链接
📚 组件详细文档请访问以下站点：
- [动画组件文档 - 站点1](https://limex.qcoon.cn/components/transition.html)
- [动画组件文档 - 站点2](https://limeui.netlify.app/components/transition.html)
- [动画组件文档 - 站点3](https://limeui.familyzone.top/components/transition.html)

## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-transition`
2. 导入后可能需要重新编译项目
3. 在页面中使用`l-transition`组件（组件）或`lime-transition`（演示）

## 代码演示

### 基础使用
将元素包裹在 transition 组件内，在元素展示/隐藏时，会有相应的过渡动画。

```html
<l-transition :visible="show" :appear="true">
    <view class="box">内容</view>
</l-transition>
```

```js
export default {
    data() {
        return {
            show: true
        }
    }
}
```

### 动画类型
transition 组件内置了多种动画，可以通过`name`字段指定动画类型。

```html
<l-transition :visible="show" :appear="true" name="fade-up">
    <view class="box">上滑淡入效果</view>
</l-transition>
```

### 控制显示隐藏
通过控制`visible`属性来显示或隐藏元素，触发相应的过渡动画。

```html
<l-transition :visible="show" name="fade">
    <view class="box">点击按钮控制显示/隐藏</view>
</l-transition>
<button @tap="show = !show">{{ show ? '隐藏' : '显示' }}</button>
```

```js
export default {
    data() {
        return {
            show: true
        }
    }
}
```

### 自定义动画时长
通过`duration`属性可以自定义动画的持续时间，单位为毫秒。

```html
<l-transition :visible="show" name="fade-up" :duration="800">
    <view class="box">较慢的动画效果</view>
</l-transition>
```

### 首次渲染动画
通过设置`appear`属性为`true`，可以在组件首次渲染时就执行动画。

```html
<l-transition :visible="true" :appear="true" name="slide-down">
    <view class="box">首次渲染就会有下滑进入动画</view>
</l-transition>
```

### 隐藏时销毁内容
通过设置`destoryOnClose`属性为`true`，可以在元素隐藏时销毁其内容，适用于需要重新初始化的场景。

```html
<l-transition :visible="show" :destoryOnClose="true" name="fade">
    <view class="box">隐藏时会销毁内容</view>
</l-transition>
```

### 监听动画事件
transition 组件提供了多个事件，可以在动画的不同阶段执行相应的操作。

```html
<l-transition 
    :visible="show" 
    name="fade"
    @before-enter="onBeforeEnter"
    @enter="onEnter"
    @after-enter="onAfterEnter"
    @before-leave="onBeforeLeave"
    @leave="onLeave"
    @after-leave="onAfterLeave">
    <view class="box">监听动画事件</view>
</l-transition>
```

```js
export default {
    data() {
        return {
            show: true
        }
    },
    methods: {
        onBeforeEnter() {
            console.log('进入前触发');
        },
        onEnter() {
            console.log('进入中触发');
        },
        onAfterEnter() {
            console.log('进入后触发');
        },
        onBeforeLeave() {
            console.log('离开前触发');
        },
        onLeave() {
            console.log('离开中触发');
        },
        onAfterLeave() {
            console.log('离开后触发');
        }
    }
}
```

## 快速预览
导入插件后，可以直接使用以下标签查看演示效果：

```html
<!-- 代码位于 uni_modules/lime-transition/components/lime-transition -->
<lime-transition />
```



## Vue2使用说明
本插件使用了`composition-api`，如需在Vue2项目中使用，请按照[官方教程](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)配置。

关键配置代码（在main.js中添加）：
```js
// main.js vue2
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```

## API文档

### Props

| 参数            | 说明                     | 类型             | 默认值    |
| --------------- | ------------------------ | ---------------- | --------- |
| name            | 动画类型                 | <em>string</em>  | `fade`    |
| visible         | 是否展示组件             | <em>boolean</em> | `true`    |
| appear          | 首次出现是否展示动画     | <em>boolean</em> | `false`   |
| destoryOnClose  | 隐藏时是否销毁内容       | <em>boolean</em> | `false`   |
| duration        | 动画时长，单位为毫秒     | <em>number</em>  | `300`     |
| zIndex          | 层级                     | <em>number</em>  | `11000`   |
| l-style         | 自定义样式               | <em>string</em>  | -         |

### Events

| 事件名       | 说明         | 参数 |
| ------------ | ------------ | ---- |
| before-enter | 进入前触发   | -    |
| enter        | 进入中触发   | -    |
| after-enter  | 进入后触发   | -    |
| before-leave | 离开前触发   | -    |
| leave        | 离开中触发   | -    |
| after-leave  | 离开后触发   | -    |

### 外部样式类
由于小程序的限制，只能在全局样式设置

| 类名                | 说明                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| l-class             | 根节点样式类                                                                                                                         |
| enter-class         | 定义进入过渡的开始状态。在元素被插入之前生效，在元素被插入之后的下一帧移除。                                                         |
| enter-active-class  | 定义进入过渡生效时的状态。在整个进入过渡的阶段中应用，在元素被插入之前生效，在过渡/动画完成之后移除。这个类可以被用来定义进入过渡的过程时间，延迟和曲线函数。 |
| enter-to-class      | 定义进入过渡的结束状态。在元素被插入之后下一帧生效 (与此同时 enter-class 被移除)，在过渡/动画完成之后移除。                          |
| leave-class         | 定义离开过渡的开始状态。在离开过渡被触发时立刻生效，下一帧被移除。                                                                   |
| leave-active-class  | 定义离开过渡生效时的状态。在整个离开过渡的阶段中应用，在离开过渡被触发时立刻生效，在过渡/动画完成之后移除。这个类可以被用来定义离开过渡的过程时间，延迟和曲线函数。 |
| leave-to-class      | 定义离开过渡的结束状态。在离开过渡被触发之后下一帧生效 (与此同时 leave-class 被删除)，在过渡/动画完成之后移除。                      |

### 动画类型

| 名称        | 说明     | 效果描述                           |
| ----------- | -------- | ---------------------------------- |
| fade        | 淡入     | 元素透明度从0到1的变化             |
| fade-up     | 上滑淡入 | 元素从下方向上移动并逐渐显示       |
| fade-down   | 下滑淡入 | 元素从上方向下移动并逐渐显示       |
| fade-left   | 左滑淡入 | 元素从右向左移动并逐渐显示         |
| fade-right  | 右滑淡入 | 元素从左向右移动并逐渐显示         |
| slide-up    | 上滑进入 | 元素从下方向上滑动进入视图         |
| slide-down  | 下滑进入 | 元素从上方向下滑动进入视图         |
| slide-left  | 左滑进入 | 元素从右向左滑动进入视图           |
| slide-right | 右滑进入 | 元素从左向右滑动进入视图           |


## 支持与赞赏

如果你觉得本插件解决了你的问题，可以考虑支持作者：
| 支付宝赞助 | 微信赞助 |
|------------|------------|
| ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |