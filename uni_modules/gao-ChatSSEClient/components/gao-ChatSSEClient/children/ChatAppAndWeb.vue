<script>
export default {
  props: {
    timeout: {
      type: Number,
    },
    heartbeatTimeout: {
      type: Number, 
    },
    maxRetryCount: {
      type: Number,
    }
  },
  data() {
    return {
      stopCount: 0,
      renderjsData: {
        url: "",
        key: 0,
        body: "",
        method: "",
        timeout: this.timeout,
        heartbeatTimeout: this.heartbeatTimeout,
        maxRetryCount: this.maxRetryCount
      }
    }
  },
  watch: {
    timeout(newVal) {
      this.renderjsData.timeout = newVal;
    },
    heartbeatTimeout(newVal) {
      this.renderjsData.heartbeatTimeout = newVal;
    },
    maxRetryCount(newVal) {
      this.renderjsData.maxRetryCount = newVal;
    }
  },
  methods: {
    stopChat() {
      this.stopCount += 1
    },
    /**
     * 开始chat对话
     */
    startChat(config) {
      const { body } = config;
      this.renderjsData = Object.assign({}, this.renderjsData, {
        key: this.renderjsData.key + 1,
        ...config,
        body: body ? JSON.stringify(body) : 0,
        timeout: config.timeout || this.timeout,
        heartbeatTimeout: config.heartbeatTimeout || this.heartbeatTimeout,
        maxRetryCount: config.maxRetryCount || this.maxRetryCount
      });
    },

    open(...args) {
      this.$emit("onInnerOpen", ...args)
    },
    message(msg) {
      this.$emit("onInnerMessage", msg)
    },
    error(...args) {
      this.$emit("onInnerError", ...args)
    },
    finish() {
      this.$emit("onInnerFinish")
    },
    onRetryuUpperlimit() {
      this.$emit("onInnerRetryuUpperlimit")
    }
  },
}
</script>

<script module="chat" lang="renderjs">
import { fetchEventSource } from '../fetch-event-source';

export default {
	data() {
		return {
			ctrl: null,
		}
	},
	methods: {
    objToJson(obj) {
      const json = {};
      for (const key in obj) {
        const val = obj[key];
        if (typeof val === "string" || typeof val === 'number' || typeof val === 'boolean') {
          json[key] = val;
        } else {
          json[key] = val.toString();
        }
      }
      return json;
    },

		/**
		 * 停止生成
		 */
		stopChatCore() {
			this.ctrl?.abort();
		},

		/**
		 * 开始对话
		 */
		startChatCore(data) {
		  const { url, body, headers, method, timeout, heartbeatTimeout, maxRetryCount } = data;
			if (!url) return;
			console.log(data)
			
			try {
				this.ctrl = new AbortController();
				fetchEventSource(
					url,
					{
						readJson: true,
						method,
						openWhenHidden: true,
						signal: this.ctrl.signal,
						timeout: timeout || 300000,
						heartbeatTimeout: heartbeatTimeout || 120000,
						headers: {
							"Content-Type": "application/json",
							...headers,
						},
						body: body ? body : undefined,
						onopen: (response) => {
							this.$ownerInstance.callMethod('open', this.objToJson(response));
						},
						onmessage: (data) => {
							this.$ownerInstance.callMethod('message', data);
						},
						onRetryuUpperlimit: () => {
							this.$ownerInstance.callMethod('onRetryuUpperlimit');
						},
						onerror: (err) => {
							console.error('❌ SSE连接错误:', err);
							this.$ownerInstance.callMethod('error', JSON.stringify(err));
							return 3000; // 3秒后重试
						},
					}, {
            maxRetryCount,
          }).then(() => {
						this.$ownerInstance.callMethod('finish');
					}).catch(err => {
						console.error('💥 SSE连接异常:', err);
						this.$ownerInstance.callMethod('error', err);
					})
			} catch (e) {
				console.error('🚨 启动SSE连接时出现异常:', e);
			}
		}
	}
}
</script>

<template>
  <view
    :renderjsData="renderjsData"
    :change:renderjsData="chat.startChatCore"
    :stopCount="stopCount"
    :change:stopCount="chat.stopChatCore"
  />
</template>