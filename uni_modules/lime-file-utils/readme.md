# lime-file-utils 文件工具组件
fileUtils 是一款可以轻松地在文件和 Base64 编码的数据之间进行转换的UTS API工具包，提供了文件与Base64、DataURL之间的相互转换功能，大大提高开发效率。适用于需要处理图片预览、文件上传、数据传输等场景。

> 插件依赖：无特殊依赖

## 文档链接
📚 组件详细文档请访问以下站点：
- [文件工具组件文档 - 站点1](https://limex.qcoon.cn/native/file-utils.html)
- [文件工具组件文档 - 站点2](https://limeui.netlify.app/native/file-utils.html)
- [文件工具组件文档 - 站点3](https://limeui.familyzone.top/native/file-utils.html)

## 安装方法
1. 在uni-app插件市场中搜索并导入`lime-file-utils`
2. 导入后可能需要重新编译项目
3. 在页面中通过import引入相关API

## 代码演示

### 基础用法
- APP是同步函数，非APP是Promise

```js
import { fileToDataURL, dataURLToFile, processFile, ProcessFileOptions  } from '@/uni_modules/lime-file-utils'
const url = ref('')
const src = ref('')
const base64 = `data:image/png;base64,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`

// #ifdef WEB || MP
fileToDataURL('/static/logo.png').then(res => {
	url.value = res
})
dataURLToFile(base64).then(res => {
	src.value = res
})
// #endif
// #ifdef APP
url.value = fileToDataURL('/static/logo.png') ?? ''
src.value = dataURLToFile(base64) ?? '';
// #endif

// 相当于 fileToDataURL
processFile({
	type: 'toDataURL',
	path: '/static/logo.png',
	success: (res: string)=>{
		url.value = res
	}
} as ProcessFileOptions)

// 相当于 dataURLToFile
processFile({
	type: 'toFile',
	path: base64,
	success: (res: string)=>{
		src.value = res
	}
} as ProcessFileOptions)
```


## fileToDataURL
将`文件`或`图片`转成 `URL（data URL）`,接收一个文件路径，APP 返回的是`DataURL`或`null`, 非APP 返回的是`Promise<string>`

```js
fileToDataURL(filePath : string) 
```

## fileToBase64
将`文件`或`图片`转成 `Base64`, 接收一个文件路径，APP 返回的是`Base64`或`null`, 非APP 返回的是`Promise<string>`

```js
fileToBase64(filePath : string) 
```

## dataURLToFile
将 `Base64` 编码的数据 `URL（data URL）`保存为临时路径，接收一个dataURL，参数`filename`为可选, APP返回的是`string`或`null`,非APP 返回的是`Promise<string>`

```js
dataURLToFile(dataURL : string, filename : NullableString = null)
```

## processFile
是上面三个函数的总和，接收`ProcessFileOptions`

```js
processFile({
	type: 'toBase64' | 'toDataURL' | 'toFile',
	path: string,
	filename?: string,//如果是toFile,则可以设置保存文件的文件名
	success ?: (res : string) {},
	fail ?: (res : any) {},
	complete ?: (res : any) {}
} as ProcessFileOptions)
```


## API文档

### 主要函数

| 函数名 | 说明 | 参数 | 返回值 |
| --- | --- | --- | --- |
| fileToDataURL | 将文件或图片转成DataURL | _filePath: string_ | APP: _string \| null_<br>非APP: _Promise\<string\>_ |
| fileToBase64 | 将文件或图片转成Base64 | _filePath: string_ | APP: _string \| null_<br>非APP: _Promise\<string\>_ |
| dataURLToFile | 将DataURL保存为临时文件 | _dataURL: string, filename?: string_ | APP: _string \| null_<br>非APP: _Promise\<string\>_ |
| processFile | 综合处理函数 | _options: ProcessFileOptions_ | _void_ |

### ProcessFileOptions 参数说明

| 属性名 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| type | 处理类型 | _'toDataURL' \| 'toBase64' \| 'toFile'_ | - |
| path | 文件路径或DataURL | _string_ | - |
| filename | 保存文件名(仅toFile类型可用) | _string_ | - |
| success | 成功回调函数 | _(res: string) => void_ | - |
| fail | 失败回调函数 | _(res: any) => void_ | - |
| complete | 完成回调函数 | _(res: any) => void_ | - |

## 使用注意事项

1. APP平台下函数是同步的，返回结果直接使用
2. 非APP平台(如H5、小程序)下函数是异步的，返回Promise
3. 在条件编译中需要注意区分平台差异
4. dataURLToFile函数的filename参数是可选的，如不提供会自动生成临时文件名
5. 处理大文件时可能会占用较多内存，请注意性能影响

## 平台差异说明

| 函数 | APP | H5 | 微信小程序 | 其他小程序 |
| --- | --- | --- | --- | --- |
| fileToDataURL | 同步 | 异步 | 异步 | 异步 |
| fileToBase64 | 同步 | 异步 | 异步 | 异步 |
| dataURLToFile | 同步 | 异步 | 异步 | 异步 |
| processFile | 支持 | 支持 | 支持 | 支持 |

## 支持与赞赏

如果你觉得本插件解决了你的问题，可以考虑支持作者：

| 支付宝赞助 | 微信赞助 |
|------------|------------|
| ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png) | ![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png) |