//
//  DCUniAdCustomNativeAdapterBridge.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/29.
//

#import <Foundation/Foundation.h>
#import "DCUniAdEnum.h"
NS_ASSUME_NONNULL_BEGIN

@protocol DCUniAdCustomNativeAdapter;

@protocol DCUniAdCustomNativeAdapterBridge <NSObject>
@optional

#pragma mark - Load

/// 在广告加载完成时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param ads 广告数据组
/// @param exts 回传信息
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter didLoadWithNativeAds:(NSArray * _Nullable)ads exts:(NSArray<NSDictionary *> * _Nullable)exts;

/// 在广告加载失败时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter didLoadFailWithError:(NSError *_Nonnull)error;

#pragma mark - View

/// 广告展示时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param nativeAd  广告数据
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter
didVisibleWithMediatedNativeAd:(id _Nonnull)nativeAd;

/// 广告点击事件时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param nativeAd 广告数据
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter
didClickWithMediatedNativeAd:(id _Nonnull)nativeAd;

/// 在模板广告关闭的时候调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param nativeAd 广告数据
/// @param filterWords 用户手动关闭时的关闭原因描述
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter
        didClose:(id _Nonnull)nativeAd
    closeReasons:(NSArray<NSString *> *_Nullable)filterWords;

/// 在渲染成功或者模板广告的尺寸更新时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param expressView 模板广告
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter
renderSuccessWithExpressView:(UIView *_Nonnull)expressView;

/// 在渲染失败调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param expressView 模板广告
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter
renderFailWithExpressView:(UIView *_Nonnull)expressView
        andError:(NSError *_Nonnull)error;

/// 在广告即将展示详情页时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param nativeAd 广告数据
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter
willPresentFullScreenModalWithMediatedNativeAd:(id _Nonnull)nativeAd;


/// 在广告落地页关闭时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param nativeAd 广告数据
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter
didDismissFullScreenModalWithMediatedNativeAd:(id _Nonnull)nativeAd;

/// 视频广告中视频播放状态变更的时候调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param state 播放状态
/// @param nativeAd 广告数据
- (void)nativeAd:(id<DCUniAdCustomNativeAdapter>_Nonnull)adapter
videoStateDidChangedWithState:(DCUniAdMediaPlayerStatus)state
     andNativeAd:(id _Nonnull)nativeAd;

@end

NS_ASSUME_NONNULL_END
