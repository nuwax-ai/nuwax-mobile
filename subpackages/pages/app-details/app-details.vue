<template>
  <chat-conversation-component @menu-click="onMenuClick" :is-app-details="true" />

  <!-- 使用封装好的弹框组件 -->
	<drawer-popup ref="popup" :show-header="false">
		<history-conversation-popup 
			:user="user"
			:chat-list="conversationList"
    />
	</drawer-popup>
</template>

<script setup lang="ts">
	import ChatConversationComponent from '@/subpackages/pages/chat-conversation-component/chat-conversation-component.vue'
	import { ref, reactive } from 'vue';
	import { onLoad } from "@dcloudio/uni-app";

  // 历史会话弹框
  import HistoryConversationPopup  from './history-conversation-popup/history-conversation-popup.vue'
	import DrawerPopup from '@/components/drawer-popup/drawer-popup.vue'
  
  // API调用
  import { SUCCESS_CODE } from '@/constants/codes.constants'
	import { t } from '@/utils/i18n'
	import { apiUserInfo } from '@/servers/account'
	import { apiUserUsedAgentList } from '@/servers/agentDev'
	import { apiAgentConversationList } from '@/servers/conversation'

	// 弹出层
	interface DrawerPopupRef {
		open: () => void
		close: () => void
	}

	const popup = ref<DrawerPopupRef | null>(null)
	// 当前智能体id
  const currentAgentId = ref<number | null>(null)

  // 弹出层数据状态
	const user = reactive<{avatar: string, nickname: string}>({
		avatar: "/static/logo.png",
		nickname: "--"
	});
  // 用户历史会话列表
	const conversationList = ref<ConversationInfo[]>([]);

	// 查询用户信息
	const fetchUserInfo = async () => {
		const {code, data} = await apiUserInfo()
		if(code === SUCCESS_CODE){
			if (data.avatar) {
				user.avatar = data.avatar
			}
			user.nickname = data.nickName || data.userName
		}
	}

  // 查询用户历史会话
	const fetchUserConversationList = async () => {
		const {code, data} = await apiAgentConversationList({agentId: currentAgentId.value})
		if(code === SUCCESS_CODE){
			conversationList.value = data
		}
	}

  onLoad((options) => {
    currentAgentId.value = options?.id ? Number(options.id) : null
  })

  // 打开菜单弹框
  const onMenuClick = async () => {
		try{
			await Promise.all([
				fetchUserInfo(),
				fetchUserConversationList()
			])
			popup.value?.open()
		} catch (error) {
			console.error(error)
		}
	}
</script>

<style lang="scss" scoped>
</style>