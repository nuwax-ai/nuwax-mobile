export const areaList = [
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
]



export const areaList2 = [
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
]




const makeOption = (
	label : string,
	value : string,
	children ?: UTSJSONObject[],
) : UTSJSONObject => ({
	label,
	value,
	children,
});



export function useCascaderAreaData() : Promise<UTSJSONObject[]> {
	return new Promise((resolve, reject) => {
		// #ifdef APP
		const manager = uni.getFileSystemManager();
		manager.readFile({
			filePath: 'static/city/city-china.json',
			encoding: 'utf-8',
			success: (res) => {
				
				const areaList = JSON.parse<UTSJSONObject>(res.data as string)
				if(areaList == null) {
					reject('加载失败')
				}
				
				
				const city = areaList!['city_list'] as UTSJSONObject
				const county = areaList!['county_list'] as UTSJSONObject
				const province = areaList!['province_list'] as UTSJSONObject
				const provinceMap = new Map<string, UTSJSONObject>();
				UTSJSONObject.keys(province).forEach((code) => {
					provinceMap.set(code.slice(0, 2), makeOption(`${province[code]}`, code, []));
				});
				
				const cityMap = new Map<string, UTSJSONObject>();
				
				UTSJSONObject.keys(city).forEach((code) => {
					const option = makeOption(`${city[code]}`, code, []);
					cityMap.set(code.slice(0, 4), option);
				
					const _province = provinceMap.get(code.slice(0, 2));
					if (_province != null) {
						(_province['children'] as UTSJSONObject[]).push(option)
					}
				});
				
				UTSJSONObject.keys(county).forEach((code) => {
					const _city = cityMap.get(code.slice(0, 4));
					if (_city != null) {
						(_city['children'] as UTSJSONObject[]).push(makeOption(`${county[code]}`, code, null));
					}
				});
				
				// #ifndef APP-ANDROID || APP-IOS || APP-HARMONY
				resolve(Array.from(provinceMap.values()))
				// #endif
				// #ifdef APP-ANDROID || APP-IOS || APP-HARMONY
				const obj : UTSJSONObject[] = []
				provinceMap.forEach((value, code) => {
					obj.push(value)
				})
				resolve(obj) 
				// #endif
			}
		} as ReadFileOptions);
		// #endif
	})
}