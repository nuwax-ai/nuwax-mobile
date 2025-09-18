# l-cascader 多选级联选择器使用指南

## 概述

l-cascader 组件现已支持单选和多选两种模式，类似 Ant Design 的 Cascader 级联多选组件。多选模式下使用 lime-checkbox 组件作为选择框。

## 基本用法

### 单选模式（默认）

```vue
<template>
  <view>
    <l-cascader
      :visible="showSingle"
      :options="options"
      v-model="singleValue"
      title="单选级联选择"
      @change="onSingleChange"
      @finish="onSingleFinish"
    />
    <button @click="showSingle = true">打开单选级联选择器</button>
  </view>
</template>

<script setup lang="uts">
const showSingle = ref(false)
const singleValue = ref('')

const options = [
  {
    label: '浙江省',
    value: 'zhejiang',
    children: [
      {
        label: '杭州市',
        value: 'hangzhou',
        children: [
          { label: '西湖区', value: 'xihu' },
          { label: '余杭区', value: 'yuhang' }
        ]
      },
      {
        label: '宁波市',
        value: 'ningbo',
        children: [
          { label: '海曙区', value: 'haishu' },
          { label: '江北区', value: 'jiangbei' }
        ]
      }
    ]
  },
  {
    label: '江苏省',
    value: 'jiangsu',
    children: [
      {
        label: '南京市',
        value: 'nanjing',
        children: [
          { label: '玄武区', value: 'xuanwu' },
          { label: '鼓楼区', value: 'gulou' }
        ]
      }
    ]
  }
]

const onSingleChange = (value: string, selectedOptions: any[]) => {
  console.log('单选值变化:', value, selectedOptions)
}

const onSingleFinish = () => {
  console.log('单选完成:', singleValue.value)
  showSingle.value = false
}
</script>
```

### 多选模式

```vue
<template>
  <view>
    <l-cascader
      :visible="showMultiple"
      :options="options"
      :multiple="true"
      v-model:multipleValue="multipleValue"
      title="多选级联选择"
      :maxTagCount="5"
      :showCheckedCount="true"
      @change="onMultipleChange"
      @finish="onMultipleFinish"
    />
    <button @click="showMultiple = true">打开多选级联选择器</button>
    <view v-if="multipleValue.length > 0">
      <text>已选择: {{ multipleValue.join(', ') }}</text>
    </view>
  </view>
</template>

<script setup lang="uts">
const showMultiple = ref(false)
const multipleValue = ref<string[]>([])

const onMultipleChange = (values: string[], selectedOptions: any[]) => {
  console.log('多选值变化:', values, selectedOptions)
}

const onMultipleFinish = () => {
  console.log('多选完成:', multipleValue.value)
  showMultiple.value = false
}
</script>
```

## 属性说明

### 多选相关属性

| 属性名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| multiple | boolean | false | 是否启用多选模式 |
| multipleValue | string[] | [] | 多选模式下的选中值数组（支持v-model） |
| defaultMultipleValue | string[] | [] | 多选模式下的默认选中值数组 |
| maxTagCount | number | -1 | 最大选择数量，-1表示无限制 |
| showCheckedCount | boolean | true | 是否显示选中数量 |

### 其他属性

| 属性名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| visible | boolean | false | 控制组件显示/隐藏 |
| options | UTSJSONObject[] | [] | 数据源 |
| title | string | - | 主标题文本 |
| placeholder | string | '选择选项' | 未选择时的提示文字 |
| checkStrictly | boolean | false | 父子节点选择是否关联 |
| closeable | boolean | true | 是否显示关闭按钮 |
| activeColor | string | '#3283ff' | 选中状态主题色 |

## 事件说明

| 事件名 | 参数 | 说明 |
|--------|------|------|
| change | (value: string \| string[], selectedOptions: any[]) | 选项变化时触发，单选返回string，多选返回string[] |
| pick | (level: number, index: number, value: string, selectedIndexes: number[]) | 选中时触发 |
| close | - | 关闭时触发 |
| finish | - | 点击完成时触发 |

## 数据格式

### 选项数据结构

```typescript
interface CascaderOption {
  label: string;        // 显示文本
  value: string;        // 选项值
  children?: CascaderOption[];  // 子选项
  disabled?: boolean;   // 是否禁用
  color?: string;       // 自定义颜色
}
```

### 字段别名配置

```vue
<l-cascader
  :options="options"
  :keys="{ label: 'name', value: 'id', children: 'subItems' }"
/>
```

## 高级用法

### 自定义字段别名

```vue
<template>
  <l-cascader
    :visible="show"
    :options="customOptions"
    :keys="{ label: 'name', value: 'code', children: 'subItems' }"
    v-model:multipleValue="values"
    :multiple="true"
  />
</template>

<script setup lang="uts">
const customOptions = [
  {
    name: '华东地区',
    code: 'east',
    subItems: [
      {
        name: '上海',
        code: 'shanghai',
        subItems: [
          { name: '浦东新区', code: 'pudong' },
          { name: '黄浦区', code: 'huangpu' }
        ]
      }
    ]
  }
]
</script>
```

### 限制选择数量

```vue
<l-cascader
  :visible="show"
  :options="options"
  :multiple="true"
  :maxTagCount="3"
  v-model:multipleValue="values"
/>
```

### 禁用某些选项

```vue
<script setup lang="uts">
const options = [
  {
    label: '浙江省',
    value: 'zhejiang',
    children: [
      {
        label: '杭州市',
        value: 'hangzhou',
        disabled: true,  // 禁用此选项
        children: [
          { label: '西湖区', value: 'xihu' }
        ]
      }
    ]
  }
]
</script>
```

## 注意事项

1. **单选模式**：使用 `v-model` 绑定单个字符串值
2. **多选模式**：使用 `v-model:multipleValue` 绑定字符串数组
3. **父子关联**：`checkStrictly` 为 false 时，选择父节点会自动选择所有子节点
4. **最大选择数**：`maxTagCount` 设置为 -1 表示无限制
5. **样式定制**：可以通过 CSS 变量自定义主题色和样式

## 样式定制

```scss
// 自定义主题色
.l-cascader {
  --l-cascader-icon-color: #ff6b6b;
  --l-cascader-cell-title-color: #333;
}

// 自定义checkbox样式
.l-cascader__checkbox {
  .l-checkbox {
    --l-checkbox-icon-checked-color: #ff6b6b;
  }
}
```

## 兼容性

- 支持 H5、小程序、App 多端
- 基于 uni-app-x 框架开发
- 使用 UTS 语言编写
- 兼容 lime-checkbox 组件