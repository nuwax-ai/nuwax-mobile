# Custom Tabs 组件使用文档

## 组件特性

✅ **高度自适应** - 自动继承父容器高度，内容区域自动撑满
✅ **懒加载** - 支持 tab 内容懒加载，提升性能
✅ **平滑动画** - 切换动画流畅自然
✅ **灵活配置** - 支持自定义头部高度、颜色等
✅ **响应式指示器** - 自动计算指示器位置和宽度

## 基础用法

```vue
<template>
  <view class="page">
    <custom-tabs v-model="activeTab" :tabs="tabs">
      <template #recent>
        <view class="tab-content"> 最近使用内容 </view>
      </template>

      <template #history>
        <view class="tab-content"> 会话记录内容 </view>
      </template>
    </custom-tabs>
  </view>
</template>

<script setup lang="uts">
  import CustomTabs from "@/components/custom-tabs/custom-tabs.uvue";

  const activeTab = ref(0);

  const tabs = [
    { label: "最近使用", name: "recent" },
    { label: "会话记录", name: "history" },
  ];
</script>

<style lang="scss" scoped>
  .page {
    height: 100vh;

    .tab-content {
      padding: 32rpx;
    }
  }
</style>
```

## Props

| 参数                 | 说明                | 类型                                   | 默认值    |
| -------------------- | ------------------- | -------------------------------------- | --------- |
| tabs                 | Tab 数据列表        | `Array<{label: string, name: string}>` | `[]`      |
| modelValue / v-model | 当前激活的 tab 索引 | `number`                               | `0`       |
| headerHeight         | Tab 头部高度        | `string`                               | `'88rpx'` |
| animated             | 是否开启切换动画    | `boolean`                              | `true`    |
| lazyLoad             | 是否懒加载 tab 内容 | `boolean`                              | `true`    |

## Events

| 事件名            | 说明                    | 回调参数                    |
| ----------------- | ----------------------- | --------------------------- |
| update:modelValue | 当前激活 tab 改变时触发 | `(index: number)`           |
| change            | 切换 tab 时触发         | `(index: number, tab: Tab)` |

## Slots

每个 tab 对应一个具名插槽，插槽名称为 `tabs` 数组中的 `name` 字段。

## 完整示例

```vue
<template>
  <view class="page-container">
    <custom-tabs
      v-model="currentTab"
      :tabs="tabList"
      :header-height="'100rpx'"
      :animated="true"
      :lazy-load="true"
      @change="handleTabChange"
    >
      <!-- 最近使用 -->
      <template #recent>
        <scroll-view class="scroll-content" scroll-y>
          <view class="content-wrapper">
            <text>最近使用的内容</text>
          </view>
        </scroll-view>
      </template>

      <!-- 会话记录 -->
      <template #history>
        <scroll-view class="scroll-content" scroll-y>
          <view class="content-wrapper">
            <text>会话记录内容</text>
          </view>
        </scroll-view>
      </template>

      <!-- 收藏 -->
      <template #favorites>
        <scroll-view class="scroll-content" scroll-y>
          <view class="content-wrapper">
            <text>收藏内容</text>
          </view>
        </scroll-view>
      </template>
    </custom-tabs>
  </view>
</template>

<script setup lang="uts">
  import CustomTabs from "@/components/custom-tabs/custom-tabs.uvue";

  const currentTab = ref(0);

  const tabList = [
    { label: "最近使用", name: "recent" },
    { label: "会话记录", name: "history" },
    { label: "收藏", name: "favorites" },
  ];

  const handleTabChange = (index: number, tab: any) => {
    console.log("切换到", tab.label, "索引:", index);
  };
</script>

<style lang="scss" scoped>
  .page-container {
    height: 100vh;
    display: flex;
    flex-direction: column;

    .scroll-content {
      flex: 1;
      height: 100%;
    }

    .content-wrapper {
      padding: 32rpx;
    }
  }
</style>
```

## 高度自适应说明

组件使用了 **Flexbox** 布局来实现高度自适应：

1. **父容器约束**：组件根元素使用 `h-full flex flex-col`，确保继承父级高度
2. **内容区域自动撑满**：内容区域使用 `flex-1`，自动填充剩余空间
3. **使用建议**：确保父容器有明确的高度（如 `height: 100vh` 或固定高度）

## 自定义样式

如需自定义样式，可以通过覆盖 CSS 变量或者深度选择器：

```scss
// 自定义激活颜色
::v-deep .custom-tabs {
  .tab-item.active .tab-label {
    color: #ff6b6b;
  }

  .tab-indicator {
    background: linear-gradient(90deg, #ff6b6b 0%, #ff8787 100%);
  }
}
```

## 注意事项

1. 确保传入的 `tabs` 数组中的 `name` 字段与插槽名称一致
2. 父容器需要有明确的高度，否则组件无法正确撑满
3. 懒加载模式下，首次进入的 tab 会立即加载，其他 tab 在首次切换时加载
4. 如果内容需要滚动，请在插槽内使用 `scroll-view` 组件
