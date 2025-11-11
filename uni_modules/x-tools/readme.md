# x-tools 工具库使用文档

x-tools 是基于 uni-app 打造的通用工具集合，覆盖通用工具函数、界面语法糖、路由导航、H5 与小程序专用能力等常见场景。所有模块均可单独按需引入，也可以通过主入口统一管理，帮助你在跨端项目中快速复用能力。

## 支持平台
- 微信小程序
- 支付宝小程序
- App（uni-app 运行时）
- H5 / Web

> 具体 API 是否可用需参考 uni-app 官方文档及平台限制，文档中带有 `#ifdef` 注释的能力仅在对应平台有效。

## 快速开始
1. 确保工程已经安装并同步 `uni_modules/x-tools` 模块。
2. 在需要的页面或模块中引入工具函数：

```javascript
import { promisify, countDown } from "@/uni_modules/x-tools/tools/index.js"
import { toast } from "@/uni_modules/x-tools/tools/sugar.js"
```

3. 对于 Vue2 项目，请在入口文件执行 `promisify()` 以启用 Promise 化支持。

## 模块总览

| 模块 | 文件路径 | 主要能力 |
| --- | --- | --- |
| 通用工具 | `tools/index.js` | Promise 包装、类型判断、页面信息、倒计时、轮询、深拷贝等 |
| 语法糖 | `tools/sugar.js` | 日志、提示、剪贴板、地图、客服、图片保存、表单校验等 |
| 路由导航 | `tools/router.js` | 路由跳转、事件通道数据透传、延时跳转 |
| H5 专用 | `tools/h5Utils.js` | 调试面板、URL 参数、公众号与生活号授权及支付 |
| 小程序专用 | `tools/appletUtils.js` | 视频号直跳、微信分享参数、场景值解析 |
| 异步重试 | `tools/retryAsync.js` | 支持退避策略的 Promise 重试工具 |
| 码工具 | `tools/codeUtil.js` | 扫码、编码与解码工具类 |
| 组件辅助 | `tools/com.js` | 通用组件属性定义、尺寸转换 |

## 通用工具（`tools/index.js`）

主入口导出了常用函数，并将其他工具模块聚合到命名空间中：

```javascript
import * as tools from "@/uni_modules/x-tools/tools/index.js"

const { sugar, router, h5Utils, appletUtils } = tools
```

### 基础能力
- `promisify()`：在 Vue2 项目中调用后，可让内置 `uni` API 返回 Promise，便于 `async/await` 调用。
- `isPromise(obj)`：判断目标是否符合 Promise 接口，常用于链式调用的防御性编程。
- `_typeof(value)`：返回更精确的类型字符串（如 `array`、`date`、`set`）。
- `sleep(ms)`：返回在指定毫秒后 resolve 的 Promise，用于节流、动画等待等场景。
- `deepClone(target, map?)`：支持 Map、Set、Symbol 等复杂结构的深拷贝工具，自动处理循环引用。

### 页面辅助
- `getCurrentPage()`：获取当前页面实例，等价于 `getCurrentPages().slice(-1)[0]`。
- `getCurrentPagePath(fullPath = false)`：返回当前页面路径，可选包含 query。
- `isTabBarPage(path?)`：判断当前页面或指定路径是否在 `pages.json` 的 tabBar 配置中。
- `getPageInfo()`：返回 `{ currentPage, startPage, isSharePage, pageStackLen }`，用于埋点与分享判断。

### 计时与轮询
- `countDown(endTime, callback, formatStr = "hh:mm:ss", refreshRate = 100)`：基于毫秒级刷新倒计时，`callback(info, isEnd)` 中的 `info` 带有格式化文本及 `d/h/m/s` 数据。
- `pollingForResult(fun, params, judgeFun, ms = 1000, timeout = 60000)`：轮询异步函数直到 `judgeFun` 返回 `success` 或 `fail`。
- `pollingForData(fun, params, callback, ms = 1000)`：持续轮询并在每次调用后触发回调，返回的函数可立即停止轮询。

```javascript
const timer = countDown("2025-12-31 23:59:59", ({ str }) => {
  this.countDownText = str
})

const task = () => api.getResult()
await pollingForResult(task, [], res => res.status === "OK" ? "success" : undefined)
```

### 模块聚合
`index.js` 将其他工具按命名空间导出，可通过 `router.navTo`、`sugar.toast` 等方式直接使用，便于统一管理依赖。

## 语法糖模块（`tools/sugar.js`）

