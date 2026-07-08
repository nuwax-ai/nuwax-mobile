//
//  DCUniAdCustomSplashAdapter.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/25.
//

#import <Foundation/Foundation.h>

@protocol DCUniAdCustomAdapter;
@protocol DCUniAdCustomSplashAdapterBridge;

@protocol DCUniAdCustomSplashAdapter <DCUniAdCustomAdapter>

/// 当前加载的广告的状态
- (BOOL)mediatedAdStatus;

/// 加载广告的方法
/// @param slotID adn的广告位ID
/// @param parameter 广告加载的参数
- (void)loadSplashAdWithSlotID:(NSString *)slotID andParameter:(NSDictionary *)parameter;

/// 展示开屏广告
/// @param window 广告展示窗口
/// @param parameter 广告展示参数
- (void)showSplashAdInWindow:(UIWindow *)window parameter:(NSDictionary *)parameter;
@end

