<template>
	<l-popup :visible="show" position="bottom" @click-overlay="onClose">
		<view class="l-cascader" :style="[styles]">
			<text class="l-cascader__title">{{title}}</text>
			<view class="l-cascader__close-btn" @click="onCloseBtn" v-if="closeable">
				<view class="l-cascader__close-icon" >
					<l-icon name="tdesign:close" size="24px"></l-icon>
				</view>
			</view>
			<view class="l-cascader__content">
				<l-tabs 
				:list="steps" 
				:value="stepIndex" 
				:space-evenly="false" @change="onTabChange" size="large" 
				:color="color" 
				:visible="show"
				:activeColor="activeColor" 
				:lineColor="activeColor"
				:bgColor="bgColor">
				</l-tabs>
				<template v-if="subTitles.length > 0 ">
					<text v-show="subTitles.length > stepIndex" class="l-cascader__options-title">
						{{subTitles.length > stepIndex ? subTitles[stepIndex]: ''}}
					</text>
				</template>
			
				<view class="l-cascader__options-container" :style="[containerStyles]">
					<scroll-view  
						class="l-cascader__options"  
						v-for="(_options, index) in items"
						:key="index"
						:scroll-y="true">
						<view class="l-cascader__cell" v-for="(item, _index) in _options" :key="_index" @click="handleSelect(item[fieldKeys.value], index, true)">
							<text 
								class="l-cascader__cell-title" 
								:class="{'l-cascader__cell--disabled': item['disabled'] == true}" 
								:style="[color != null ?'color:' + color: '']">{{item[fieldKeys.label]}}</text>
							<view class="l-cascader__cell-icon"
								v-if="selectedValue.length > index && selectedValue[index] == item[fieldKeys.value]">
								<l-icon
									:size="iconSize"
									:color="activeColor"
									name="check">
								</l-icon>
							</view>
						</view>
					</scroll-view>
				</view>
			</view>
			<view class="l-cascader__footer" v-if="innerConfirmBtn">
				<l-button 
					@click="handleConfirm"
					:color="innerConfirmBtn.color || props.color"
					:shape="innerConfirmBtn.shape || 'round'"
					:type="innerConfirmBtn.type || 'primary'">
					{{
						 innerConfirmBtn.content
					}}
				</l-button>
			</view>
		</view>
	</l-popup>
