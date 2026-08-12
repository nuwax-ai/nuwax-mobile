# virtual-scroll-x

uni-app x 通用动态高度虚拟滚动组件。只渲染视口附近的列表项，视口外用占位高度代替，长列表常驻节点数从几千降到几十。

## 特性

- **动态高度**：每条独立高度，估算 + 实测 + 前缀和二分定位，滚动空闲时无感纠偏
- **内容变高重测**：think 展开、图片加载完成、内容编辑后 `notifyItemChanged(key)` 即收敛
- **顶部加载补偿**：聊天场景加载历史 `notifyPrepended(count)` 自动保持视角
- **流式跟底**：`stick-to-bottom` 末条恒挂载，逐 token 增高实时重测
- **视口比例化**：overscan / fling 迟滞均为视口倍数，不吃分辨率
- **平台实测**：App/H5 同步实测；微信小程序异步实测（同样收敛）
- **一键降级**：`enabled=false` 全量渲染，A/B 对比与问题回退零成本
- **全端**：App-Android/iOS（VDOM + 蒸汽）、鸿蒙 HarmonyOS、H5、微信小程序

## 快速开始

```vue
<virtual-scroll-x
  :items="messages"
  item-key="id"
  :estimated-height="90"
  :stick-to-bottom="streaming"
  @scrolltoupper="loadHistory"
>
  <template #default="{ item, index }">
    <view class="bubble">{{ item.text }}</view>
  </template>
</virtual-scroll-x>
```

`items` 每项可带 `__vh` 字段（number）作为单条估算高度，精度越高纠偏越少。

## 文档

完整 API（Props / Events / Methods / Slots）、集成模式、平台差异与已知限制见工程根目录 README.md。

## 注意

- 组件根节点 `height: 100%`，父容器必须有确定高度（flex 布局或固定高度）
- App 端纠偏写 scroll-top 时的视觉表现建议真机验收（低端机重点看连续上滑加载历史）
