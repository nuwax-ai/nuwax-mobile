//
//  DCUniAdCustomContentAdapter.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/7.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
NS_ASSUME_NONNULL_BEGIN
@protocol DCUniAdCustomAdapter;
@protocol DCUniAdCustomContentAdapterBridge;

@protocol DCUniAdCustomContentAdapter <DCUniAdCustomAdapter>
/// 构造方法
/// 通过bridge回传广告状态
- (instancetype)initWithBridge:(id<DCUniAdCustomContentAdapterBridge>)bridge;

/// 加载广告的方法
/// @param slotID adn的广告位ID
/// @param parameter 广告加载的参数
- (UIViewController *)loadAdWithSlotID:(NSString *)slotID andParameter:(NSDictionary *)parameter;


/// 暂停播放
- (void)pause;

/// 继续播放
- (void)resume;
@end

NS_ASSUME_NONNULL_END