### UI 与交互
- `toast(title, options?)`：封装 `uni.showToast`，默认 2 秒无图标，支持自定义 `icon` 与 `duration`。
- `previewImage(urls, current, options?)`：图片预览，自动接管失败回调。
- `saveImage(url, tips = true)`：支持 H5 下载和小程序或 APP 保存到相册，可选是否提示。
- `log(...args)`：`console.log` 简写。

### 系统能力
- `makePhoneCall(phoneNumber)`：拨打电话并输出失败日志。
- `openMap(lng, lat, name, address, options?)`：打开地图定位。
- `toCustomerService(corpId, url)`：跳转企业微信客服，支持微信小程序、APP、H5。
- `pageEvent.call(this)`：Vue2 页面获取事件通道，需绑定页面实例。

### 数据与表单
- `isEmpty(value)` 与 `hasEmptyField(obj, excludedKeys = [])`：识别空值与未填写字段，返回首个空字段路径。
- `setStorage(key, value)`：同步缓存。
- `object2queryStr(obj)`：对象转查询字符串，自动补齐 ? 与 &。
- `html2text(html)`：去除标签和实体。
- `dataMask(str, head, tail)`：按位数脱敏，可用于手机号或证件号。

### 其他辅助
- `upx2px(val)`：将 upx 或 rpx 转换成像素。
- `copy(str, options?)`：复制内容到剪贴板。
- `queryElementRect.call(this, selector)`：基于 `uni.createSelectorQuery` 获取元素布局信息，支持数组批量查询。

```javascript
import { toast, dataMask, hasEmptyField } from "@/uni_modules/x-tools/tools/sugar.js"

if (hasEmptyField(formData)) {
  toast("请完善表单信息")
}

const phone = dataMask("13800138000", 3, 4)
```

## 路由模块（`tools/router.js`）
- `navTo(url, options?, timeout = 0)`：普通页面跳转，可设置延时与额外参数。
- `redTo(url, timeout)`：`uni.redirectTo` 封装。
- `clearTo(url, timeout)`：`uni.reLaunch` 封装，清空页面栈。
- `tabTo(url, timeout)` 与 `shTab(url, timeout)`：跳转到 tabBar 页面。
- `navBack(timeout = 0, delta = 1)`：返回上一页。
- `navToAndEvent(url, data, acceptCallback?, timeout)`：跳转并通过事件通道传递数据，返回 Promise 获取回传值。
- `navBackAndEvent(eventChannel, backData, timeout, delta)`：在返回前向来源页面发送 `backData`。

```javascript
import { navToAndEvent, navBackAndEvent } from "@/uni_modules/x-tools/tools/router.js"

await navToAndEvent("/pages/detail/detail", { id: 1 }, res => {
  console.log("detail 返回数据", res)
})

const eventChannel = this.getOpenerEventChannel()
eventChannel.on("navData", data => {
  this.detailId = data.id
})
navBackAndEvent(eventChannel, { updated: true })
```

## H5 专用工具（`tools/h5Utils.js`）
- `debug(tip = true)`：动态加载 eruda 调试面板，失败时自动尝试多组 CDN。
- `getQueryParams(url?)`：解析 URL 查询字符串，默认读取当前地址。
- `judgeBrowser()`：识别浏览器环境，返回 `wx`、`ali` 或 `unknown`。
- `loadScript(src)`：动态注入 script，返回加载完成的节点。
- `getWxAuthCode(appId, state?, scope?)`：发起微信公众号 OAuth 授权，scope 默认为 `snsapi_base`。
- `wxConfig(params)`：基于签名参数配置 `jWeixin`，内部包含常用 API 列表。
- `wxPay(params)`：调用 `chooseWXPay` 发起公众号支付。
- `wxShare(params)`：设置好友与朋友圈分享信息。
- `getAliAuthCode(appId, scope?)`：支付宝生活号授权，支持 `auth_base` 与 `auth_user`。
- `aliPay(tradeNO)`：支付宝生活号支付封装。

```javascript
import { debug, getQueryParams, wxPay } from "@/uni_modules/x-tools/tools/h5Utils.js"

debug()
const { orderNo } = getQueryParams()
await wxPay(payParams)
```

## 小程序工具（`tools/appletUtils.js`）
- `toChannelsLive(finderUserName)`：在微信小程序内跳转视频号直播，自动提示错误信息。
- `getWxShareParams(queryParams?, title?, imageUrl?, path?)`：生成小程序分享配置，默认读取当前页面参数并补充标题与路径。
- `getSceneParams()`：解析小程序场景值（如扫码进入），内部复用 `h5Utils.getQueryParams` 处理 `scene`。

```javascript
import { getWxShareParams } from "@/uni_modules/x-tools/tools/appletUtils.js"

onShareAppMessage() {
  return getWxShareParams({ source: "invite" }, "邀请你加入", "/pages/index/index")
}
```

