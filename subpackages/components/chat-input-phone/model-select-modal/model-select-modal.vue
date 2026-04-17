<template>
  <radio-list-drawer
    :visible="visible"
    :title="t('Mobile.Chat.modelSelect')"
    :list="modelOptions"
    :current-value="currentModelId.toString()"
    :readonly="readonly"
    :loading="isLoading"
    @onClose="handleClose"
    @onChange="handleModelChange"
  />
</template>

<script lang="ts" setup>
  import { ref, watch, onMounted } from 'vue';
  import { AgentModelOption } from "@/types/interfaces/agent";
  import { AgentTypeEnum } from "@/types/enums/agent";
  import { RadioListItem } from "@/types/interfaces/radio";
  import RadioListDrawer from "@/components/radio-list-drawer/radio-list-drawer.vue";
  import { apiGetAgentModelOptions } from "@/servers/agentDev";
  import { SUCCESS_CODE } from "@/constants/codes.constants";
  import { t } from "@/utils/i18n";

  const props = withDefaults(
    defineProps<{
      visible: boolean;
      agentId: number;
      agentType: AgentTypeEnum;
      currentModelId: number;
      readonly?: boolean;
    }>(),
    {
      visible: false,
      readonly: false,
    },
  );

  const emit = defineEmits<{
    onClose: () => void;
    onModelChange: (modelId: number) => void;
  }>();

  const modelOptions = ref<RadioListItem[]>([]);
  const isLoading = ref(false);

  // 获取并过滤模型列表
  const fetchModelOptions = async () => {
    isLoading.value = true;
    try {
      modelOptions.value = [];
      const res = await apiGetAgentModelOptions(props.agentId);
      if (res.code === SUCCESS_CODE && res.data) {
        
        const filteredModels = res.data.filter((model: AgentModelOption) => {
          // 根据 usageScenarios 包含当前智能体类型来判断是否显示
          return model.usageScenarios?.includes(props.agentType);
        });

        modelOptions.value = filteredModels.map((model: AgentModelOption) : RadioListItem => {
          return {
            label: model.name,
            value: model.id.toString(),
            desc: model.description || '',
            disabled: false,
          } as RadioListItem;
        });

        // 如果当前没有选中模型，则默认选中第一个
        if (props.currentModelId === 0 && modelOptions.value.length > 0) {
          handleModelChange(modelOptions.value[0].value);
        }
      }
    } catch (error) {
      console.error("[model-select-modal] 获取模型选项失败:", error);
    } finally {
      isLoading.value = false;
    }
  };

  const handleClose = () => {
    emit("onClose");
  };

  const handleModelChange = (value: string) => {
    const item = modelOptions.value.find((i) => i.value === value);
    emit("onModelChange", parseInt(value), item?.label || "");
  };

  watch(() => props.visible, (newVal) => {
    if (newVal) {
      fetchModelOptions();
    }
  });

  // 初始化加载数据，以便在外部显示首项名称（即使弹窗未打开）
  onMounted(() => {
    fetchModelOptions();
  });
</script>

<style lang="scss" scoped>
</style>
