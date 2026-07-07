//
//  DCUniAdMediatedNativeAd.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/30.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import "DCUniAdMediatedNativeAdData.h"
#import "DCUniAdMediatedNativeAdViewCreator.h"
NS_ASSUME_NONNULL_BEGIN

@interface DCUniAdMediatedNativeAd : NSObject

// 广告视图对象，一般指原生广告的根视图
@property (nonatomic, strong, nullable) UIView *view;

// adn获取到的原始广告数据 [Required] (adn广告回调的原始数据，通过该数据建立对应关系)
@property (nonatomic, strong, nonnull) id originMediatedNativeAd;

// 广告物料，包含有最全的广告数据
@property (nonatomic, strong, nullable) id<DCUniAdMediatedNativeAdData> data;

// 广告视图创建对象，对常用广告展示元素进行创建（存在意义：对部分adn创建特定视图的支持）
@property (nonatomic, strong, nullable) id<DCUniAdMediatedNativeAdViewCreator> viewCreator;

@end

NS_ASSUME_NONNULL_END
