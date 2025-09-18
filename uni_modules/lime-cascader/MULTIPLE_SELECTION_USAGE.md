# l-cascader 多选功能使用说明

## 概述

l-cascader 组件现在支持单选和多选两种模式。通过设置 `multiple` 属性可以启用多选功能。

## 基本用法

### 单选模式（默认）

```vue
<template>
  <l-cascader
    :visible="showCascader"
    :options="options"
    v-model="selectedValue"
    @change="onChange"
    @finish="onFinish"
  />
</template>

<script setup lang="uts">
const showCascader = ref(false)
const selectedValue = ref('')

const options = [
  {
    label: '北京',
    value: 'beijing',
    children: [
      { label: '朝阳区', value: 'chaoyang' },
      { label: '海淀区', value: 'haidian' }
    ]
  },
  {
    label: '上海',
    value: 'shanghai',
    children: [
      { label: '浦东新区', value: 'pudong' },
      { label: '黄浦区', value: 'huangpu' }
    ]
  }
]

const onChange = (value: string) => {
  console.log('选中值:', value)
}

const onFinish = () => {
  console.log('选择完成')
  showCascader.value = false
}
</script>
```

### 多选模式

```vue
<template>
  <l-cascader
    :visible="showCascader"
    :options="options"
    :multiple="true"
    v-model="selectedValues"
    @change="onChange"
    @finish="onFinish"
  />
</template>

<script setup lang="uts">
const showCascader = ref(false)
const selectedValues = ref('') // 多选模式下，值为逗号分隔的字符串

const options = [
  {
    label: '北京',
    value: 'beijing',
    children: [
      { label: '朝阳区', value: 'chaoyang' },
      { label: '海淀区', value: 'haidian' }
    ]
  },
  {
    label: '上海',
    value: 'shanghai',
    children: [
      { label: '浦东新区', value: 'pudong' },
      { label: '黄浦区', value: 'huangpu' }
    ]
  }
]

const onChange = (value: string) => {
  console.log('选中值:', value) // 多选模式下为 "beijing,shanghai" 格式
  // 可以转换为数组
  const valuesArray = value.split(',').filter(v => v.trim() !== '')
  console.log('选中值数组:', valuesArray)
}

const onFinish = () => {
  console.log('选择完成')
  showCascader.value = false
}
</script>
```

## 属性说明

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| multiple | boolean | false | 是否启用多选模式 |
| value | string | '' | 当前选中值，多选模式下为逗号分隔的字符串 |
| options | Array | [] | 数据源 |
| visible | boolean | false | 控制组件显示/隐藏 |

## 事件说明

| 事件 | 参数 | 说明 |
|------|------|------|
| change | (value: string, selectedOptions: Array) | 选项变化时触发，多选模式下 value 为逗号分隔的字符串 |
| pick | (level: number, index: number, code: string, selectedIndexes: Array) | 选中时触发 |
| finish | () | 点击完成时触发 |
| close | () | 关闭时触发 |

## 注意事项

1. **多选模式下的值格式**：多选模式下，`value` 属性为逗号分隔的字符串，如 "beijing,shanghai"
2. **回显支持**：组件支持多选值的回显，传入逗号分隔的字符串即可
3. **确认按钮**：多选模式下建议设置确认按钮，用户选择完成后点击确认
4. **数据转换**：如需数组格式，可通过 `value.split(',').filter(v => v.trim() !== '')` 转换

## 完整示例

```vue
<template>
  <view class="container">
    <button @click="showCascader = true">选择地区</button>
    
    <text v-if="selectedValues">已选择: {{ displayText }}</text>
    
    <l-cascader
      :visible="showCascader"
      :options="regionOptions"
      :multiple="true"
      title="选择地区"
      placeholder="请选择"
      confirm-btn="确定"
      v-model="selectedValues"
      @change="onRegionChange"
      @finish="onRegionFinish"
      @close="showCascader = false"
    />
  </view>
</template>

<script setup lang="uts">
const showCascader = ref(false)
const selectedValues = ref('')
const displayText = ref('')

const regionOptions = [
  {
    label: '北京',
    value: 'beijing',
    children: [
      { label: '朝阳区', value: 'chaoyang' },
      { label: '海淀区', value: 'haidian' },
      { label: '西城区', value: 'xicheng' }
    ]
  },
  {
    label: '上海',
    value: 'shanghai',
    children: [
      { label: '浦东新区', value: 'pudong' },
      { label: '黄浦区', value: 'huangpu' },
      { label: '静安区', value: 'jingan' }
    ]
  },
  {
    label: '广东',
    value: 'guangdong',
    children: [
      { label: '广州市', value: 'guangzhou' },
      { label: '深圳市', value: 'shenzhen' },
      { label: '珠海市', value: 'zhuhai' }
    ]
  }
]

const onRegionChange = (value: string) => {
  console.log('选中值变化:', value)
  updateDisplayText(value)
}

const onRegionFinish = () => {
  console.log('选择完成')
  showCascader.value = false
}

const updateDisplayText = (value: string) => {
  if (!value) {
    displayText.value = ''
    return
  }
  
  const values = value.split(',').filter(v => v.trim() !== '')
  const labels: string[] = []
  
  // 根据选中的值找到对应的标签
  values.forEach(val => {
    const label = findLabelByValue(regionOptions, val)
    if (label) {
      labels.push(label)
    }
  })
  
  displayText.value = labels.join('、')
}

const findLabelByValue = (options: any[], value: string): string => {
  for (const option of options) {
    if (option.value === value) {
      return option.label
    }
    if (option.children) {
      const childLabel = findLabelByValue(option.children, value)
      if (childLabel) {
        return childLabel
      }
    }
  }
  return ''
}
</script>
```

这样，l-cascader 组件就成功支持了单选和多选两种模式！
