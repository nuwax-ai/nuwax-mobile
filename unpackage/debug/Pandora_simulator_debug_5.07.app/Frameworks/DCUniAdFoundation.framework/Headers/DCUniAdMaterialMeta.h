//
//  DCUniAdMaterialMeta.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2025/7/8.
//

#import <Foundation/Foundation.h>
#import "DCUniAdMediatedNativeAdData.h"

NS_ASSUME_NONNULL_BEGIN

@interface DCUniAdMaterialMeta : NSObject

/// 广告标题
@property (nonatomic, copy, readonly, nullable) NSString *title;

/// 广告详情描述
@property (nonatomic, copy, readonly, nullable) NSString *desc;

/// 应用来源、市场，例如'App Store'
@property (nonatomic, copy, readonly, nullable) NSString *AdSource;

/// 物料图片集
@property (nonatomic, strong, readonly, nullable) NSArray<DCUniAdImage *> *imageAry;

/// 广告支持的跳转类型
@property (nonatomic, assign, readonly) DCUniAdMediatedNativeAdInteractionType interactionType;

/// 广告adn的logo
@property (nonatomic, strong, readonly, nullable) DCUniAdImage *icon;

/// app评分，区间为1-5，如果没有值返回-1
@property (nonatomic, assign, readonly) CGFloat appScore;

/// 按钮文案，例如'下载/安装'
@property (nonatomic, copy, readonly, nullable) NSString *buttonText;

/// 视频时长，单位秒，如果没有值返回0
@property (nonatomic, assign, readonly) NSInteger videoDuration;

/// 广告的类型
@property (nonatomic, assign, readonly) DCUniAdMediatedNativeAdMode adMode;

@end

NS_ASSUME_NONNULL_END
