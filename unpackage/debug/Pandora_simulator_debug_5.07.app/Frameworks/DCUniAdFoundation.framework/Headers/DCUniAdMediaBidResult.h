//
//  DCUniAdMediaBidResult.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/25.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniAdMediaBidResult : NSObject

/// 是否胜出
@property (nonatomic, assign, readonly) BOOL win;

/// 胜出价格
@property (nonatomic, assign, readonly) NSInteger winnerPrice;

/// 扩展参数
@property (nonatomic, copy, readonly) NSDictionary *ext;

/// 原始广告数据
@property (nonatomic, strong, readonly) id originNativeAdData;

@end

NS_ASSUME_NONNULL_END
