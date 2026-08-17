# DCloud Bug 报告：uni-app x iOS 端 web-view 反复创建/销毁导致必现崩溃（iOS 26）

> 状态：待提交至 ask.dcloud.net.cn / dcloudio/uni-app issues
> 附件：崩溃日志 .ips ×15（`unpackage/logs/ios/00008140-000C1D01028B001C/`）

## 标题

【uni-app x】【iOS 26】web-view 组件反复创建/销毁（v-if 挂载/卸载）约 5 轮后必现崩溃：WebKit WebBackForwardList/FrameState IPC 内存损坏（EXC_BAD_ACCESS / pas_panic）

## 环境

| 项 | 值 |
|---|---|
| HBuilderX | 5.24（5.24.12949 运行时） |
| 框架 | uni-app x（uvue，非 vue 兼容模式） |
| 打包形态 | 自定义基座（iOS_debug.ipa）与 云打包（Dev/正式）**均复现** |
| 设备 | iPhone 16（iPhone17,3） |
| 系统 | iOS 26.6 (23G71)；7 月在 iOS 26.5 亦有同族崩溃记录 |
| 业务代码 | **与业务无关**（见最小复现） |

## 最小复现步骤

1. 新建 uni-app x 项目，加入以下测试页并注册路由
2. iOS 真机（iOS 26.x）运行
3. 点击「A: 纯建销 ×20」按钮
4. **约第 4~5 轮 mount 时应用崩溃**（实测日志：第 5 轮 `mount` 后进程死亡）

## 最小复现代码

```vue
<!-- pages/test-webview-crash/test-webview-crash.uvue（节选核心；完整文件见仓库） -->
<template>
  <view>
    <button @click="runChurn">A: 纯建销 ×20</button>
    <web-view v-if="wvAlive" id="crash-test-wv" :src="wvSrc" @load="onWvLoad" />
  </view>
</template>
<script setup lang="uts">
  const wvAlive = ref<boolean>(false);
  const wvSrc = ref<string>("https://任意真实页面/"); // 实测用自有 H5 站点

  async function runChurn(): Promise<void> {
    for (let i = 1; i <= 20; i++) {
      console.log(`[wv-crash-test] A cycle${i} mount`);
      wvAlive.value = true;          // 挂载 web-view
      await sleep(1500);             // 等待 @load（真实页面加载完成）
      console.log(`[wv-crash-test] A cycle${i} unmount`);
      wvAlive.value = false;         // 卸载
      await sleep(400);
    }
  }
</script>
```

无任何 evalJS / postMessage / 页面导航脚本干预，仅组件挂载与卸载。

## 崩溃特征（15 份 .ips 签名一致）

崩溃线程 = 主线程，栈顶二选一：

```
WebKit  WebKit::WebBackForwardList::didReceiveMessage(IPC::Connection&, IPC::Decoder&)
  → IPC::ArgumentCoder<WebKit::FrameState>::decode
    → JSC WTF::AtomStringImpl::addSlowCase → WTF::StringImpl::hashSlowCase  [EXC_BAD_ACCESS]
  或
  → WebKit::FrameState::~FrameState()
    → bmalloc … pas_bitfit_page_deallocation_did_fail → pas_panic        [EXC_BREAKPOINT 堆损坏]
```

崩溃地址呈「文本字节被当指针」特征（如 `0x3a7374633a673a74`），典型内存损坏。同设备同版本下：JSC Inspector 析构、NSLog 僵尸对象等其他内存损坏签名零星出现（附件含 7 月样本）。

## 已排除的要素（均为有效二进制样本验证）

- 业务代码 / H5 页面内容：最小复现无业务代码
- 脚本注入（evalJS/postMessage）：纯建销即崩
- 卸载时机：先卸载再延时 150/300ms 导航、防重入加固，无效
- 页面缓存（enablePageCache）：无效
- 加载内容换成静态资源：仍崩

## 参考

- react-native-webview #3918「iOS crash: EXC_BAD_ACCESS in iOS 26+ when mounting/dismounting WebView」同族（iOS 26 WKWebView 挂载/卸载回归）
- Apple Developer Forums thread 823093

## 请求

1. 确认 uni-app x iOS 运行时在 WKWebView 释放路径上的处理（是否可在 dealloc 前断开 navigationDelegate/uiDelegate / 延迟释放）
2. 给出临时规避方案（除「永不销毁 webview」外）
3. 修复版本与时间线

## 联系

团队：nuwax（女娲智能体移动端，App Store 提审被此项阻塞）
