# nuwax-virtual-list — uni-app x 动态高度虚拟滚动列表

> 虚拟滚动 + 动态高度 + list-view 全部功能，一套代码支持 **H5 / 微信小程序 / Android / iOS**。

与社区固定行高虚拟列表（hy-scroll-plus / nax-virtual-list 等）不同，本插件在**开启虚拟滚动的同时支持每项高度随内容变化**（流式 Markdown 增长、图片加载、折叠展开等场景），通过「实测高度 + 前缀和 + 滚动位置自动补偿」保证滚动稳定不跳动。

## 特性

- **虚拟滚动**：只渲染可视区 ± `buffer-count` 条，万级数据流畅滚动
  - H5 / 微信小程序：`scroll-view` + 撑杆 + 绝对定位可视窗口（自定义虚拟引擎）
  - App：默认走**原生 `list-view`**（原生 recycle + 原生动态高度）；`native-list="false"` 可切换为自定义虚拟引擎
- **动态高度**：未测量项用 `item-height` 预估，渲染后批量实测（H5 同步 DOM / 其余端 `createSelectorQuery`），按 key 缓存；视口上方内容高度变化时**自动补偿 scrollTop**，视觉稳定
- **兼容 list-view 全部功能**：
  - `scroll-top` 受控滚动（`scrollToY` 重复调用也生效，与 z-paging-x 同一技巧）
  - `scroll-with-animation` / `show-scrollbar` / `rebound` / `enable-back-to-top`
  - `refresher-*` 下拉刷新（App/小程序原生 refresher，H5 无原生实现）
  - `lower-threshold` / `upper-threshold` / `@scrolltoupper` / `@scrolltolower`
  - `list-id` 透传到滚动容器，`uni.getElementById(listId)` 可读 `scrollTop/scrollHeight/offsetHeight`
- **前插/流式友好**：首条 key 不变（追加/流式）时保留已测高度；前插历史时按 key 重灌高度，不跳动

## 平台

| 平台 | 虚拟滚动 | 动态高度 |
|---|---|---|
| H5 (Chrome/Safari) | √ 自定义引擎 | √ |
| 微信小程序 | √ 自定义引擎 | √ |
| Android / iOS（默认） | √ 原生 list-view recycle | √ 原生 |
| Android / iOS（`native-list=false`） | √ 自定义引擎 | √ |

## 快速开始

```html
<nuwax-virtual-list
  :data="list"
  :item-height="80"
  :buffer-count="10"
  key-field="id"
  :follow-bottom="true"
  style="height: 600px"
>
  <template #item="{ item, index }">
    <!-- item 为 any，建议在此处转业务类型后取字段 -->
    <view class="cell">
      <text>{{ index }} — {{ readField(item, 'title') }}</text>
    </view>
  </template>
</nuwax-virtual-list>
```

> H5 easycom 扫描不到时显式导入：
> `import NuwaxVirtualList from "@/uni_modules/nuwax-virtual-list/components/nuwax-virtual-list/nuwax-virtual-list.uvue";`

## Props

| 属性 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `data` | `Array<any>` | `[]` | 列表数据源（UTSJSONObject / 业务类实例均可） |
| `item-height` | `number` | `100` | 项预估高度(px)，仅作未测量项的初始估计 |
| `buffer-count` | `number` | `8` | 可视区外缓冲渲染条数 |
| `height` | `string` | `'100%'` | 容器高度 |
| `virtual-scroll` | `boolean` | `true` | 关闭则全量渲染（保留其余功能） |
| `native-list` | `boolean` | `true` | App 端是否用原生 list-view；H5/小程序忽略 |
| `key-field` | `string` | `''` | 稳定 key 字段（流式/前插场景务必设置） |
| `list-id` | `string` | `''` | 滚动容器 id（`uni.getElementById` 兼容） |
| `scroll-with-animation` | `boolean` | `false` | scroll-top 动画（可被方法 animate 参数覆盖） |
| `show-scrollbar` | `boolean` | `true` | 滚动条 |
| `rebound` | `boolean` | `true` | iOS 回弹 |
| `enable-back-to-top` | `boolean` | `false` | H5 回到顶部 |
| `lower-threshold` / `upper-threshold` | `number` | `50` / `0` | 触底/触顶距离 |
| `refresher-enabled` 等 | - | - | 下拉刷新透传 |
| `follow-bottom` | `boolean` | `false` | 虚拟模式下处底部时跟随内容增长滚底（聊天页由外层 ScrollManager 接管时应关） |
| `load-more-enabled` | `boolean` | `false` | 触底加载更多：触底自动 emit `loadmore`（含 H5 手动兜底 + 800ms 防抖） |
| `load-more-no-more` | `boolean` | `false` | 没有更多了：true 时停止触发 `loadmore`（最后一页后置 true） |
| `load-more-loading` | `boolean` | `false` | 请求中：true 时暂停触发 `loadmore`（请求期间置 true 防重复） |
| `init-scroll-to-bottom` | `boolean` | `false` | 初始即从底部渲染：首屏窗口直接定位内容底部（只渲染底部附近几条），测量后自动校准到真实底部。适合「进入即显示最后一条历史会话」——上方历史完全不创建 vnode，减少首屏渲染消耗 |

