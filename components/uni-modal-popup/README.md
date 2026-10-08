# uni-modal-popup

基于 uni-app x 内置 [`page-container`](https://doc.dcloud.net.cn/uni-app-x/component/page-container.html) 的弹窗容器。

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

- APP-Android：`center/top/bottom` 的蒙层触摸由内容层近透明 tap-mask 整链接管（三星 One UI 对带位移的按压不派发原生 `clickoverlay`，微移还会触发原生下滑手势致蒙层/面板闪动）——在本组件上按下并完整抬起（touchend/touchcancel）即关闭，无位移判定
- 微信小程序同页仅允许 1 个 `page-container`（勿与其他 page-container 弹层叠用）
- 居中弹出默认全屏：`custom-style` 保持透明全屏，宽度加在内容面板上，由内部 flex 居中；点空白区域关闭
