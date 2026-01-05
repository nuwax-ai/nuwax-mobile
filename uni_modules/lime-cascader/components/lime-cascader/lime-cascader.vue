<template>
	<view class="demo-block">
		<text class="demo-block__title-text ultra">Cascader 级联选择器</text>
		<text class="demo-block__desc-text">用于多层级数据选择，主要为树形结构，可展示更多的数据。</text>	
		<view class="demo-block__body">
			<view class="demo-block">
				<text class="demo-block__title-text">基础用法{{visible}}</text>
				<view class="demo-block__body">
					<view class="cell" @click="visible = true">
						<text>地址</text>
						<text v-show="fieldValue == null" style="color: #999;">请选择地址 ></text>
						<text v-show="fieldValue != null">{{fieldValue}}</text>
					</view>
					<l-cascader 
						v-model:visible="visible" 
						:visible.sync="visible"
						v-model="cascaderValue" 
						:options="options" 
						title="请选择所在地区" 
						@change="onChange"/>
				</view>	
			</view>	
			<view class="demo-block">
				<text class="demo-block__title-text">带初始值</text>
				<view class="demo-block__body">
					<view class="cell" @click="visible2 = true">
						<text>地址</text>
						<text v-show="fieldValue2 == null" style="color: #999;">请选择地址 ></text>
						<text v-show="fieldValue2 != null">{{fieldValue2}}</text>
					</view>
					<l-cascader 
						v-model:visible="visible2" 
						:visible.sync="visible2"
						v-model="cascaderValue2" 
						:options="options2" 
						title="请选择所在地区" 
						@change="onChange2"/>
				</view>	
			</view>	
			<view class="demo-block">
				<text class="demo-block__title-text">自定义字段名</text>
				<view class="demo-block__body">
					<view class="cell" @click="visible3 = true">
						<text>地址</text>
						<text v-show="fieldValue3 == null" style="color: #999;">请选择地址 ></text>
						<text v-show="fieldValue3 != null">{{fieldValue3}}</text>
					</view>
					<l-cascader 
						v-model:visible="visible3" 
						v-model="cascaderValue3" 
						:visible.sync="visible3"
						:options="options3" 
						:keys="keys"
						title="请选择所在地区" 
						@change="onChange3"/>
				</view>	
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">自定义选项上方内容</text>
				<view class="demo-block__body">
					<view class="cell" @click="visible4 = true">
						<text>地址</text>
						<text v-show="fieldValue4 == null" style="color: #999;">请选择地址 ></text>
						<text v-show="fieldValue4 != null">{{fieldValue4}}</text>
					</view>
					<l-cascader 
						v-model:visible="visible4" 
						v-model="cascaderValue4" 
						:visible.sync="visible4"
						:options="options4" 
						:subTitles="subTitles"
						title="请选择所在地区" 
						@change="onChange4"/>
				</view>	
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">自定义颜色</text>
				<view class="demo-block__body">
					<view class="cell" @click="visible5 = true">
						<text>地址</text>
						<text v-show="fieldValue5 == null" style="color: #999;">请选择地址 ></text>
						<text v-show="fieldValue5 != null">{{fieldValue5}}</text>
					</view>
					<l-cascader 
						v-model:visible="visible5" 
						v-model="cascaderValue5" 
						:visible.sync="visible5"
						:options="options5" 
						active-color="#34c471"
						title="请选择所在地区" 
						@change="onChange5"/>
				</view>	
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">中国城市 uniCloud</text>
				<view class="demo-block__body">
					<view class="cell" @click="visible6 = true">
						<text>地址</text>
						<text v-show="fieldValue6 == null" style="color: #999;">请选择地址 ></text>
						<text v-show="fieldValue6 != null">{{fieldValue6}}</text>
					</view>
					<l-cascader 
						v-model:visible="visible6" 
						v-model="cascaderValue6" 
						:visible.sync="visible6"
						uniCloud
						title="请选择所在地区" 
						@change="onChange6"/>
				</view>	
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">中国城市 本地{{cascaderValue7}}</text>
				<view class="demo-block__body">
					<view class="cell" @click="visible7 = true">
						<text>地址</text>
						<text v-show="fieldValue7 == null" style="color: #999;">请选择地址 ></text>
						<text v-show="fieldValue7 != null">{{fieldValue7}}</text>
					</view>
					<l-cascader 
						v-model:visible="visible7" 
						v-model="cascaderValue7" 
						:visible.sync="visible7"
						:options="options7" 
						:subTitles="subTitles"
						title="请选择所在地区" 
						@change="onChange7"/>
				</view>	
			</view>
			<view class="demo-block">
				<text class="demo-block__title-text">异步{{cascaderValue8}}</text>
				<view class="demo-block__body">
					<view class="cell" @click="visible8 = true">
						<text>地址</text>
						<text v-show="fieldValue8 == null" style="color: #999;">请选择地址 ></text>
						<text v-show="fieldValue8 != null">{{fieldValue8}}</text>
					</view>
					<l-cascader 
						v-model:visible="visible8" 
						v-model="cascaderValue8" 
						:visible.sync="visible8"
						:options="options8" 
						title="请选择所在地区" 
						@pick="onPick8"
						@change="onChange8"/>
				</view>	
			</view>
		</view>	
	</view>
