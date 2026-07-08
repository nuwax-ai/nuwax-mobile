//
//  DCUniAdCustomDrawAdapterBridge.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/1.
//

#import <Foundation/Foundation.h>

@protocol DCUniAdCustomDrawAdapter;
NS_ASSUME_NONNULL_BEGIN

@protocol DCUniAdCustomDrawAdapterBridge <NSObject>

@optional

#pragma mark - Load

/// 在广告加载完成时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param ads 广告数据组
/// @param exts 回传信息
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter didLoadWithDrawAds:(NSArray * _Nullable)ads exts:(NSArray<NSDictionary *> * _Nullable)exts;

/// 在广告加载失败时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param error 错误信息
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter didLoadFailWithError:(NSError *_Nonnull)error;

#pragma mark - View

/// 广告展示时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param drawAd  广告数据
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter
didVisibleWithMediatedAd:(id _Nonnull)drawAd;

/// 广告点击事件时调用该方法，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param drawAd 广告数据
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter
didClickWithMediatedAd:(id _Nonnull)drawAd;

/// 在模板广告关闭的时候调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param drawAd 广告数据
/// @param filterWords 用户手动关闭时的关闭原因描述
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter
        didClose:(id _Nonnull)drawAd
    closeReasons:(NSArray<NSString *> *_Nullable)filterWords;

/// 仅限模板广告，在渲染成功或者模板广告的尺寸更新时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param expressView 模板广告
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter
renderSuccessWithExpressView:(UIView *_Nonnull)expressView;

/// 仅限模板广告，在渲染失败调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param expressView 模板广告
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter
renderFailWithExpressView:(UIView *_Nonnull)expressView
        andError:(NSError *_Nonnull)error;

/// 在广告即将展示详情页时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param drawAd 广告数据
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter
willPresentFullScreenModalWithMediatedAd:(id _Nonnull)drawAd;


/// 在广告落地页关闭时调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param drawAd 广告数据
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter
didDismissFullScreenModalWithMediatedAd:(id _Nonnull)drawAd;

/// 视频广告中视频播放状态变更的时候调用，直接调用即可，无需做响应判断
/// @param adapter 当前适配器
/// @param state 播放状态
/// @param drawAd 广告数据
- (void)drawAd:(id<DCUniAdCustomDrawAdapter>_Nonnull)adapter
videoStateDidChangedWithState:(DCUniAdMediaPlayerStatus)state
     andAd:(id _Nonnull)drawAd;
@end

NS_ASSUME_NONNULL_END
