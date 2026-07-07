//
//  DCUniAdCustomNativeAdapter.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/29.
//

#import <Foundation/Foundation.h>

@protocol DCUniAdCustomAdapter;
@protocol DCUniAdCustomNativeAdapterBridge;

@protocol DCUniAdCustomNativeAdapter <DCUniAdCustomAdapter>

/// 加载广告的方法
/// @param slotID adn的广告位ID
/// @param size 广告展示尺寸
/// @param parameter 广告加载的参数
- (void)loadNativeAdWithSlotID:(NSString *)slotID
                       adSize:(CGSize)size
                    parameter:(NSDictionary *)parameter;


/// 渲染广告
/// @param expressAdView 模版视图
- (void)renderForExpressAdView:(UIView *)expressAdView;


/// 为模板广告设置控制器
/// @param viewController 广告点击事件跳转控制器
/// @param expressAdView 模板广告视图对象
- (void)setRootViewController:(UIViewController *)viewController forExpressAdView:(UIView *)expressAdView;


@end

