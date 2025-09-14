export default {
	visible: Boolean,
	zIndex: {
		type: Number,
		default: 998,
	},
	duration: {
		type: Number,
		default: 300
	},
	preventScrollThrough: {
		type: Boolean,
		default: true
	},
	bgColor: String,
	lStyle: [String, Object],
	lClass: String,
	ariaLabel: String,
	ariaRole: String,
}