</template>
<script>
	import { useCascaderAreaData } from '@/uni_modules/lime-shared/areaData'
	import { areaList, areaList2 } from './list';
	export default {
		data() {
			return {
				//基础~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				visible: false,
				fieldValue: null,
				cascaderValue: '',
				options: areaList,
				//带初始值~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				visible2: false,
				fieldValue2: null,
				cascaderValue2: '120119',
				options2: areaList,
				//自定义字段名~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				visible3: false,
				fieldValue3: null,
				cascaderValue3: '',
				keys: {label: 'name', value: 'code', children: 'items'},
				options3: areaList2,
				//自定义选项上方内容~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				visible4: false,
				fieldValue4: null,
				cascaderValue4: '',
				subTitles: ['请选择省份', '请选择城市', '请选择区/县'],
				options4: areaList,
				//自定义颜色~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				visible5: false,
				fieldValue5: null,
				cascaderValue5: '',
				options5: areaList,
				//加载uniCloud~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				visible6: false,
				fieldValue6: null,
				cascaderValue6: '',
				options6: [],
				//加载本地数据~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				visible7: false,
				fieldValue7: null,
				cascaderValue7: '',
				options7: useCascaderAreaData(),
				//异步~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
				visible8: false,
				fieldValue8: null,
				cascaderValue8: '',
				options8: [{
					label: '深圳市',
					value: '440300',
					children: [],
				}]
			}
		},
		watch:{
			visible6(v) {
				if(v && this.options6.length == 0) {
					this.getUniCloudCity({type: 0},[])
				}
			}	
		},
		mounted() {
			setTimeout(()=>{
				this.cascaderValue8 = '4403032'
			},1000)
			setTimeout(()=>{
				this.cascaderValue7 = '120104'
			},1000)
		},
		methods: {
			//基础~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			onChange(value, options) {
				this.fieldValue = options.map((item) => (item['label'])).join('/');
			},
			//带初始值~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			onChange2(value, options) {
				this.fieldValue2 = options.map((item) => (item['label'])).join('/');
			},
			//自定义字段名~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			onChange3(value, options) {
				this.fieldValue3 = options.map((item) => (item['name'])).join('/');
			},
			//自定义选项上方内容~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			onChange4(value, options) {
				this.fieldValue4 = options.map((item) => (item['label'])).join('/');
			},
			//自定义颜色~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			onChange5(value, options) {
				this.fieldValue5 = options.map((item) => (item['label'])).join('/');
			},
			//加载uniCloud~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			onChange6(value, options) {
				this.fieldValue6 = options.map((item) => (item['name'])).join('/');
			},
			updateCity(parent, child, selectedIndexes) {
				if(selectedIndexes.length == 0 && this.options6.length == 0) {
					this.options6 = child
				} else if(selectedIndexes.length > 1) {
					const i = selectedIndexes.shift();
					this.updateCity(parent[i]['children'], child, selectedIndexes)
				} else if(selectedIndexes.length == 1){
					const i = selectedIndexes.shift();
					parent[i].set('children', child)
				}
			},
			getUniCloudCity(where, selectedIndexes) {
				let db = uniCloud.databaseForJQL()
				let collection = db.collection('opendb-city-china')
				uni.showLoading({
					title: '加载中'
				})
				collection.where(where).get().then(res => {
					uni.hideLoading()
					const type = where.getNumber('type') ?? 4;
					const citys = type > 1 ? res.data : res.data.map((item) => {
						return Object.assign(item, {children:[]})
					})
					this.updateCity(this.options6, citys, selectedIndexes)
				}).catch(err=>{
					uni.hideLoading()
					uni.showToast({
						icon: 'error',
						title: '加载失败'
					})
				})
			},
			onPick6(level, index, value, selectedIndexes){
				const _first = selectedIndexes[0]
				// 获取当前项
				const item = selectedIndexes.reduce((p, c, i) => {
					return i == 0 ? p : p?.['children']?.[c]
				}, this.options6[_first])
				const _code = item?.[`code`]
				const _children = item?.[`children`]
				
				if(item != null && _code == value && _children != null && _children.length == 0)  {
					this.getUniCloudCity({type: level + 1, parent_code: _code}, selectedIndexes)
				}
			},
			//加载本地数据~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			onChange7(value, options) {
				this.fieldValue7 = options.map((item) => (item['label'])).join('/');
			},
			//异步~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
			onChange8(value, options) {
				this.fieldValue8 = options.map((item) => (item['label'])).join('/');
			},
			addChild(parent, child, deeps){
				if(deeps.length > 1) {
					const i = deeps.shift();
					this.addChild(parent[i]['children'], child, deeps)
				} else if(deeps.length == 1){
					const i = deeps.shift();
					parent[i]['children'] = child
				}
			},
			onPick8(level, index, value, selectedIndexes) {
				// 第一项目下标
				const _first = selectedIndexes[0]
				// 获取当前项
				const item = selectedIndexes.reduce((p, c, i) => {
					return i == 0 ? p : p?.['children']?.[c]
				}, this.options8[_first])
				const _value = item?.[`value`]
				const _children = item?.['children']
				
				if(
					_value == value &&
					_children != null && _children.length == 0
				) {
					
					uni.showToast({
						icon: 'loading',
						title: '加载中',
						duration: 1000,
					})
					setTimeout(()=>{
						uni.hideToast()
						this.addChild(this.options8, [
							{ value: '440304' + level, label: '福田区'+ level, children:[] },
							{ value: '440303' + level, label: '罗湖区'+ level },
							{ value: '440305' + level, label: '南山区'+ level },
							{ value: '440306' + level, label: '宝安区'+ level },
							{ value: '440307' + level, label: '龙岗区'+ level },
							{ value: '440308' + level, label: '盐田区'+ level },
							{ value: '440309' + level, label: '龙华区'+ level },
							{ value: '440310' + level, label: '坪山区'+ level },
							{ value: '440311' + level, label: '光明区'+ level },
						], [...selectedIndexes]);
					},1000)
				}
			}
		}
	}
