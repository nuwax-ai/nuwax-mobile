# l-cascader 多选功能测试指南

## 测试页面

已创建测试页面：`/pages/test-cascader/test-cascader.uvue`

## 测试内容

### 1. 单选模式测试
- 点击"打开单选级联选择器"按钮
- 选择任意选项，验证单选功能
- 检查选中值是否正确显示

### 2. 多选模式测试
- 点击"打开多选级联选择器"按钮
- 验证 checkbox 是否正常显示
- 选择多个选项，验证多选功能
- 检查选中值和数量是否正确显示

### 3. 限制选择数量测试
- 点击"打开限制3个的多选级联选择器"按钮
- 尝试选择超过3个选项
- 验证是否显示限制提示
- 检查选中数量是否正确限制

## 修复的问题

### 1. new-conversation-set.uvue 中的问题
- **问题**：添加 `:multiple="true"` 后组件无法点击，checkbox 不显示
- **原因**：
  - 使用了错误的 v-model 绑定（应该用 `v-model:multipleValue`）
  - 数据类型不匹配（单选用 string，多选用 string[]）
- **修复**：
  - 修改为 `v-model:multipleValue="cascaderMultipleValue"`
  - 添加 `cascaderMultipleValue` 响应式数据
  - 修改 `:multiple="isMultiple"` 动态控制模式

### 2. l-cascader 组件中的问题
- **问题**：checkbox 组件属性使用错误
- **原因**：使用了不存在的 `checked` 属性
- **修复**：改为使用 `modelValue` 和 `@update:modelValue`

## 使用方法

### 单选模式
```vue
<l-cascader
  :visible="show"
  :options="options"
  v-model="singleValue"
  title="单选级联选择"
  @change="onChange"
/>
```

### 多选模式
```vue
<l-cascader
  :visible="show"
  :options="options"
  :multiple="true"
  v-model:multipleValue="multipleValue"
  title="多选级联选择"
  @change="onChange"
/>
```

### 限制选择数量
```vue
<l-cascader
  :visible="show"
  :options="options"
  :multiple="true"
  :maxTagCount="3"
  v-model:multipleValue="limitedValue"
  title="限制选择数量"
  @change="onChange"
/>
```

## 注意事项

1. **数据绑定**：
   - 单选模式使用 `v-model` 绑定 string 类型
   - 多选模式使用 `v-model:multipleValue` 绑定 string[] 类型

2. **事件处理**：
   - `change` 事件在单选模式下返回 string
   - `change` 事件在多选模式下返回 string[]

3. **样式**：
   - 多选模式下使用 lime-checkbox 组件
   - 单选模式下保持原有的图标显示

4. **功能特性**：
   - 支持父子节点关联选择（checkStrictly 属性）
   - 支持限制最大选择数量（maxTagCount 属性）
   - 支持禁用某些选项（disabled 属性）

## 测试数据

测试页面使用了三级级联数据：
- 省份（浙江省、江苏省、广东省）
- 城市（杭州、宁波、温州等）
- 区县（西湖区、余杭区等）

## 预期结果

1. **单选模式**：只能选择一个最终选项，显示选中路径
2. **多选模式**：可以选择多个选项，显示所有选中值
3. **限制模式**：最多选择指定数量的选项，超出时显示提示
4. **交互体验**：点击流畅，checkbox 状态正确，数据绑定准确
