# lime-file-utils
- fileUtils 是一款可以轻松地在文件和 Base64 编码的数据之间进行转换，从而提高开发效率的UTS API工具包

## 文档
 🚀 [file-utils【站点1】](https://limex.qcoon.cn/native/file-utils.html)
 🌍 [file-utils【站点2】](https://limeui.netlify.app/native/file-utils.html)
 🔥 [file-utils【站点3】](https://limeui.familyzone.top/native/file-utils.html)


## 安装
插件市场导入即可


## 使用
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


## 打赏

如果你觉得本插件，解决了你的问题，赠人玫瑰，手留余香。  
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png)
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png)