</script>

<style lang="scss">
	.cell {
		display: flex;
		flex-direction: row;
		justify-content: space-between;
		padding: 16px;
		background-color: white;
	}
	.btn {
		margin-bottom: 20rpx;
		margin-right: 20rpx;
		align-self: center;
	}
	.demo-block {
		margin: 32px 0 0;
		
		// overflow: visible;
		&.card{
			// background-color: white;
			padding: 30rpx;
			margin-bottom: 20rpx;
		}
		&__title {
			margin: 0;
			margin-top: 8px;
			&-text {
				color: rgba(0, 0, 0, 0.6);
				font-weight: 400;
				font-size: 14px;
				line-height: 16px;
				display: flex;
				margin-left: 20px;
				&.large {
					color: rgba(0, 0, 0, 0.9);
					font-size: 18px;
					font-weight: 700;
					line-height: 26px;
					margin-left: 20px;
				}
				&.ultra {
					color: rgba(0, 0, 0, 0.9);
					font-size: 24px;
					font-weight: 700;
					line-height: 32px;
				}
			}
		}
		&__desc-text {
			color: rgba(0, 0, 0, 0.6);
			margin: 8px 16px 0 0;
			font-size: 14px;
			line-height: 22px;
			margin-left: 20px;
		}
		&__body {
			margin: 16px 0;
			overflow: visible;
			.demo-block {
				// margin-top: 0px;
				margin: 0;
			}
		}
	}
</style>
