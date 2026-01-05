<template>
    <view>
        <view class="x-dropdown" :style="customStyle" @click="click">
            <slot></slot>
        </view>
        <view class="x-dropdown-mask" :class="{'x-dropdown-mask-show': maskShow}" @click="close">
            <view class="x-dropdown-menu-container" :style="[layout]">
                <slot name="menu">
                    <view class="menu">
                        <view class="menu-item" :style="[{width: dropdownRect.width + 'px'}, menuStyle]" v-for="i,idx in menuList" @click="menuClick(i, idx)">
                            <text>{{ i }}</text>
                        </view>
                    </view>
                </slot>
            </view>
        </view>
    </view>
</template>
<script>
    import { queryElementRect } from '@/uni_modules/x-tools/tools/sugar.js'
    import { str2px, commonProps } from '@/uni_modules/x-tools/tools/com.js'

    export default {
        name: 'x-dropdown',
        props: {
            ...commonProps,
            menuList: {
                type: Object,
                default: () => ['菜单1', '菜单2', '菜单3']
            },
            menuStyle: {
                type: Object,
                default: () => ({})
            },
            interspace: {
                type: [String, Number],
                default: '10rpx'
            }
        },
        emits: ["open", "close", "change"],
        data() {
            return {
                maskShow: false,
                window: {
                    width: 0,
                    height: 0,
                },
                layout: {},
                innerInterspace: 0,
                dropdownRect: {
                    width: 0,
                }
            };
        },
        mounted() {
            this.init();
            this.innerInterspace = this.str2px(this.interspace)
        },
        methods: {
            str2px,
            queryElementRect,
            init() {
                // console.log('init');

                if (this.window.width === 0) {
                    uni.getSystemInfo({
                        success: (res) => {
                            const { windowWidth, windowHeight } = res
                            this.window = {
                                width: windowWidth,
                                height: windowHeight,
                            }
                        },
                        fail: () => {
                            this.init();
                        },
                    });
                }


                if (this.dropdownRect.width === 0) {
                    this.queryElementRect('.x-dropdown').then(res => {
                        this.dropdownRect = res
                    }).catch(res => {
                        this.init();
                    })
                }
            },
            async click(e) {

                const dropdownRect = await this.queryElementRect('.x-dropdown')
                const menuRect = await this.queryElementRect('.x-dropdown-menu-container')

                const { innerInterspace, window } = this;
                const { width, height } = window;
                const { left, right, top, bottom } = dropdownRect

                const layout = {
                    transition: 'transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
                    transform: "scaleY(1)"
                };

                layout.top = `${bottom + innerInterspace}px`;

                if (left + menuRect.width < width) {
                    layout.left = `${left}px`;
                } else {
                    const val = width - right
                    layout.right = `${val > 0 ? val : 0}px`;
                }


                this.layout = layout;
                this.maskShow = true;

                this.$emit("open")
                this.$emit("change", true)
            },
            menuClick(value, index) {
                this.$emit('menuClick', { value, index })
            },
            close() {
                this.maskShow = false;
                this.layout = {
                    transform: "scaleY(0)"
                };

                this.$emit("close");
                this.$emit("change", false)
            }
        },
    };
</script>

<style lang="scss" scoped>
    .x-dropdown {
        width: fit-content;
        position: relative;
        overflow: hidden;
    }


    .x-dropdown-mask {
        position: fixed;
        width: 100vw;
        height: 100vh;
        left: 0;
        top: 0;
        z-index: 999;
        transition: all 0.3s;
        opacity: 0;
        pointer-events: none;

        .x-dropdown-menu-container {
            position: absolute;
            transform-origin: top;
            transform: scaleY(0);

            .menu {
                position: relative;
                background: #FFFFFF;
                box-shadow: 0rpx 2rpx 20rpx 0rpx rgba(0, 0, 0, 0.3);
                border-radius: 8rpx;

                .menu-item {
                    padding: 24rpx 32rpx;
                    text-align: center;

                    text {
                        font-size: 28rpx;
                        color: #000;
                    }

                    &:active {
                        background-color: rgba(0, 0, 0, 0.1);
                    }
                }
            }
        }
    }


    .x-dropdown-mask-show {
        opacity: 1;
        pointer-events: auto;
    }
</style>