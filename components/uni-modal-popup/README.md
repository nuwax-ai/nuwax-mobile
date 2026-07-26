# uni-modal-popup

基于 uni-app x 内置 [`page-container`](https://doc.dcloud.net.cn/uni-app-x/component/page-container.html) 的弹窗容器。  
用于替代 App 端不稳定的 `uni-popup`（本仓库旧组件见 `components/modal-popup`）。

## 能力

- 内容居中（默认 `position="center"`）
- 多方向：`top` / `bottom` / `left` / `right` / `center`
- 标题栏、关闭按钮、`header-extra` 插槽
- 遮罩点击关闭、底部下滑关闭
- `open` / `close`（`defineExpose`，Android 请用 `$callMethod`）

## 示例

```uvue
<template>
  <uni-modal-popup ref="modalRef" title="详情" position="center" :enable-swipe-close="false">
    <template #header-extra>
      <view @tap="onCopy">复制</view>
    </template>
    <view>弹窗内容</view>
  </uni-modal-popup>
</template>

<script setup lang="uts">
  import { ref, type ComponentPublicInstance } from "vue";
  import UniModalPopup from "@/components/uni-modal-popup/uni-modal-popup.uvue";

  const modalRef = ref<any | null>(null);

  const open = (): void => {
    const modal = modalRef.value;
    if (modal == null) return;
    (modal as ComponentPublicInstance).$callMethod("open");
  };
</script>
```

## 注意

- 微信小程序同页仅允许 1 个 `page-container`
- 居中弹出默认全屏：`custom-style` 保持透明全屏，宽度加在内容面板上，由内部 flex 居中；点空白区域关闭
- 请勿与旧 `modal-popup`（uni-popup）混用同一交互路径
