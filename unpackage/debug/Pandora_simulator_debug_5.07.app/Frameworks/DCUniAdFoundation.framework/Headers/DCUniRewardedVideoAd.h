//
//  DCUniRewardedVideoAd.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/5.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
@class DCUniAdRewardInfo;
@class DCUniServerSideVerificationOptions;
@class DCUniRewardedVideoAd;
NS_ASSUME_NONNULL_BEGIN

@protocol DCUniRewardVideoAdDelegate<NSObject>
@optional

/// 广告加载成功
/// - Parameter rewardVideoAd: DCUniRewardedVideoAd 实例对象
- (void)rewardVideoAdDidLoad:(DCUniRewardedVideoAd *)rewardVideoAd;

/// 广告加载失败
/// - Parameters:
///   - rewardVideoAd: DCUniRewardedVideoAd 实例对象
///   - error: 具体错误信息
- (void)rewardVideoAdDidLoad:(DCUniRewardedVideoAd *)rewardVideoAd didFailWithError:(NSError *)error;

/// 广告曝光回调
/// - Parameter rewardVideoAd: DCUniRewardedVideoAd 实例对象
- (void)rewardVideoAdDidVisible:(DCUniRewardedVideoAd *)rewardVideoAd;

/// 广告播放失败回调
/// - Parameters:
///   - rewardVideoAd: DCUniRewardedVideoAd 实例对象
///   - error: 具体错误信息
- (void)rewardVideoAdDidShowFailed:(DCUniRewardedVideoAd *)rewardVideoAd error:(NSError *)error;

/// 广告点击回调
/// - Parameter rewardVideoAd: DCUniRewardedVideoAd 实例对象
- (void)rewardVideoAdDidClick:(DCUniRewardedVideoAd *)rewardVideoAd;

/// 广告跳过回调
/// - Parameter rewardVideoAd: DCUniRewardedVideoAd 实例对象
- (void)rewardVideoAdDidClickSkip:(DCUniRewardedVideoAd *)rewardVideoAd;

/// 广告关闭回调
/// - Parameter rewardVideoAd: DCUniRewardedVideoAd 实例对象
- (void)rewardVideoAdDidClose:(DCUniRewardedVideoAd *)rewardVideoAd;

/// 广告获得激励时回调
/// - Parameters:
///   - rewardVideoAd: DCUniRewardedVideoAd 实例对象
///   - reward: 激励信息
- (void)rewardVideoAd:(DCUniRewardedVideoAd *)rewardVideoAd reward:(DCUniAdRewardInfo *)reward;

/// 广告视频播放完成或者视频播放出错
/// - Parameters:
///   - rewardVideoAd: DCUniRewardedVideoAd 实例对象
///   - error: 具体错误信息
- (void)rewardVideoAdDidPlayFinish:(DCUniRewardedVideoAd *)rewardVideoAd didFailWithError:(NSError * _Nullable)error;
@end

@interface DCUniRewardedVideoAd : NSObject

/// 广告代理对象
@property (nonatomic, weak) id<DCUniRewardVideoAdDelegate> delegate;

/// 广告位ID
@property (nonatomic, strong, readonly) NSString *slotID;

/// 激励视频服务器回调数据
@property (nonatomic, strong) DCUniServerSideVerificationOptions *adOptions;

/// 构造器
/// - Parameter slotID: 广告位ID
- (instancetype)initWithSlotID:(NSString *)slotID;

/// 加载广告
- (void)loadAdData;

/// 播放广告
/// @param rootViewController 播放广告所需要的ViewController
- (void)showAdFromRootViewController:(UIViewController *)rootViewController;

@end

NS_ASSUME_NONNULL_END
