//
//  DCUniAdMediatedNativeAdData.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2025/7/9.
//

#import <Foundation/Foundation.h>

typedef NS_ENUM (NSInteger, DCUniAdMediatedNativeAdInteractionType) {
    DCUniAdMediatedNativeAdTypeUnknown        = 0,
    DCUniAdMediatedNativeAdTypeNone           = 1,  // pure ad display
    DCUniAdMediatedNativeAdTypeURL            = 2,  // open the webpage using a browser
    DCUniAdMediatedNativeAdTypePage           = 3,  // open the webpage within the app
    DCUniAdMediatedNativeAdTypeDownload       = 4,  // download the app
    DCUniAdMediatedNativeAdTypePhone          = 5,  // make a call
    DCUniAdMediatedNativeAdTypeMessage        = 6,  // send messages
    DCUniAdMediatedNativeAdTypeEmail          = 7,  // send email
    DCUniAdMediatedNativeAdTypeVideoAdDetail  = 8,   // video ad details page
    DCUniAdMediatedNativeAdTypeWechat = 9,          // open wechat
    DCUniAdMediatedNativeAdTypeDeepLink = 10,       // deep link
    DCUniAdMediatedNativeAdTypeOthers         = 100 //其他广告sdk返回的类型
};

typedef NS_ENUM(NSInteger, DCUniAdMediatedNativeAdMode) {
    DCUniAdMediatedNativeAdModeUnknown = 0,          // 未知
    DCUniAdMediatedNativeAdModeVideo = 1,            // 视频
    DCUniAdMediatedNativeAdModeSingleImage = 2,      // 单图
    DCUniAdMediatedNativeAdModeGroupImages = 3,      // 多图
};


@class DCUniAdImage;
@class DCUniAdDislikeWords;
NS_ASSUME_NONNULL_BEGIN

@protocol DCUniAdMediatedNativeAdData <NSObject>

/// 广告标题
@property (nonatomic, copy, readonly, nullable) NSString *title;

/// 广告详情描述
@property (nonatomic, copy, readonly, nullable) NSString *desc;

/// 应用来源、市场，例如'App Store'
@property (nonatomic, copy, readonly, nullable) NSString *AdSource;

/// 物料图片集，如果图片有宽高，请尽量配置width和height
@property (nonatomic, strong, readonly, nullable) NSArray<DCUniAdImage *> *imageAry;

/// 广告adn的logo，如果logo有宽高，请尽量配置width和height
@property (nonatomic, strong, readonly, nullable) DCUniAdImage *icon;

/// 广告支持的跳转类型
@property (nonatomic, assign, readonly) DCUniAdMediatedNativeAdInteractionType interactionType;

/// 广告的类型
@property (nonatomic, assign, readonly) DCUniAdMediatedNativeAdMode adMode;

/// app评分，区间为1-5，如果没有值返回-1
@property (nonatomic, assign, readonly) CGFloat appScore;

/// 按钮文案，例如'下载/安装'
@property (nonatomic, copy, readonly, nullable) NSString *buttonText;

/// 评论数量，如果没有值返回-1
//@property (nonatomic, assign, readonly) NSInteger commentNum;

/// 广告安装包体大小，单位KB，如果没有值返回-1
//@property (nonatomic, assign, readonly) NSInteger appSize;

/// app购买价格，例如'免费'，没有则为nil
//@property (nonatomic, strong, readonly, nullable) NSString *appPrice;

/// 视频时长，单位秒，如果没有值返回0
@property (nonatomic, assign, readonly) NSInteger videoDuration;

/// the reason why dislike the ad.
@property (nonatomic, copy, readonly, nullable) NSArray<DCUniAdDislikeWords *> *filterWords;


@property (nonatomic, copy, readonly, nullable) NSDictionary *mediaExt;


@end

NS_ASSUME_NONNULL_END
