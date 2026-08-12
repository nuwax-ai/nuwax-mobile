## 0.1.0（2026-08-10）

首个版本。从 nuwax-mobile 生产环境 `VirtualScrollManager` 提炼为通用插件：

- 引擎层（engine.uts）与组件层（virtual-scroll-x.uvue）分离
- 动态高度：估算 + 批量实测 + 前缀和 + 二分定位 + 空闲纠偏
- `notifyItemChanged(key)` 内容变高重测（相对生产版的修复）
- `notifyPrepended(count)` 内置顶部加载 scrollTop 补偿
- overscan / 迟滞按视口高度倍数（相对生产版固定 px 的修复）
- 微信小程序异步实测通道（相对生产版 MP 实测断裂的修复）
- 实测 0 高度有限重试，静止页面不漏测
