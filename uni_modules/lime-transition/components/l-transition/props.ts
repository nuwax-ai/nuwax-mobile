
export default {
	appear: {
		type: Boolean,
		default: false
	},
	destoryOnClose: {
		type: Boolean,
		default: false
	},
	duration: {
		type: [Number, Array],
		default: 300
	},
	zIndex: {
		type: Number,
		default: 11000
	},
	name: {
		type: String,
		default: 'fade'
	},
	visible: {
		type: Boolean,
		default: false
	},
	lClass: String,
	lStyle: String,
	enterClass: String,
	enterActiveClass: String,
	enterToClass: String,
	leaveClass: String,
	leaveActiveClass: String,
	leaveToClass: String,
}