//
//  DCUniAdCustomInterstitialAdapterBridge.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/6.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@protocol DCUniAdCustomInterstitialAdapter;
@protocol DCUniAdCustomInterstitialAdapterBridge <NSObject>

@optional

/// 在广告中素材加载完成时调用
/// @param adapter 当前适配器
- (void)interstitialAd:(id<DCUniAdCustomInterstitialAdapter>)adapter didLoadWithExt:(NSDictionary *)ext;

/// 在广告加载失败时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)interstitialAd:(id<DCUniAdCustomInterstitialAdapter>)adapter didLoadFailWithError:(NSError *)error;

/// 在广告已经展示时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)interstitialAdDidVisible:(id<DCUniAdCustomInterstitialAdapter>)adapter;

/// 广告展示失败的时候调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)interstitialAdDidShowFailed:(id<DCUniAdCustomInterstitialAdapter>)adapter error:(NSError *)error;

/// 在广告点击事件触发时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)interstitialAdDidClick:(id<DCUniAdCustomInterstitialAdapter>)adapter;

/// 在广告被点击跳过时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)interstitialAdDidClickSkip:(id<DCUniAdCustomInterstitialAdapter>)adapter;

/// 在广告视频播放完成时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)interstitialAd:(id<DCUniAdCustomInterstitialAdapter>)adapter didPlayFinishWithError:(NSError *)error;

/// 在广告关闭时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)interstitialAdDidClose:(id<DCUniAdCustomInterstitialAdapter>)adapter;

@end

NS_ASSUME_NONNULL_END
