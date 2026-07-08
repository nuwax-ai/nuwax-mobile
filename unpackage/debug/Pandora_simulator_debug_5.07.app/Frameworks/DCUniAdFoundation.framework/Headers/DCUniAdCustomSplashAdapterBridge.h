//
//  DCUniAdCustomSplashAdapterBridge.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/25.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
@protocol DCUniAdCustomSplashAdapter;

@protocol DCUniAdCustomSplashAdapterBridge <NSObject>

@optional
/// 在广告加载完成时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param ext  补充回传信息
- (void)splashAdDidLoad:(id<DCUniAdCustomSplashAdapter>)adapter didLoadWithExt:(NSDictionary *)ext;

/// 在广告加载失败时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)splashAd:(id<DCUniAdCustomSplashAdapter>)adapter didLoadFailWithError:(NSError *)error;

/// 在广告即将展示时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)splashAdWillVisible:(id<DCUniAdCustomSplashAdapter>)adapter;


/// 广告展示失败的时候调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)splashAdDidShowFailed:(id<DCUniAdCustomSplashAdapter>)adapter error:(NSError *)error;

/// 在广告点击事件触发时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)splashAdDidClick:(id<DCUniAdCustomSplashAdapter>)adapter;

/// 在广告跳过事件触发时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)splashAdDidClickSkip:(id<DCUniAdCustomSplashAdapter>)adapter;

/// 在广告关闭事件触发时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)splashAdDidClose:(id<DCUniAdCustomSplashAdapter>)adapter;

/// 广告即将展示广告详情页回调
- (void)splashAdWillPresentFullScreenModal:(id<DCUniAdCustomSplashAdapter>)adapter;

/// 广告点击跳转使用的控制器
- (UIViewController *)viewControllerForPresentingModalView;

@end


