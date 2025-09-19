<template>
	<view class="l-checkbox" :class="[rootCasses]" :style="[styles]" @click="handleChange">
		<slot name="checkbox" :checked="isChecked" :disabled="isDisabled">
			<slot name="icon" :checked="isChecked" :disabled="isDisabled">
				<view class="l-checkbox__icon" ref="iconRef" :class="iconClasses" :style="[iconStyle]"></view>
			</slot>
			<text class="l-checkbox__label" :style="[labelStyle]" :class="labelClass" v-if="label || $slots['default']">
				<slot>{{label}}</slot>
			</text>
		</slot>
	</view>
</template>
<script lang="ts">
	// @ts-nocheck
	/**
	 * Checkbox 复选框组件
	 * @description 用于在多个选项中进行选择的表单组件，支持单选、全选和不确定态
	 * @tutorial https://ext.dcloud.net.cn/plugin?name=lime-checkbox
	 * 
	 * @property {boolean} defaultChecked 默认选中状态（非受控属性）
	 * @property {string} label 显示文本（支持插槽）
	 * @property {boolean} indeterminate 半选状态（优先级高于checked）
	 * @property {boolean} disabled 禁用状态（覆盖Group设置）
	 * @property {'small' | 'medium' | 'large'} size 组件尺寸
	 * @value small 
	 * @value medium 
	 * @value large	
	 * @property {string} name 唯一标识符（表单提交使用）
	 * @property {boolean} checkAll 标记为全选选项（需在Group中使用）
	 * @property {string} value 选项值（Group模式下必填）
	 * @property {'circle' | 'line' | 'rectangle' | 'dot'} icon 图标样式类型
	 * @value circle 圆
	 * @value line 线
	 * @value rectangle	方
	 * @value dot 点
	 * @property {string} fontSize 文本字号（支持CSS单位）
	 * @property {string} iconSize 图标尺寸（支持CSS单位）
	 * @property {string} checkedColor 选中状态主题色
	 * @property {string} iconBgColor 图标背景色
	 * @property {string} iconBorderColor 图标边框色
	 * @property {string} iconDisabledColor 禁用状态图标颜色
	 * @property {string} iconDisabledBgColor 禁用状态背景色
	 * @property {string|object} labelStyle label的样式
	 * @event {Function} change 状态变化时触发（参数：CheckboxChangeOptions）
	 */
	import { type ManageChildInList, type CheckboxStatus, type OnCheckedChange, type CheckboxChangeOptions, type ComputedRef } from './type';
	import { computed, defineComponent, ref, inject, getCurrentInstance, onBeforeUnmount } from '@/uni_modules/lime-shared/vue'
	import checkboxProps from './props'
	const name = 'l-checkbox';
	export default defineComponent({
		name,
		props: checkboxProps,
		emits: ['update:modelValue', 'input', 'change'],
		setup(props, { emit }) {
			const instance = getCurrentInstance()!
			const formDisabled = inject<Ref<boolean|null>|null>('formDisabled', null)
			const formReadonly = inject<Ref<boolean|null>|null>('formReadonly', null)
			const checkboxGroup = inject<LCheckboxGroupComponentPublicInstance|null>('limeCheckboxGroup', null);
			const checkboxGroupValue = inject<ComputedRef<any[]>|null>('limeCheckboxGroupValue', null);
			const checkboxGroupStatus = inject<ComputedRef<CheckboxStatus>|null>('limeCheckboxGroupStatus', null);
			const checkboxGroupCheckedSet = inject<ComputedRef<Set<any>>|null>('limeCheckboxGroupCheckedSet', null);
			const manageChildInList = inject<ManageChildInList|null>('limeCheckboxGroupManageChildInList', null);
			const onCheckedChange = inject<OnCheckedChange|null>('limeCheckboxGroupOnCheckedChange', null);
			if(manageChildInList != null) {
				manageChildInList(instance.proxy as LCheckboxComponentPublicInstance, true)
			}
			
			const max = computed(():number => checkboxGroup?.max ?? -1)
			
			const _innerChecked = ref(props.checked || props.modelValue || props.value || props.defaultChecked)
			const innerChecked = computed({
				set(value: boolean) {
					_innerChecked.value = value
					emit('update:modelValue', value)
					emit('change', value)
					// #ifdef VUE2
					emit('input', value)
					// #endif
				},
				get():boolean {
					const value = (props.checked ?? props.modelValue ?? props.value)
					if(value != null) return value
					return _innerChecked.value
					
					// return props.checked || props.modelValue || props.value || _innerChecked.value
				}
			} as WritableComputedOptions<boolean>)
			
			const isChecked = computed(():boolean=>{
				if (props.checkAll) {
					const checkAllStatus = checkboxGroupStatus?.value || 'uncheck';
					return checkAllStatus == 'checked' || checkAllStatus == 'indeterminate'
				}
				const value = props.value || props.name;
				if (checkboxGroupCheckedSet && value) {
					return checkboxGroupCheckedSet.value.has(value)
				}
				return innerChecked.value;
			})
			
			const isDisabled = computed(():boolean=>{
				if(max.value > -1 && checkboxGroupValue) {
					return max.value <= checkboxGroupValue.value.length && !isChecked.value;
				}
				if (props.disabled) return props.disabled;
				// return checkboxGroup?.disabled || false;
				return formDisabled?.value || checkboxGroup?.disabled || false;
			})
			
			const isReadonly= computed(():boolean=>{
				if (props.readonly) return props.readonly;
				return formReadonly?.value ?? checkboxGroup?.readonly ?? false;
			})
			
			const isIndeterminate = computed(():boolean=>{
				if (props.checkAll && checkboxGroupStatus) return checkboxGroupStatus.value == 'indeterminate';
				return props.indeterminate;
			})
			
			const innerIcon = computed(():string => checkboxGroup?.icon || props.icon)
			const innerSize = computed(():string => checkboxGroup?.size || props.size)
			const innerIconSize = computed(():string|null => checkboxGroup?.iconSize || props.iconSize)
			const innerFontSize = computed(():string|null => checkboxGroup?.fontSize || props.fontSize)
			const innerCheckedColor = computed(():string|null => checkboxGroup?.checkedColor || props.checkedColor)
			const innerIconBgColor = computed(():string => props.iconBgColor || checkboxGroup?.iconBgColor)
			const innerIconBorderColor = computed(():string => props.iconBorderColor || checkboxGroup?.iconBorderColor)
			const innerIconDisabledColor = computed(():string => props.iconDisabledColor || checkboxGroup?.iconDisabledColor)
			const innerIconDisabledBgColor = computed(():string => props.iconDisabledBgColor || checkboxGroup?.iconDisabledBgColor)
			
			
			const rootCasses = computed(()=>{
				const cls = [`${name}--${props.size}`]
				if(isDisabled.value) {
					cls.push(`${name}--disabled`)
				}
				return cls.join(' ')
			})
			
			const iconClasses = computed(()=>{
				const cls = [`${name}__icon--${props.icon}`]
				if(isChecked.value) {
					cls.push(`${name}__icon--checked`)
				}
				if(isDisabled.value) {
					cls.push(`${name}__icon--disabled`)
				}
				if(isIndeterminate.value) {
					cls.push(`${name}__icon--indeterminate`)
				}
				return cls.join(' ')
			})
			
			const labelClass = computed(()=>{
				const cls = [];
				if(isDisabled.value) {
					cls.push(`${name}__label--disabled`)
				}
				return cls.join(' ')
			})
			
			const styles = computed(()=>{
				const style:Record<string, any> = {};
				if(checkboxGroup && checkboxGroup.gap) {
					style[checkboxGroup.direction == 'horizontal' ? 'margin-right' : 'margin-bottom'] = checkboxGroup.gap!
				}
				if(innerCheckedColor.value) {
					style['--l-checkbox-icon-checked-color'] = innerCheckedColor.value!
				}
				if(innerIconBorderColor.value) {
					style['--l-checkbox-icon-border-color'] = innerIconBorderColor.value!
				}
				if(innerIconDisabledColor.value) {
					style['--l-checkbox-icon-disabled-color'] = innerIconDisabledColor.value!
				}
				if(innerIconDisabledBgColor.value) {
					style['--l-checkbox-icon-disabled-bg-color'] = innerIconDisabledBgColor.value!
				}
				if(innerFontSize.value) {
					style['--l-checkbox-font-size'] = innerFontSize.value!
				}
				return style
			})
			
			const iconStyle = computed(()=>{
				const style:Record<string, any> = {}
				if(innerIconSize.value) {
					style['width'] = innerIconSize.value!
					style['height'] = innerIconSize.value!
					style['--l-checkbox-icon-size'] = innerIconSize.value!
				}
				return style
			})
			
			// const labelStyle = computed(()=>{
			// 	const style:Record<string, any> = {}
			// 	const fontSize = props.fontSize || checkboxGroup?.fontSize
			// 	if(fontSize) {
			// 		style['font-size'] = fontSize
			// 	}
			// 	return style
			// })
			
			const handleChange = (e: UniPointerEvent) => {
				if (isDisabled.value || isReadonly.value) return;
				const value = !isChecked.value;
				innerChecked.value = value;
				
				if(onCheckedChange) {
					onCheckedChange({
						checked: value, 
						checkAll: props.checkAll,
						value: props.value || props.name //?? instance.uid
					})
				}
			}
			
			onBeforeUnmount(()=>{
				if(manageChildInList) {
					manageChildInList(instance.proxy as LCheckboxComponentPublicInstance, false)
				}
			})
			
			
			return {
				isChecked,
				isDisabled,
				rootCasses,
				iconClasses,
				labelClass,
				styles,
				iconStyle,
				// labelStyle,
				handleChange
			}
		}
	})
</script>
<style lang="scss">
	@import './index-u';
</style>