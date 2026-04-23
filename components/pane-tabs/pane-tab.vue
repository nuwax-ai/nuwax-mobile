<template>
  <view class="pane-tab">
    <slot></slot>
  </view>
</template>

<script setup lang="ts">
  import { inject, onMounted, watch, onUnmounted, type Ref } from "vue";
  // Props 定义
  interface Props {
    tab: string; // 标签文字
    keyValue: string; // 唯一标识
    forceRender?: boolean; // 是否强制渲染
  }

  const props = withDefaults(defineProps<Props>(), {
    forceRender: false,
  });

  // 从父组件注入 paneTabs
  const paneTabs = inject<any>("paneTabs");

  // 组件挂载时注册到父组件
  onMounted(() => {
    if (paneTabs != null && (paneTabs as any).registerTab != null) {
      const registerFn = (paneTabs as any).registerTab as (item : any) => void;
      registerFn({
        key: props.keyValue,
        label: props.tab,
        forceRender: props.forceRender,
      });
    }
  });

  // 监听标题变化，实时更新父组件中的标签信息
  watch(() => props.tab, (newTab : string) => {
    if (paneTabs != null && (paneTabs as any).tabs != null) {
      const tabsRef = (paneTabs as any).tabs as Ref<any[]>;
      tabsRef.value.forEach((t : any) => {
        if (t.key == props.keyValue) {
          t.label = newTab;
        }
      });
    }
  });

  // 组件卸载时从父组件注销
  onUnmounted(() => {
    if (paneTabs && paneTabs.unregisterTab) {
      paneTabs.unregisterTab(props.keyValue);
    }
  });
</script>

<style lang="scss" scoped>
  .pane-tab {
    flex: 0 0 auto;
    width: 100vw; // 占满视口宽度
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-sizing: border-box;
  }
</style>
