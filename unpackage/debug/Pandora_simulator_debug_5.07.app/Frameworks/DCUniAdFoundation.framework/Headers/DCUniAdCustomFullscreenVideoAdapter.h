//
//  DCUniAdCustomFullScreenVideoAdapter.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/6.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@protocol DCUniAdCustomAdapter;
@protocol DCUniAdCustomFullscreenVideoAdapterBridge;

@protocol DCUniAdCustomFullscreenVideoAdapter <DCUniAdCustomAdapter>

/// 当前加载的广告的状态
- (BOOL)mediatedAdStatus;

/// 加载广告的方法
/// @param slotID adn的广告位ID
/// @param parameter 广告加载的参数
- (void)loadAdWithSlotID:(NSString *)slotID andParameter:(NSDictionary *)parameter;

/// 展示广告的方法
/// @param viewController 控制器对象
/// @param parameter 展示广告的参数
- (BOOL)showAdFromRootViewController:(UIViewController *)viewController parameter:(NSDictionary *)parameter;
@end

NS_ASSUME_NONNULL_END