## Slots

| 插槽 | 作用域 | 说明 |
|---|---|---|
| `item` | `{ item, index }` | 列表项渲染（必填） |
| `empty` | - | 空状态 |
| `header` / `footer` | - | 随内容滚动的头/尾 |
| `refresher` | `{ refresherStatus }` | 自定义下拉刷新 |

## Methods（ref / $callMethod 调用）

| 方法 | 说明 |
|---|---|
| `scrollToY(y, animate)` | 滚动到指定位置(px) |
| `scrollToTop(animate)` / `scrollToBottom(animate)` | 顶 / 底 |
| `scrollToIndex(index, animate)` | 滚动到第 N 项（按偏移） |
| `scrollToOffset(offset, animate)` | 同 scrollToY |
| `getScrollTop(): number` | 当前滚动位置 |
| `getVisibleRange(): { start, end }` | 当前可视窗口 |
| `refreshSizes()` | 重新测量可视项（内容高度变化后调用） |
| `reload()` | 清测量缓存、回顶部 |

## Events

`@scroll`（标准 `UniScrollEvent`，含 `detail.scrollTop/scrollHeight`）、`@scrolltoupper`、`@scrolltolower`、`@visible-change="{start,end}"`、`@loadmore`、`@refresherrefresh` 等。

## 分页加载

**触底加载下一页（追加）**：开启 `load-more-enabled`，监听 `@loadmore` → 请求下一页 → 追加到 `data`。请求期间置 `load-more-loading`，最后一页后置 `load-more-no-more`：

```html
<nuwax-virtual-list
  :data="list"
  :load-more-enabled="true"
  :load-more-loading="loading"
  :load-more-no-more="noMore"
  @loadmore="onLoadMore"
>
  <template #item="sp">...</template>
</nuwax-virtual-list>
```

```ts
function onLoadMore(): void {
  loading = true;
  apiNextPage().then((page) => {
    list = [...list, ...page.items];
    noMore = page.isLast;
    loading = false;
  });
}
```

> 插件在滚动到底部时自动触发 `loadmore`（手动触底检测 + 原生 `scrolltolower` 双保险，兼容 H5 的 scrolltolower 不可靠问题），追加数据后按 key 保留已测高度，无需额外处理。

**顶部加载历史（前插）**：监听 `@scrolltoupper`（或自管触顶检测）→ 请求更早的分页 → **前插到 `data` 头部**。插件检测到首条 key 变化（前插）后自动补偿 scrollTop 保持视角：

```ts
function onScrollToUpper(): void {
  if (loadingHistory) return;
  loadingHistory = true;
  apiPrevPage().then((page) => {
    list = [...page.items, ...list]; // 前插，插件自动保持滚动视角
    loadingHistory = false;
  });
}
```

> 前插补偿分两步：先按预估高度立即补偿（视口不跳），测量完成后按实际高度精确校准。需正确设置 `key-field`（前插检测依赖首条 key）。

## 接入聊天页（drop-in 兼容说明）

插件接口面与 z-paging-x 对齐，可直接替换聊天页滚动容器：

- 把 `z-paging-x` 替换为 `nuwax-virtual-list`，传 `:data="messageList"`，`list-id="msg-list"` 保持不变 → `ScrollManager` 的 `uni.getElementById("msg-list")` 与 `scrollToY/scrollToBottom` 调用无需改动
- 原 `list-item :type` 结构改为 item 插槽内按消息类型分岔渲染（助手 `UniAiXMsg` / 用户气泡）
- 流式期 `messageList` 引用替换 → 插件增量测量，无需外部感知；高度变化后如需立刻修正可调 `refreshSizes()`
- App 端默认原生 list-view，与现状行为一致；H5/小程序自动获得虚拟滚动

## 原理

```
scroll-view（id=list-id，scroll-top 受控）
└─ .nvwl-pole（height = totalHeight，position: relative）      ← 撑杆
   └─ .nvwl-window（position: absolute; top = offsets[start]） ← 可视窗口
      └─ 仅渲染 [start, end) 的 list-item
```

1. `sizes[]` 每项有效高度（已实测/预估），`offsets[]` 前缀和，`totalHeight` 内容总高
2. 滚动时按 `scrollTop` 二分查找可视区间 `[start, end)`，只渲染窗口项
3. 渲染完成后批量测量（H5 同步 DOM；其余端 `createSelectorQuery().in(instance).selectAll()`），
   实测值按 `key-field` 缓存
4. 视口上方高度变化时 `scrollTop += Δoffset` 补偿，保持视觉稳定；`follow-bottom` 时滚底
5. 前插/流式：首条 key 未变则保留下标高度，变化则按 key 重灌 → 历史加载/流式追加不跳动

## 示例

- 演示页（本仓库）：`pages/test-virtual-list/test-virtual-list.uvue`
- 插件自带示例（可拷入宿主项目）：`example/pages/nuwax-virtual-list/index.uvue`
