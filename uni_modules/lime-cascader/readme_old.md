# lime-cascader 级联选择
- 级联选择 用于多层级数据选择，主要为树形结构，可展示更多的数据。兼容uniapp/uniappx
- 插件依赖`lime-popup`,`lime-style`,`lime-shared`,`lime-tabs`,`lime-icon`,`lime-svg`，不喜勿下。

## 文档
[cascader](https://limex.qcoon.cn/components/cascader.html)

## 安装
插件市场导入即可，首次导入可能需要重新编译

**注意** 
* 🔔 本插件依赖的[lime-svg](https://ext.dcloud.net.cn/plugin?id=18519)在 uniapp x app中是原生插件，如果购买(收费为5元)则需要自定义基座，才能使用！uniapp可忽略。
* 🔔 如果不需要[lime-svg](https://ext.dcloud.net.cn/plugin?id=18519)在lime-icon代码中注释掉即可

```html
// lime-icon/components/l-icon.uvue 第4行 注释掉即可。
<!-- <l-svg class="l-icon" :class="classes" :style="styles" :color="color" :src="iconUrl" v-else :web="web" @error="imageError" @load="imageload" @click="$emit('click')"></l-svg> -->
```


## 代码演示
示例使用了`uts`及`vue3 setup`，`uniapp`可以把数据类型去掉即可。

### 基础使用
级联选择组件通过设置`visible`弹出选择器。
```html
<view class="cell" @click="visible = true">
	<text>地址</text>
	<text v-show="fieldValue == null" style="color: #999;">请选择地址 ></text>
	<text v-show="fieldValue != null">{{fieldValue}}</text>
</view>
<l-cascader 
	v-model:visible="visible" 
	v-model="cascaderValue" 
	:options="options" 
	title="请选择所在地区" 
	@change="onChange"/>
```
```js
const visible = ref(false)
// 设置默认值，如 110000
const cascaderValue = ref('');
const fieldValue = ref<string|null>(null);
// 选项列表，children 代表子选项，支持多级嵌套
const options = [
	{
		label: '北京市',
		value: '110000',
		children: [
			{
				value: '110100',
				label: '北京市',
				children: [
					{ value: '110101', label: '东城区' },
					{ value: '110102', label: '西城区' },
					{ value: '110105', label: '朝阳区' },
					{ value: '110106', label: '丰台区' },
					{ value: '110107', label: '石景山区' },
					{ value: '110108', label: '海淀区' },
					{ value: '110109', label: '门头沟区' },
					{ value: '110111', label: '房山区' },
					{ value: '110112', label: '通州区' },
					{ value: '110113', label: '顺义区' },
					{ value: '110114', label: '昌平区' },
					{ value: '110115', label: '大兴区' },
					{ value: '110116', label: '怀柔区' },
					{ value: '110117', label: '平谷区' },
					{ value: '110118', label: '密云区' },
					{ value: '110119', label: '延庆区' },
				],
			},
		],
	},
	{
		label: '天津市',
		value: '120000',
		children: [
			{
				value: '120100',
				label: '天津市',
				children: [
					{ value: '120101', label: '和平区' },
					{ value: '120102', label: '河东区' },
					{ value: '120103', label: '河西区' },
					{ value: '120104', label: '南开区' },
					{ value: '120105', label: '河北区' },
					{ value: '120106', label: '红桥区' },
					{ value: '120110', label: '东丽区' },
					{ value: '120111', label: '西青区' },
					{ value: '120112', label: '津南区' },
					{ value: '120113', label: '北辰区' },
					{ value: '120114', label: '武清区' },
					{ value: '120115', label: '宝坻区' },
					{ value: '120116', label: '滨海新区' },
					{ value: '120117', label: '宁河区' },
					{ value: '120118', label: '静海区' },
					{ value: '120119', label: '蓟州区' },
				],
			},
		],
	},
];
 // 全部选项选择后，会触发 change 事件
const onChange = (value: string, options: UTSJSONObject[]) => {
	fieldValue.value = options.map((item: UTSJSONObject):any|null => (item['label'])).join('/');
};
```


### 带初始值
通过设置`value`或`v-model`设置默认值，选择项的值

```html
<view class="cell" @click="visible2 = true">
	<text>地址</text>
	<text v-show="fieldValue2 == null" style="color: #999;">请选择地址 ></text>
	<text v-show="fieldValue2 != null">{{fieldValue2}}</text>
</view>
<l-cascader 
	v-model:visible="visible2" 
	v-model="cascaderValue2" 
	:options="options2" 
	title="请选择所在地区" 
	@change="onChange2"/>
```
```js
const visible2 = ref(false)
// 设置默认值
const cascaderValue2 = ref('120119');
const fieldValue2 = ref<string|null>(null);
const options2 = areaList;
const onChange2 = (value: string, options: UTSJSONObject[]) => {
	fieldValue2.value = options.map((item: UTSJSONObject):any|null => (item['label'])).join('/');
};
```

### 自定义字段名
通过设置`keys`属性可以自定义 `options` 里的字段名称
```html
<view class="cell" @click="visible3 = true">
	<text>地址</text>
	<text v-show="fieldValue3 == null" style="color: #999;">请选择地址 ></text>
	<text v-show="fieldValue3 != null">{{fieldValue3}}</text>
</view>
<l-cascader 
	v-model:visible="visible3" 
	v-model="cascaderValue3" 
	:options="options3" 
	:keys="keys"
	title="请选择所在地区" 
	@change="onChange3"/>
```
```js
const visible3 = ref(false)
const cascaderValue3 = ref('');
const fieldValue3 = ref<string|null>(null);
const options3 = [
	{
		name: '北京市',
		code: '110000',
		items: [
			{
				code: '110100',
				name: '北京市',
				items: [
					{ code: '110101', name: '东城区' },
					{ code: '110102', name: '西城区' },
					{ code: '110105', name: '朝阳区' },
					{ code: '110106', name: '丰台区' },
					{ code: '110107', name: '石景山区' },
					{ code: '110108', name: '海淀区' },
					{ code: '110109', name: '门头沟区' },
					{ code: '110111', name: '房山区' },
					{ code: '110112', name: '通州区' },
					{ code: '110113', name: '顺义区' },
					{ code: '110114', name: '昌平区' },
					{ code: '110115', name: '大兴区' },
					{ code: '110116', name: '怀柔区' },
					{ code: '110117', name: '平谷区' },
					{ code: '110118', name: '密云区' },
					{ code: '110119', name: '延庆区' },
				],
			},
		],
	},
	{
		name: '天津市',
		code: '120000',
		items: [
			{
				code: '120100',
				name: '天津市',
				items: [
					{ code: '120101', name: '和平区' },
					{ code: '120102', name: '河东区' },
					{ code: '120103', name: '河西区' },
					{ code: '120104', name: '南开区' },
					{ code: '120105', name: '河北区' },
					{ code: '120106', name: '红桥区' },
					{ code: '120110', name: '东丽区' },
					{ code: '120111', name: '西青区' },
					{ code: '120112', name: '津南区' },
					{ code: '120113', name: '北辰区' },
					{ code: '120114', name: '武清区' },
					{ code: '120115', name: '宝坻区' },
					{ code: '120116', name: '滨海新区' },
					{ code: '120117', name: '宁河区' },
					{ code: '120118', name: '静海区' },
					{ code: '120119', name: '蓟州区' },
				],
			},
		],
	},
];

const keys = {label: 'name', value: 'code', children: 'items'}
const onChange3 = (value: string, options: UTSJSONObject[]) => {
	fieldValue3.value = options.map((item: UTSJSONObject):any|null => (item['name'])).join('/');
};
```

### 自定义选项上方内容
通过设置`subTitles`属性每级展示的次标题
```html
<view class="cell" @click="visible4 = true">
	<text>地址</text>
	<text v-show="fieldValue4 == null" style="color: #999;">请选择地址 ></text>
	<text v-show="fieldValue4 != null">{{fieldValue4}}</text>
</view>
<l-cascader 
	v-model:visible="visible4" 
	v-model="cascaderValue4" 
	:options="options4" 
	:subTitles="subTitles"
	title="请选择所在地区" 
	@change="onChange4"/>
```
```js
const visible4 = ref(false)
const cascaderValue4 = ref('');
const fieldValue4 = ref<string|null>(null);
const options4 = areaList;
const subTitles = ['请选择省份', '请选择城市', '请选择区/县'];
const onChange4 = (value: string, options: UTSJSONObject[]) => {
	fieldValue4.value = options.map((item: UTSJSONObject):any|null => (item['label'])).join('/');
};
```

### 自定义颜色
通过设置`active-color`属性来设置选中状态的高亮颜色。
```html
<view class="cell" @click="visible5 = true">
	<text>地址</text>
	<text v-show="fieldValue5 == null" style="color: #999;">请选择地址 ></text>
	<text v-show="fieldValue5 != null">{{fieldValue5}}</text>
</view>
<l-cascader 
	v-model:visible="visible5" 
	v-model="cascaderValue5" 
	:options="options5" 
	active-color="#34c471"
	title="请选择所在地区" 
	@change="onChange5"/>
```

### 中国省市区数据
`lime-shared/areaData`提供了一份中国省市区数据, 该数据来源于 `Vant`
```js
import { useCascaderAreaData } from '@/uni_modules/lime-shared/areaData'
const options7 = useCascaderAreaData();
const subTitles = ['请选择省份', '请选择城市', '请选择区/县'];
const visible7 = ref(false)
const cascaderValue7 = ref('');
const fieldValue7 = ref<string|null>(null);
const onChange7 = (value: string, options: UTSJSONObject[]) => {
	fieldValue7.value = options.map((item: UTSJSONObject):any|null => (item['label'])).join('/');
};
```
```html
<view class="cell" @click="visible7 = true">
	<text>地址</text>
	<text v-show="fieldValue7 == null" style="color: #999;">请选择地址 ></text>
	<text v-show="fieldValue7 != null">{{fieldValue7}}</text>
</view>
<l-cascader 
	v-model:visible="visible7" 
	v-model="cascaderValue7" 
	:options="options7" 
	:subTitles="subTitles"
	title="请选择所在地区" 
	@change="onChange7"/>
```

### uniCloud
除了加载本地数据，还可以设置`uniCloud`,会加载`opendb-city-china`(中国城市省市区数据，含港澳台)表, 在[uniCloud](https://unicloud.dcloud.net.cn/)控制台使用opendb创建
```html
<view class="cell" @click="visible6 = true">
	<text>地址</text>
	<text v-show="fieldValue6 == null" style="color: #999;">请选择地址 ></text>
	<text v-show="fieldValue6 != null">{{fieldValue6}}</text>
</view>
<l-cascader 
	v-model:visible="visible6" 
	v-model="cascaderValue6" 
	:options="options6" 
	:subTitles="subTitles"
	:keys="{label: 'name', value: 'code'}"
	title="请选择所在地区" 
	@pick="onPick6"
	@change="onChange6"/>
```
```js
const visible6 = ref(false)
const cascaderValue6 = ref('');
const fieldValue6 = ref<string|null>(null);

const onChange6 = (value: string, options: UTSJSONObject[]) => {
	fieldValue6.value = options.map((item: UTSJSONObject):any|null => (item['name'])).join('/');
};

```


### 查看示例
- 导入后直接使用这个标签查看演示效果

```html
<!-- // 代码位于 uni_modules/lime-cascader/compoents/lime-cascader -->
<lime-cascader />
```


### 插件标签
- 默认 l-cascader 为 component
- 默认 lime-cascader 为 demo

### 关于vue2的使用方式
- 插件使用了`composition-api`, 如果你希望在vue2中使用请按官方的教程[vue-composition-api](https://uniapp.dcloud.net.cn/tutorial/vue-composition-api.html)配置
- 关键代码是: 在main.js中 在vue2部分加上这一段即可
```js
// vue2
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'
Vue.use(VueCompositionAPI)
```


## API

### Props

| 参数 | 说明 | 类型 | 默认值 |
| --- | --- | --- | --- |
| v-model:visible | 是否显示级联选择器 | _boolean_ | `false` |
| v-model | 值 | _string_ | `-` |
| subTitles | 每级展示的次标题，`Array<string>` | _string[]_ | `-` |
| placeholder | 未选中时的提示文案 | _string_ | `选择选项` |
| keys | 用来定义 `value / label` 在 `options` 中对应的字段别名。 | _{label,value,children}_ | `{}` |
| title | 标题 | _string_ | `-` |
| options | 可选项数据源 | _[]_ | `-` |
| closeable | 关闭按钮 | _boolean_ | `-` |
| bgColor | 背景色 | _string_ | `-` |
| activeColor | 激活色 | _string_ | `-` |
| iconSize | 图标尺寸 | _string_ | `-` |
| color | 文本色 | _string_ | `-` |
| fontSize | 字体大小 | _string_ | `-` |

### Events

| 事件名           | 说明                       | 回调参数            |
| ---------------- | -------------------------- | ------------------- |
| pick    | 选择后触发          | `(level: number, index:number, value: string, selectedIndexes:number[])` |
| change    | 值发生变更时触发          | `(value: string, options: UTSJSONObject[])` |
| close    | 关闭时触发          | `` |
| finish    | 选择后触发          | `` |


## 主题定制

### 样式变量

组件提供了下列 CSS 变量，可用于自定义样式，uvue app无效。

| 名称                           | 默认值                               | 描述 |
| ------------------------------ | ------------------------------------ | ---- |
| --l-cascader-title-color         | _$text-color-1_            | -    |
| --l-cascader-icon-color         | _$primary-color_            | -    |
| --l-cascader-icon-size        | _24px_            | -    |
| --l-cascader-bg-color        | _$bg-color-container_            | -    |
| --l-cascader-height        | _320px_            | -    |
| --l-cascader-cell-height        | _50px_            | -    |
| --l-cascader-cell-cell-padding        | _14px 16px_            | -    |
| --l-cascader-cell-title-color        | _$text-color-1_            | -    |
| --l-cascader-cell-title-font-size        | _$font-size-md_            | -    |
| --l-cascader-disabled-color        | _$text-color-3_            | -    |
| --l-cascader-title-height        | _48px_            | -    |
| --l-cascader-title-font-size        | _18px_            | -    |
| --l-cascader-options-title-color        | _$text-color-3_            | -    |



## 打赏

如果你觉得本插件，解决了你的问题，赠人玫瑰，手留余香。  
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/alipay.png)
![](https://testingcf.jsdelivr.net/gh/liangei/image@1.9/wpay.png)