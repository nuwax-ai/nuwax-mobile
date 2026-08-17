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

## 最小复现步骤（四场景矩阵，`pages/test-webview-crash/`，commit 2a600c2f+）

测试页加载 `https://baidu.com`（中性第三方页面），四按钮对照：

| 场景 | 操作 | 结果 |
|---|---|---|
| A 纯建销 ×50 | 仅 v-if 挂载/卸载，无脚本 | **安全**（50 轮完成） |
| B pushState 风暴 ×200 | 单 webview 常驻，`history.pushState` 每 30ms | **安全** |
| C 混合 | 建销 + 每轮 10× pushState | **崩溃**（约 2~5 轮） |
| D C+熄火 | C 同款，卸载前停止 pushState 静默 600ms | **崩溃**（第 3 轮 pushState 阶段，即上一轮卸载完成后） |

**结论：崩溃 = web-view 销毁 × 活跃 history/BFL 的组合，二者缺一不可；销毁前静默（600ms）无法避免** —— 指向销毁后 WebContent 进程仍异步回传 BackForwardList 状态（栈中 `WebProcessProxy::didReceiveMessage`），与已释放的 UI 侧接收器竞态。加载本方 H5（uni-app H5 hash 路由，加载即有 history 流量）时同样复现且更快（约 5 轮内）。

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

- 业务代码 / H5 页面内容：中性第三方页面（baidu.com）同样复现
- 纯建销本身：安静页面 50 轮建销安全
- 纯 BFL 流量：常驻 webview 200 次 pushState 安全
- **销毁前静默 600ms（熄火协议）：无效**（D 场景第 3 轮仍崩）
- 卸载时机：先卸载再延时 150/300ms 导航、防重入加固，无效
- 页面缓存（enablePageCache）：无效

## 参考

- **DCloud 反馈 #32189**（2026-08-17 14:10，状态：待确认/沟通中）：「【App-iOS】后台切回前台发生批量 SIGPIPE，主线程集中在 WebKit/JavaScriptCore」，5.24 运行时 —— **疑似同族**（同为 iOS + 5.24 + WebKit/JSC 主线程崩溃，触发路径不同：本 issue 为 web-view 建销，彼为前后台切换）。建议合并排查。
- react-native-webview #3918「iOS crash: EXC_BAD_ACCESS in iOS 26+ when mounting/dismounting WebView」同族（iOS 26 WKWebView 挂载/卸载回归）
- Apple Developer Forums thread 823093

## 请求

1. 确认 uni-app x iOS 运行时在 WKWebView 释放路径上的处理（是否可在 dealloc 前断开 navigationDelegate/uiDelegate / 延迟释放）
2. 给出临时规避方案（除「永不销毁 webview」外）
3. 修复版本与时间线

## 联系

团队：nuwax（女娲智能体移动端，App Store 提审被此项阻塞）
