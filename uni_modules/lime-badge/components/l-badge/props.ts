// @ts-nocheck
import type {PropType} from '@/uni_modules/lime-shared/vue'
export type BadgePosition =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right';
type Numeric = string | number
export default {
	dot: Boolean,
	max: Number,
	color: String,
	offset: Array as unknown as PropType<[Numeric, Numeric]>,
	content: [Number , String],
	showZero: Boolean,
	position: {
		type: String as PropType<BadgePosition>,
		default: 'top-right'
	} 
}