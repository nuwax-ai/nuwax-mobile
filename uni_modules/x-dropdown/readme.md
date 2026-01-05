# x-dropdown 组件使用说明

## 组件简介

`x-dropdown` 是一个灵活的下拉菜单组件，基于 uni-app 开发，支持自定义触发器和菜单内容，提供智能定位和动画效果。

## 功能特性

- ✅ 支持自定义触发器内容
- ✅ 支持自定义菜单样式
- ✅ 智能定位，自动调整菜单位置
- ✅ 流畅的动画效果
- ✅ 支持插槽自定义菜单内容
- ✅ 完整的事件回调

## 安装引入

```javascript
import XDropdown from '@/uni_modules/x-tools/components/x-dropdown/x-dropdown.vue'

export default {
  components: {
    XDropdown
  }
}
```

## 基本使用

### 基础用法

```vue
<template>
  <x-dropdown 
    :menu-list="menuOptions"
    @menuClick="onMenuClick"
  >
    <view class="trigger">
      <text>点击选择</text>
      <text class="arrow">▼</text>
    </view>
  </x-dropdown>
</template>

<script>
export default {
  data() {
    return {
      menuOptions: ['选项一', '选项二', '选项三']
    }
  },
  methods: {
    onMenuClick(item) {
      console.log('选中了:', item.value, '索引:', item.index)
    }
  }
}
</script>

<style>
.trigger {
  display: flex;
  align-items: center;
  padding: 10px;
  background: #f5f5f5;
  border-radius: 4px;
}

.arrow {
  margin-left: 8px;
  font-size: 12px;
}
</style>
```

### 自定义菜单样式

```vue
<template>
  <x-dropdown 
    :menu-list="menuOptions"
    :menu-style="customMenuStyle"
    @menuClick="onMenuClick"
  >
    <view class="custom-trigger">
      自定义样式菜单
    </view>
  </x-dropdown>
</template>

<script>
export default {
  data() {
    return {
      menuOptions: ['红色', '绿色', '蓝色'],
      customMenuStyle: {
        backgroundColor: '#f0f0f0',
        borderRadius: '12px',
        border: '1px solid #ddd'
      }
    }
  },
  methods: {
    onMenuClick(item) {
      console.log('选择了颜色:', item.value)
    }
  }
}
</script>
```

### 使用插槽自定义菜单

```vue
<template>
  <x-dropdown @open="onOpen" @close="onClose">
    <view class="trigger">
      <text>自定义菜单</text>
    </view>
    
    <template #menu>
      <view class="custom-menu">
        <view class="menu-header">选择操作</view>
        <view 
          class="custom-menu-item"
          v-for="(item, index) in customMenuList"
          :key="index"
          @click="handleCustomClick(item, index)"
        >
          <image :src="item.icon" class="menu-icon" />
          <text class="menu-text">{{ item.label }}</text>
        </view>
      </view>
    </template>
  </x-dropdown>
</template>

<script>
export default {
  data() {
    return {
      customMenuList: [
        { label: '编辑', icon: '/static/edit.png' },
        { label: '删除', icon: '/static/delete.png' },
        { label: '分享', icon: '/static/share.png' }
      ]
    }
  },
  methods: {
    onOpen() {
      console.log('菜单打开')
    },
    onClose() {
      console.log('菜单关闭')
    },
    handleCustomClick(item, index) {
      console.log('点击了:', item.label)
      // 手动关闭菜单
      this.$refs.dropdown.close()
    }
  }
}
</script>

<style>
.custom-menu {
  background: white;
  border-radius: 8px;
  box-shadow: 0 2px 20px rgba(0,0,0,0.1);
  overflow: hidden;
}

.menu-header {
  padding: 12px 16px;
  background: #f8f8f8;
  font-size: 14px;
  color: #666;
  border-bottom: 1px solid #eee;
}

.custom-menu-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
}

.custom-menu-item:active {
  background: #f0f0f0;
}

.menu-icon {
  width: 20px;
  height: 20px;
  margin-right: 12px;
}

.menu-text {
  font-size: 16px;
  color: #333;
}
</style>
```

## 属性说明

| 属性名 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `menuList` | Array | `['菜单1', '菜单2', '菜单3']` | 菜单选项列表 |
| `menuStyle` | Object | `{}` | 菜单项的自定义样式 |
| `interspace` | String/Number | `'10rpx'` | 菜单与触发器的间距 |
| `customStyle` | Object/String | - | 触发器的自定义样式 |

### menuList 数据格式

支持以下两种数据格式：

```javascript
// 简单字符串数组
menuList: ['选项1', '选项2', '选项3']

// 对象数组（推荐）
menuList: [
  { label: '选项1', value: 'option1' },
  { label: '选项2', value: 'option2' },
  { label: '选项3', value: 'option3' }
]
```

## 事件说明

| 事件名 | 说明 | 回调参数 |
|--------|------|----------|
| `@open` | 菜单打开时触发 | - |
| `@close` | 菜单关闭时触发 | - |
| `@change` | 菜单状态改变时触发 | `Boolean` - 是否打开 |
| `@menuClick` | 点击菜单项时触发 | `{ value, index }` - 菜单项值和索引 |

## 插槽说明

| 插槽名 | 说明 |
|--------|------|
| 默认插槽 | 触发器内容 |
| `menu` | 自定义菜单内容 |

## 方法说明

| 方法名 | 说明 | 参数 |
|--------|------|------|
| `close()` | 手动关闭菜单 | - |

使用方法：
```javascript
// 通过 ref 调用
this.$refs.dropdown.close()
```

## 完整示例

