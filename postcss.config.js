module.exports = {
	plugins: {
		'postcss-import': {},
		'autoprefixer': {},
		'@dcloudio/vue-cli-plugin-uni/packages/postcss': {
			transformToRpx: true, // 开启 px 转 rpx
			designWidth: 750 // 设计稿宽度
		}
	}
}