//
//  DCUniAdEnum.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/31.
//

typedef NS_ENUM(NSUInteger, DCUniAdMediaPlayerStatus) {
    DCUniAdMediaPlayerStatusInitial = 0,         // 初始状态
    DCUniAdMediaPlayerStatusLoading = 1,         // 加载中
    DCUniAdMediaPlayerStatusStarted = 2,         // 开始播放
    DCUniAdMediaPlayerStatusPaused = 3,          // 播放暂停
    DCUniAdMediaPlayerStatusError = 4,           // 播放出错
    DCUniAdMediaPlayerStatusStoped = 5,          // 播放停止
    DCUniAdMediaPlayerStatusResume = 6,          // 恢复播放
    DCUniAdMediaPlayerStatusWillStart = 10,      // 即将播放
};

typedef NS_ENUM(NSInteger, DCUniAdNativeAdSlotAdType) {
    DCUniAdNativeAdSlotAdTypeFeed       = 1,       // 模版信息流
    DCUniAdNativeAdSlotAdTypeDraw       = 2,       // draw信息流
    DCUniAdNativeAdSlotAdTypeFeedVideo  = 3,       // 贴片视频
};

//typedef NS_ENUM(NSInteger, DCUniAdSlotType) {
//    DCUniAdSlotTypeSplash             = 1,       // 开屏
//    DCUniAdSlotTypeRewardVideo        = 2,       // 激励视频
//    DCUniAdSlotTypeInterstitial       = 3,       // 插屏
//    DCUniAdSlotTypeFullscreenVideo    = 4,       // 全屏视频
//    DCUniAdSlotTypeNative             = 5,       // 信息流(仅支持模版)
//    DCUniAdSlotTypeDraw               = 6,       // draw
//    DCUniAdSlotTypeNativeFeedVideo    = 7,       // 信息流(贴片视频)
//};

//信息流模板 展示类型(仅海外广告使用)
typedef NS_ENUM(NSInteger, DCUniAdTemplateType) {
    DCUniAdTemplateTypeSmall = 1,               //小
    DCUniAdTemplateTypeMiddle = 2               //中
};

typedef NS_ENUM(NSInteger, DCUniAdInterstitialType) {
    DCUniAdInterstitialTypeFullscreen          = 0,       // 全屏
    DCUniAdInterstitialTypeInterstitial        = 1,       // 插屏
    DCUniAdInterstitialTypeMix                 = 2,       // 优选
};
