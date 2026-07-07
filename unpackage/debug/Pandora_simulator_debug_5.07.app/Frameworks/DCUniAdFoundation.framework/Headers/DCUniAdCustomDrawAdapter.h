//
//  DCUniAdCustomDrawAdapter.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/1.
//

#import <Foundation/Foundation.h>

@protocol DCUniAdCustomAdapter;
@protocol DCUniAdCustomDrawAdapterBridge;
NS_ASSUME_NONNULL_BEGIN

@protocol DCUniAdCustomDrawAdapter <DCUniAdCustomAdapter>

/// 加载广告的方法
/// @param slotID adn的广告位ID
/// @param size 广告展示尺寸
/// @param parameter 广告加载的参数
- (void)loadDrawAdWithSlotID:(NSString *)slotID
                       adSize:(CGSize)size
                    parameter:(NSDictionary *)parameter;


/// drawAd广告注册容器
/// @param containerView 视图容器
/// @param drawAd 广告对象
- (void)registerContainerView:(UIView *)containerView forDrawAd:(id)drawAd;


/// 为drawAd设置控制器
/// @param viewController 广告点击事件跳转控制器
/// @param drawAd  广告对象
- (void)setRootViewController:(UIViewController *)viewController forDrawAd:(id)drawAd;

@end

NS_ASSUME_NONNULL_END
