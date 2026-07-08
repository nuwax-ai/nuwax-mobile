//
//  DCUniAdCustomConfigAdapter.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/18.
//

#import <Foundation/Foundation.h>
#import "DCUniAdEnum.h"
NS_ASSUME_NONNULL_BEGIN
@class DCUniAdSDKInitConfig;
@protocol DCUniAdCustomConfigAdapterBridge;

@protocol DCUniAdCustomSplashAdapter;
@protocol DCUniAdCustomSplashAdapterBridge;

@protocol DCUniAdCustomRewardedVideoAdapter;
@protocol DCUniAdCustomRewardedVideoAdapterBridge;

@protocol DCUniAdCustomInterstitialAdapter;
@protocol DCUniAdCustomInterstitialAdapterBridge;

@protocol DCUniAdCustomFullscreenVideoAdapter;
@protocol DCUniAdCustomFullscreenVideoAdapterBridge;

@protocol DCUniAdCustomNativeAdapter;
@protocol DCUniAdCustomNativeAdapterBridge;

@protocol DCUniAdCustomDrawAdapter;
@protocol DCUniAdCustomDrawAdapterBridge;

/// 自定义adapter的基本配置协议
@protocol DCUniAdCustomConfigAdapter <NSObject>

/// 构造函数，通过bridge通知初始化成功和失败
/// @param bridge 代理。用于通知初始化成功或初始化失败
- (instancetype)initWithBridge:(id<DCUniAdCustomConfigAdapterBridge>)bridge;

/// adn初始化方法
/// @param initConfig 初始化配置，包括appid、appkey基本信息和用户自定义参数等
- (void)initAdapterWithConfiguration:(DCUniAdSDKInitConfig *)initConfig;

/// adapter的版本号
- (NSString *)adapterVersion;

/// adn的版本号
- (NSString *)networkSdkVersion;

@optional

/// 个性化开关，默认为YES
/// - Parameter isOpen: YES 开启个性化设置；NO 关闭个性化设置
- (void)setPersonalized:(BOOL)isOpen;

/// 构造方法-开屏
/// - Parameter bridge: 回传开屏广告状态
- (id<DCUniAdCustomSplashAdapter>)loadSplashAdapterWithBridge:(id<DCUniAdCustomSplashAdapterBridge>)bridge;


/// 构造方法-激励视频
/// - Parameter bridge: 回传激励视频广告状态
- (id<DCUniAdCustomRewardedVideoAdapter>)loadRewardedVideoAdapterWithBridge:(id<DCUniAdCustomRewardedVideoAdapterBridge>)bridge;

/// 构造方法-插屏
/// - Parameter bridge: 回传插屏广告状态
- (id<DCUniAdCustomInterstitialAdapter>)loadInterstitialAdapterWithBridge:(id<DCUniAdCustomInterstitialAdapterBridge>)bridge;

/// 构造方法-全屏视频
/// - Parameter bridge: 回传全屏广告状态
- (id<DCUniAdCustomFullscreenVideoAdapter>)loadFullscreenVideoAdapterWithBridge:(id<DCUniAdCustomFullscreenVideoAdapterBridge>)bridge;

/// 构造方法-信息流
/// - Parameter bridge: 回传信息流广告状态
- (id<DCUniAdCustomNativeAdapter>)loadNativeAdapterWithBridge:(id<DCUniAdCustomNativeAdapterBridge>)bridge;

/// 构造方法-draw
/// - Parameter bridge: 回传draw广告状态
- (id<DCUniAdCustomDrawAdapter>)loadDrawAdapterWithBridge:(id<DCUniAdCustomDrawAdapterBridge>)bridge;



@end

NS_ASSUME_NONNULL_END
