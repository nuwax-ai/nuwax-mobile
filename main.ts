import App from './App.vue'

import { createSSRApp } from 'vue'
import { bootstrapI18nCache, t } from '@/utils/i18n'
export function createApp() {
	bootstrapI18nCache()
	const app = createSSRApp(App)
	app.config.globalProperties.$t = t
	return {
		app
	}
}
