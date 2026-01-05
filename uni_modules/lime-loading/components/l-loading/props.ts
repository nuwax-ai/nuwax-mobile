// import {PropType} from 'vue'
export default {
	color: {
		type: String,
		// default: '#c9c9c9'
	},
	type: {
		type: String, //as PropType<'circular'|'spinner'>,
		default: 'circular'
	},
	size: {
		type: String,
		// #ifdef APP-NVUE
		default: '40rpx'
		// #endif
	},
	text: String,
	textColor: String,
	textSize: String,
	vertical: Boolean,
	inheritColor: Boolean,
	animated: {
		type: Boolean,
		default: true
	}
}