//
//  DCUniAdCustomRewardedVideoAdapterBridge.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/5.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@class DCUniAdRewardInfo;
@protocol DCUniAdCustomRewardedVideoAdapter;

@protocol DCUniAdCustomRewardedVideoAdapterBridge <NSObject>

@optional

/// 在广告中素材加载完成时调用，此时广告预加载完成
/// @param adapter 当前适配器
/// @param ext 回传信息
- (void)rewardedVideoAd:(id<DCUniAdCustomRewardedVideoAdapter>)adapter didLoadWithExt:(NSDictionary *)ext;

/// 在广告加载失败时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)rewardedVideoAd:(id<DCUniAdCustomRewardedVideoAdapter>)adapter didLoadFailWithError:(NSError *)error;

/// 在广告已经展示时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)rewardedVideoAdDidVisible:(id<DCUniAdCustomRewardedVideoAdapter>)adapter;

/// 广告展示失败的时候调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)rewardedVideoAdDidShowFailed:(id<DCUniAdCustomRewardedVideoAdapter>)adapter error:(NSError *)error;

/// 在广告点击事件触发时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)rewardedVideoAdDidClick:(id<DCUniAdCustomRewardedVideoAdapter>)adapter;

/// 在广告被点击跳过时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)rewardedVideoAdDidClickSkip:(id<DCUniAdCustomRewardedVideoAdapter>)adapter;

/// 在广告关闭时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
- (void)rewardedVideoAdDidClose:(id<DCUniAdCustomRewardedVideoAdapter>)adapter;

/// 在广告视频播放完成时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)rewardedVideoAd:(id<DCUniAdCustomRewardedVideoAdapter>)adapter didPlayFinishWithError:(NSError *_Nullable)error;

/// 在ADN验证激励成功时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param info 激励信息
- (void)rewardedVideoAd:(id<DCUniAdCustomRewardedVideoAdapter>)adapter didRewardSuccessWithInfo:(DCUniAdRewardInfo *)info;
@end

NS_ASSUME_NONNULL_END
