# FilePreview 组件移动端适配评估报告

## 1. 总体评估
**结论**：**无法直接复用代码**，需要完全重写。
**原因**：原组件基于 React + Ant Design，且核心文件预览功能依赖于 DOM 操作库（`@js-preview/*`），这在微信小程序（无 DOM 环境）中完全不可用。

## 2. 核心功能适配方案

### 2.1 Office 文档 (Word/Excel/PPT/PDF)
*   **PC 实现**：使用 `@js-preview/docx`, `@js-preview/excel`, `@js-preview/pdf` 等库，在 DOM 容器中渲染。
*   **移动端难点**：小程序无 DOM，且手机屏幕小，复杂的 JS 渲染库性能差且兼容性极难保证。
*   **推荐方案**：使用微信/Uniapp 原生能力。
    1.  **uni.downloadFile**：先将文件下载到本地临时路径。
    2.  **uni.openDocument**：调用系统自带的文档查看器打开。体验最好，性能最高，且无需引入庞大的 JS 库。

### 2.2 Markdown / HTML
*   **PC 实现**：`react-markdown`, `iframe`。
*   **移动端/小程序方案**：项目已集成 **`mp-html`** 组件。
    *   直接复用 `mp-html` 渲染 Markdown (需开启 markdown 插件) 和 HTML 内容。
    *   H5 端也可使用 `mp-html` 保持一致性。

### 2.3 多媒体 (图片/视频/音频)
*   **PC 实现**：`<img>`, `<video>`, `<audio>` 标签。
*   **移动端/小程序方案**：
    *   图片：`preview-image` 组件或 `uni.previewImage` API（支持手势缩放、保存）。
    *   视频：`<video>` 原生组件。
    *   音频：`<audio>` 原生组件或 `uni.createInnerAudioContext` API。

### 2.4 代码/纯文本
*   **PC 实现**：`<pre><code>`。
*   **移动端/小程序方案**：
    *   简单查看：`<text>` + `<scroll-view>`，配合 `white-space: pre-wrap`。
    *   富文本高亮：通过 `mp-html` 的 markdown 插件支持代码高亮。

## 3. UI 适配
*   **Ant Design** -> **uni-ui / 原生组件**：
    *   `Button` -> `<button>` 或 `uni-tag`
    *   `Spin` -> `uni-load-more` 或 `<loading>`
    *   `Alert` -> `uni.showToast/Modal` 或自定义提示区域
    *   图标 -> `uni-icons` 或 SVG/Font 资源

## 4. 依赖库处理
| PC 库 | 移动端状态 | 替代方案 |
| :--- | :--- | :--- |
| `react-markdown` | ❌ 不可用 | `mp-html` |
| `@js-preview/*` (docx/excel/pdf) | ❌ 不可用 (依赖 DOM) | `uni.openDocument` |
| `pptx-preview` | ❌ 不可用 (依赖 DOM) | `uni.openDocument` |
| `antd` | ❌ 不可用 | `uni-ui` / 原生 |

## 5. 建议实施步骤
1.  **新建组件**：在 `uni_modules` 或 `components` 下新建 `file-preview` 组件。
2.  **类型判断**：复用原组件的 `getExtension` 等工具函数（需移除 DOM 相关逻辑），判断文件类型。
3.  **分流渲染**：
    *   **Office/PDF**：渲染为一个"点击预览"的卡片文件（类似微信聊天记录中的文件气泡），点击后触发 `uni.downloadFile` -> `uni.openDocument`。
    *   **Image**：直接显示缩略图，点击调用 `uni.previewImage`。
    *   **Audio/Video**：使用原生组件直接渲染。
    *   **Text/MD/HTML**：使用 `<mp-html>` 渲染。
4.  **下载/另存为**：小程序中 `uni.saveFile` (保存到本地) 或 `uni.opensDocument` (右上角菜单转发/保存)。

## 6. 代码复用度
可复用的逻辑仅限于纯 TS 工具函数：
*   文件扩展名获取
*   MIME 类型映射
*   大致的渲染状态管理逻辑 (Loading/Error/Success)

其余 UI 和渲染层需全部重写。
