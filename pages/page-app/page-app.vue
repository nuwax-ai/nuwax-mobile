<template>
  <published-agent-list
    agentType="PageApp"
    :title="t('Mobile.Nav.app')"
  ></published-agent-list>
</template>

<script setup lang="ts">
  import PublishedAgentList from '@/components/published-agent-list/published-agent-list.vue'
  import { onAddToFavorites } from '@dcloudio/uni-app'
  import { useI18n } from "@/utils/i18n";

  const { t } = useI18n();

  // 收藏
  onAddToFavorites(()=>{
      return {
          title: t("Mobile.Nav.app"),
      }
  })
</script>

<style lang="scss" scoped>

</style>