## 异步重试工具（`tools/retryAsync.js`）
`retryAsync(asyncFn, options)` 为任意 Promise 操作提供自动重试，支持自定义退避策略、超时控制与钩子。

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `maxRetries` | `3` | 最大允许的重试次数（不含首次执行）。 |
| `delay` | `1000` | 首次重试前的等待时间，单位毫秒。 |
| `backoffStrategy` | `fixed` | 退避策略：`fixed`、`exponential`、`linear`。 |
| `backoffFactor` | `2` | 指数退避或线性退避时的增长因子。 |
| `shouldRetry(error, attempt)` | `() => true` | 返回 `false` 可终止后续重试。 |
| `onRetry(error, attempt, max)` | `() => {}` | 每次准备重试时触发，可用于埋点。 |
| `timeout` | 空 | 单次任务超时时间，超时会抛出异常并进入重试流程。 |

```javascript
import { retryAsync } from "@/uni_modules/x-tools/tools/retryAsync.js"

const fetchWithRetry = () => retryAsync(() => api.fetchData(), {
  maxRetries: 5,
  backoffStrategy: "exponential",
  shouldRetry: (err, attempt) => err.code !== "INVALID_TOKEN",
  onRetry: (err, attempt) => console.log(`retry ${attempt}`, err.message)
})
```

## 码工具（`tools/codeUtil.js`）
- `new CodeUtil(codeTypeArray)`：实例化时声明支持的码类型（数组顺序即类型索引）。
- `codeUtil.scan(options?)`：调用 `uni.scanCode` 扫码。
- `codeUtil.getCodeInfo(options?)`：扫码并解析内置编码格式，返回 `{ type, content }`。
- `codeUtil.makeCode(type, content)`：生成带类型索引的 JSON 字符串，便于反向解析。
- `codeUtil.parseCode(codeInfo)`：解析任意字符串，返回码类型或错误信息。

```javascript
import { CodeUtil } from "@/uni_modules/x-tools/tools/codeUtil.js"

const codeUtil = new CodeUtil(["user", "product"])
const payload = codeUtil.makeCode("user", { id: 123 })
const info = codeUtil.parseCode(payload)
```

## 组件辅助（`tools/com.js`）
- `commonProps`：通用组件属性集合，包含 `bgColor`、`customStyle` 等常用配置，便于在多个组件复用。
- `str2px(str)`：将 `750rpx`、`100px`、`50` 等字符串转换成像素值，与 `sugar.upx2px` 配合使用可统一渲染尺寸。

```javascript
import { commonProps, str2px } from "@/uni_modules/x-tools/tools/com.js"

export default {
  props: {
    ...commonProps,
    width: {
      type: String,
      default: "750rpx"
    }
  },
  computed: {
    pixelWidth() {
      return str2px(this.width)
    }
  }
}
```

## 组合示例

```javascript
import { countDown, pollingForData } from "@/uni_modules/x-tools/tools/index.js"
import { toast, hasEmptyField } from "@/uni_modules/x-tools/tools/sugar.js"
import { navTo } from "@/uni_modules/x-tools/tools/router.js"

export default {
  data() {
    return {
      countdownText: "",
      form: { phone: "", code: "" }
    }
  },
  onLoad() {
    this.timerId = countDown(Date.now() + 5 * 60 * 1000, ({ str }, finished) => {
      this.countdownText = str
      if (finished) toast("倒计时结束")
    })

    this.stopPolling = pollingForData(() => api.checkStatus(), [], (err, res) => {
      if (res?.done) {
        this.stopPolling()
        navTo("/pages/result/result?id=" + res.id)
      }
    }, 2000)
  },
  methods: {
    submit() {
      if (hasEmptyField(this.form)) return toast("请填写完整")
    }
  },
  onUnload() {
    clearInterval(this.timerId)
    this.stopPolling && this.stopPolling()
  }
}
```

## 注意事项
- **平台差异**：带有 `#ifdef` 宏的函数仅在对应平台可用，调用前请先判断运行环境。
- **权限与授权**：保存图片、拨打电话、支付等能力需提前申请相应权限或签名。
- **网络依赖**：文件下载、远程支付等需要网络通畅并在 HTTPS 环境下运行。
- **错误处理**：工具内部会在失败时打印日志，建议在业务代码中补充 `try/catch` 或失败提示。
- **性能考量**：轮询与倒计时应适度释放资源，在页面卸载时清理定时器与停止函数。

## 更多信息
- 最新功能与修复请查看 `changelog.md`。
- 如需扩展工具模块，推荐在 `tools` 目录下新增文件并通过 `index.js` 统一导出。