</template>
<script lang="ts">
	// @ts-nocheck
	/**
	 * Cascader 级联选择器组件
	 * @description 支持多级联动的选择器，适用于地区选择、分类选择等场景
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-cascader
	 * 
	 * @property {boolean} visible 控制组件显示/隐藏（必填）
	 * @property {boolean} checkStrictly 父子节点选择是否关联（默认false联动选择）
	 * @property {object[]} options 数据源（必填，符合CascaderOption结构）
	 * @property {string} title 主标题文本
	 * @property {object} keys 字段别名配置（例：{label:'name',value:'id'}）
	 * @property {string} value 当前选中值（支持v-model）
	 * @property {string} defaultValue 默认选中值
	 * @property {string} placeholder 未选择时的提示文字
	 * @property {string[]} subTitles 各级副标题（如：['省份','城市','区县']）
	 * @property {boolean} closeable 是否显示关闭按钮
	 * @property {boolean} uniCloud 是否使用uniCloud数据源
	 * @property {boolean} swipeable 是否支持手势滑动切换层级
	 * @property {string} iconSize 图标尺寸（支持CSS单位）
	 * @property {string} activeColor 选中状态主题色
	 * @property {string} fontSize 文字字号（支持CSS单位）
	 * @property {string} color 文字颜色
	 * @property {string} bgColor 背景颜色
	 * @event {Function} change 选项变化时触发（返回当前选中路径）
	 * @event {Function} pick 选中时触发
	 * @event {Function} close 关闭时触发
	 * @event {Function} finish 点击完成时触发
	 */
	import { defineComponent, ref, computed, watch, reactive, onMounted ,onUnmounted, toRaw, watchEffect } from '@/uni_modules/lime-shared/vue';
	import cascaderProps from './props';
	import { CascaderOption, KeysType, ChildrenInfoType } from './type';
	import { getIndexesByValue, parseOptions, parseKeys, splitEveryTwo, getUniCloudArea, pickUniCloudArea, getIndexByValue, updateChildren } from './utils';
	
	
	export default defineComponent({
		name: 'l-cascader',
		emits: ['pick', 'change', 'close', 'finish', 'update:modelValue', 'input', 'update:visible'],
		props: cascaderProps,
		setup(props, {emit}) {
			const childrenInfo: ChildrenInfoType = {
				value: '',
				level: 0,
			};
			const fieldKeys = computed(():KeysType => parseKeys(props.keys, props.uniCloud))
			const cascaderValue = computed({
				set(value: string){
					// modelValue.value = value
					emit('update:modelValue', value)
					// #ifdef VUE2
					emit('input', value)
					// #endif
				},
				get():string {
					return props.value ?? props.modelValue
				}
			})
			const show = computed({
				set(value: boolean){
					emit('update:visible', value)
				},
				get():boolean {
					return props.visible
				}
			} as WritableComputedOptions<string>)
			
			const cache = new Map<string, Record<string,any>[]>();
			const stepIndex = ref(0)
			const selectedIndexes = reactive<number[]>([]);
			const selectedValue = reactive<string[]>([]);
			const uniCloudColumns = ref<UTSJSONObject[]>([]);
			const realColumns = computed(():UTSJSONObject[] =>{
				if(props.uniCloud) {
					return uniCloudColumns.value
				}
				return props.options
			})
			const items = reactive<CascaderOption[][]>([realColumns.value]);
			const steps = reactive<CascaderOption[]>([{ label: props.placeholder }])
			const innerConfirmBtn = computed(():UTSJSONObject|null=> {
				if(props.confirmBtn == null) return null
				if(typeof props.confirmBtn == 'string') {
					return {
						content: props.confirmBtn as string
					}
				}
				return props.confirmBtn as UTSJSONObject
			})
			const styles = computed(() =>{
				const style:Record<string, any> = {}
				if(props.bgColor) {
					style['background'] = props.bgColor!
				}
				return style
			})
			const containerStyles = computed(()=>{
				const style:Record<string, any> = {}
				style['width'] = (items.length + 1) + '00%';
				style['transform'] = `translateX(${-stepIndex.value}00vw)`;
				return style
			})
			
			const onTabChange = (index : number) => {
				stepIndex.value = index
			}
			// 监听选中索引变化
			const watchSelectedIndexes = () => {
				if (realColumns.value.length > 0) {
					items.splice(0, items.length, ...[parseOptions(realColumns.value, fieldKeys.value)]);
					let current = realColumns.value;
					for (let i = 0, size = selectedIndexes.length; i < size; i += 1) {
						const index = selectedIndexes[i];
						const next = current[index]
						const value = next?.[fieldKeys.value.value]
						const label = next?.[fieldKeys.value.label]
						const children = next?.[fieldKeys.value.children]
						if(value) {
							selectedValue.push(value);
						}
						if(label && steps[i]?.['label'] != label) {
							steps.push({label});
						}
						
						if(children) {
							current = children
							items.push(parseOptions(children, fieldKeys.value));
						}
					}
				}
				if (steps.length < items.length) {
					steps.push({ label: props.placeholder });
				}
				// stepIndex.value = items.length - 1;
				stepIndex.value = Math.max(Math.min(selectedIndexes.length - 1, items.length - 1), 0);
			}
			
			let timer = 0
			const initWithValue = () => {
				clearTimeout(timer)
				timer = setTimeout(()=>{
					if (cascaderValue.value) {
						steps.pop()
						const path = getIndexesByValue(realColumns.value, cascaderValue.value, fieldKeys.value)
						path?.forEach((e : number, index) => {
							// @ts-ignore
							if(selectedIndexes.length > index) {
								selectedIndexes[index] = e
							} else {
								// @ts-ignore
								selectedIndexes.push(e);
							}
						});
						watchSelectedIndexes();
					} else {
						selectedIndexes.length = 0;
						selectedValue.length = 0;
						steps.length = 1;
						steps[0] = { label: props.placeholder } 
						items.length = 1;
						items[0] = parseOptions(realColumns.value, fieldKeys.value) 
						stepIndex.value = 0;
					}
				},50)
			}
			// 设置级联选择器值
			const setCascaderValue = (value: string, selectedOptions: CascaderOption[]) => {
				cascaderValue.value = value;
				emit('change', value, [...selectedOptions])
			}
			const setSteps = (index: number, label: string) => {
				steps[index] = {label}
			}
			// 取消选择
			const cancelSelect = (value: string, level: number, index: number, item:CascaderOption) => {
				selectedIndexes[level] = index;
				selectedIndexes.length = level;
				selectedValue.length = level;
				// steps[level] = String(props.placeholder);
				// steps[level + 1] = props.placeholder;
				setSteps(level, props.placeholder)
				setSteps(level + 1, props.placeholder)
				steps.length = level + 1;
				
				const children = item[fieldKeys.value.children] as CascaderOption[]|null
				if (children != null && children.length > 0) {
					 items[level + 1] = item[fieldKeys.value.children];
				} else if (children != null && children.length == 0) {
				    childrenInfo.value = value;
				    childrenInfo.level = level;
				}
			}
			// 选择
			const chooseSelect = (value: string, level: number, index: number, item:CascaderOption) => {
				selectedIndexes[level] = index;
				selectedIndexes.length = level + 1;
				selectedValue[level] = String(value);
				selectedValue.length = level + 1;
				setSteps(level, `${item[fieldKeys.value.label] ?? props.placeholder}`)
				const children = item[fieldKeys.value.children] as CascaderOption[]|null
				if (children != null && children.length > 0) {
					// setItems(level + 1, children)
					items[level + 1] = children;
				    items.length = level + 2;
				    stepIndex.value += 1;
					setSteps(level + 1, props.placeholder)
				    steps.length = level + 2;
				} else if (children != null && children.length == 0) {
				    childrenInfo.value = value;
				    childrenInfo.level = level;
				} else {
					// 如果存在确确按钮，则需要点按钮关闭
					if(props.confirmBtn != null) return
					items.length = level + 1
					steps.length = level + 1;
					setCascaderValue(
						`${item[fieldKeys.value.value] ?? ''}`,
						items.map((item, index):CascaderOption => toRaw(item[selectedIndexes[index]]))
					)
				    emit('finish');
					show.value = false
				}
			}
			const handleSelect = (value: string, level: number, shouldEmit: boolean) => {
				const _value = value
				if(items.length <= level) return
				const index = items[level].findIndex((item: CascaderOption):boolean => item[fieldKeys.value.value] == _value);
				let item = selectedIndexes.slice(0, level).reduce((acc:CascaderOption[], item:number, index:number):CascaderOption[] => {
				    if (index == 0) {
				        return [acc[item]] as CascaderOption[];
				    }
					const children = acc[0][fieldKeys.value.children] as CascaderOption[]|null
				    return [children?.[item] ?? {}] as CascaderOption[];
				}, realColumns.value);
				
				let cursor :CascaderOption|null
				if (level == 0) {
				    cursor = item[index];
				} else {
					const children = item[0][fieldKeys.value.children] as CascaderOption[]|null
				    cursor = children?.[index];
				}
				const disabled = cursor?.['disabled'] == true
				if (disabled || cursor == null) {
				    return;
				}
				
				// 反选条件：1：有确认按钮并且没有下级  2：允许各自取消（checkStrictly）
				const hasChildren = Boolean(cursor[fieldKeys.value.children]);
				const isSelected = selectedValue.includes(_value);
				const canCancel = 
				    (props.confirmBtn && !hasChildren) || 
				    (props.checkStrictly);
				
				if (canCancel && isSelected) {
				// if (props.checkStrictly && selectedValue.includes(_value)) {
				    cancelSelect(_value, level, index, cursor);
				} else {
				    chooseSelect(_value, level, index, cursor);
				}
				if(shouldEmit){
					const code = cursor[fieldKeys.value.value] as string
					emit('pick', level, index, code, toRaw([...selectedIndexes]))
					if(!props.uniCloud) return
					pickUniCloudArea(uniCloudColumns.value, level, code, toRaw([...selectedIndexes]), cache)
					
				}
			}
			
			// 更新级联选择器值
			const updateCascaderValue = () => {
			    setCascaderValue(
			        selectedValue[selectedValue.length - 1],
			        items
			          .filter((item, index):boolean => selectedIndexes.length > index)
			          .map((item, index):CascaderOption => toRaw(item[selectedIndexes[index]]))
			      );
			};
			const onClose = () => {
				emit('close');
				show.value = false
			}
			const onCloseBtn = () => {
				if (props.checkStrictly) {
				    updateCascaderValue();
				    onClose()
				} else {
				    onClose()
				}
			}
			
			const handleConfirm = () => {
				// 1. 如果没有选中任何选项，直接关闭
				if (selectedValue.length === 0) {
				    show.value = false;
				    return;
				}
				// 2. 获取当前选中的完整路径（各级选项）
				const selectedOptions = items
				    .filter((_, index) => selectedIndexes.length > index)
				    .map((item, index) => toRaw(item[selectedIndexes[index]]));
				
				
				  // 3. 更新级联选择器的值（如果是联动模式）
				if (!props.checkStrictly) {
				    setCascaderValue(
				      selectedValue[selectedValue.length - 1],
				      selectedOptions
				    );
				}
				
				// 4. 触发 finish 事件，返回选中值和选项路径
				emit('finish');
				
				  // 5. 关闭弹窗
				show.value = false;
			}
			
			const optionsWatch = watch(():CascaderOption[] => realColumns.value, (_:CascaderOption[]) => {
				watchSelectedIndexes()
				if(selectedIndexes.length == 0) {
					initWithValue()
				}
				if (show.value) {
			        handleSelect(childrenInfo.value, childrenInfo.level, false);
			    }
			},{ deep: true});
			
			const placeholderWatch = watch(():string=> props.placeholder, (newValue: string, oldValue: string) => {
			    const index = steps.indexOf({label : oldValue} as CascaderOption);
			    if (index != -1) {
					setSteps(index, newValue)
			    }
			});
				
			onMounted(() => {
				if(props.uniCloud) {
					const update = async () => {
						const provinces = await getUniCloudArea({type: 0}, cache)
						uniCloudColumns.value = provinces
						if(cascaderValue.value != '' && /^\d{6}$/.test(cascaderValue.value)) {
							const [province, citie, countie] = splitEveryTwo(cascaderValue.value );
							const provinceCode = province.padEnd(6, '0')
							const provinceIndex = getIndexByValue(uniCloudColumns.value, provinceCode)
							const cities = await getUniCloudArea({type: 1, parent_code: provinceCode}, cache)
							const citieCode = (province + citie).padEnd(6, '0')
							const citiesIndex = getIndexByValue(uniCloudColumns.value, citieCode)
							const counties = await getUniCloudArea({type: 2, parent_code: citieCode}, cache)
							
							updateChildren(uniCloudColumns.value, cities, [provinceIndex])
							updateChildren(uniCloudColumns.value[provinceIndex]['children'] as UTSJSONObject[], counties, [citiesIndex])
						}
						initWithValue()
					}
					update()
					return
				}
				initWithValue()
			})
			
			watchEffect(()=>{
				const value = cascaderValue.value
				if(realColumns.value.length > 0 && selectedIndexes.length == 0) {
					initWithValue()
				}
			})
			// 监听 cascaderValue 变化，当值被清空时重置状态
			const cascaderValueWatch = watch(():string => cascaderValue.value, (newValue: string, oldValue: string) => {
				if (newValue == '' && oldValue != '') {
					initWithValue()
				}
			})
			
			onUnmounted(()=>{
				optionsWatch()
				placeholderWatch()
				cascaderValueWatch()
			})
			return {
				show,
				items,
				steps,
				stepIndex,
				selectedValue,
				styles,
				containerStyles,
				fieldKeys,
				handleSelect,
				onCloseBtn,
				onClose,
				onTabChange,
				handleConfirm,
				innerConfirmBtn
			}
		}
	})
</script>
<style lang="scss">
	@import './index';
</style>