```vue
<template>
  <view class="page">
    <view class="demo-section">
      <text class="section-title">基础下拉菜单</text>
      <x-dropdown 
        ref="basicDropdown"
        :menu-list="basicMenuList"
        :interspace="20"
        @open="onDropdownOpen"
        @close="onDropdownClose"
        @change="onDropdownChange"
        @menuClick="onBasicMenuClick"
      >
        <view class="basic-trigger">
          <text>{{ selectedValue || '请选择' }}</text>
          <text class="dropdown-arrow" :class="{ 'rotate': isOpen }">▼</text>
        </view>
      </x-dropdown>
    </view>

    <view class="demo-section">
      <text class="section-title">自定义样式菜单</text>
      <x-dropdown 
        :menu-list="colorMenuList"
        :menu-style="colorMenuStyle"
        @menuClick="onColorMenuClick"
      >
        <view class="color-trigger" :style="{ backgroundColor: selectedColor }">
          选择颜色
        </view>
      </x-dropdown>
    </view>

    <view class="demo-section">
      <text class="section-title">完全自定义菜单</text>
      <x-dropdown ref="customDropdown" @open="onCustomOpen">
        <view class="custom-trigger">
          <image src="/static/more.png" class="more-icon" />
        </view>
        
        <template #menu>
          <view class="action-menu">
            <view 
              class="action-item"
              v-for="(action, index) in actionList"
              :key="index"
              @click="handleAction(action, index)"
            >
              <image :src="action.icon" class="action-icon" />
              <text class="action-text">{{ action.name }}</text>
            </view>
          </view>
        </template>
      </x-dropdown>
    </view>
  </view>
</template>

<script>
export default {
  data() {
    return {
      isOpen: false,
      selectedValue: '',
      selectedColor: '#f0f0f0',
      basicMenuList: ['首页', '产品', '服务', '关于我们'],
      colorMenuList: ['红色', '绿色', '蓝色', '黄色'],
      colorMenuStyle: {
        backgroundColor: '#fff',
        borderRadius: '8px',
        border: '2px solid #e0e0e0'
      },
      actionList: [
        { name: '编辑', icon: '/static/edit.png', action: 'edit' },
        { name: '复制', icon: '/static/copy.png', action: 'copy' },
        { name: '删除', icon: '/static/delete.png', action: 'delete' }
      ]
    }
  },
  methods: {
    onDropdownOpen() {
      console.log('基础菜单打开')
    },
    onDropdownClose() {
      console.log('基础菜单关闭')
    },
    onDropdownChange(isOpen) {
      this.isOpen = isOpen
      console.log('菜单状态:', isOpen ? '打开' : '关闭')
    },
    onBasicMenuClick(item) {
      this.selectedValue = item.value
      console.log('选择了:', item.value, '索引:', item.index)
    },
    onColorMenuClick(item) {
      const colorMap = {
        '红色': '#ff4757',
        '绿色': '#2ed573',
        '蓝色': '#3742fa',
        '黄色': '#ffa502'
      }
      this.selectedColor = colorMap[item.value] || '#f0f0f0'
      console.log('选择了颜色:', item.value)
    },
    onCustomOpen() {
      console.log('自定义菜单打开')
    },
    handleAction(action, index) {
      console.log('执行操作:', action.action)
      
      switch(action.action) {
        case 'edit':
          this.handleEdit()
          break
        case 'copy':
          this.handleCopy()
          break
        case 'delete':
          this.handleDelete()
          break
      }
      
      // 关闭菜单
      this.$refs.customDropdown.close()
    },
    handleEdit() {
      uni.showToast({ title: '编辑操作', icon: 'none' })
    },
    handleCopy() {
      uni.showToast({ title: '复制成功', icon: 'success' })
    },
    handleDelete() {
      uni.showModal({
        title: '确认删除',
        content: '确定要删除这个项目吗？',
        success: (res) => {
          if (res.confirm) {
            uni.showToast({ title: '删除成功', icon: 'success' })
          }
        }
      })
    }
  }
}
</script>

<style>
.page {
  padding: 20px;
}

.demo-section {
  margin-bottom: 40px;
}

.section-title {
  display: block;
  font-size: 18px;
  font-weight: bold;
  margin-bottom: 16px;
  color: #333;
}

.basic-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: #fff;
  border: 1px solid #ddd;
  border-radius: 6px;
  min-width: 120px;
}

.dropdown-arrow {
  font-size: 12px;
  color: #666;
  transition: transform 0.3s;
}

.dropdown-arrow.rotate {
  transform: rotate(180deg);
}

.color-trigger {
  padding: 12px 20px;
  color: white;
  text-align: center;
  border-radius: 6px;
  min-width: 100px;
}

.custom-trigger {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f5f5f5;
  border-radius: 20px;
}

.more-icon {
  width: 20px;
  height: 20px;
}

.action-menu {
  background: white;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.15);
  overflow: hidden;
  min-width: 120px;
}

.action-item {
  display: flex;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #f0f0f0;
}

.action-item:last-child {
  border-bottom: none;
}

.action-item:active {
  background: #f8f8f8;
}

.action-icon {
  width: 18px;
  height: 18px;
  margin-right: 12px;
}

.action-text {
  font-size: 16px;
  color: #333;
}
</style>
```

## 注意事项

1. **定位机制**：组件会自动检测屏幕边界，智能调整菜单位置
2. **动画效果**：内置了流畅的展开/收起动画
3. **点击关闭**：点击遮罩层会自动关闭菜单
4. **自定义菜单**：使用插槽时需要手动调用 `close()` 方法关闭菜单
5. **样式优先级**：`menuStyle` 属性只对默认菜单生效，插槽菜单需要自定义样式



### 插件如果对你有帮助给个好评吧~
