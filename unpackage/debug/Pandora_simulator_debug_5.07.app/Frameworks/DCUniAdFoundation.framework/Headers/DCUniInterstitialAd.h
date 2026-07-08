//
//  DCUniInterstitialAd.h
//  DCUniAdFoundation
//
//  Created by dcloud on 2022/1/25.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
NS_ASSUME_NONNULL_BEGIN
@class DCUniInterstitialAd;
@protocol DCUniInterstitialAdDelegate <NSObject>
@optional
/// 广告加载完成
/// @param interstitialAd  实例对象
- (void)interstitialAdDidLoad:(DCUniInterstitialAd *)interstitialAd;

///  广告加载出错
/// @param interstitialAd 实例对象
/// @param error 错误信息
- (void)interstitialAd:(DCUniInterstitialAd *)interstitialAd didFailWithError:(NSError *_Nullable)error;

/// 广告关闭
/// @param interstitialAd 实例对象
- (void)interstitialAdDidClose:(DCUniInterstitialAd *)interstitialAd;


/// 广告播放完毕
/// @param interstitialAd 实例对象
/// @param error 错误信息
- (void)interstitialAdDidPlayFinish:(DCUniInterstitialAd *)interstitialAd didFailWithError:(NSError *_Nullable)error;

/// 广告展示失败
/// - Parameters:
///   - interstitialAd 实例对象
///   - error 具体错误信息
- (void)interstitialAdDidShowFailed:(DCUniInterstitialAd *)interstitialAd error:(NSError *)error;

/// 广告点击回调
/// @param interstitialAd 实例对象
- (void)interstitialAdDidClicked:(DCUniInterstitialAd *)interstitialAd;

/// 广告曝光回调
/// @param interstitialAd 实例对象
- (void)interstitialAdDidVisible:(DCUniInterstitialAd *)interstitialAd;

/// 广告跳过回调
/// - Parameter interstitialAd 实例对象
- (void)interstitialAdDidClickSkip:(DCUniInterstitialAd *)interstitialAd;


@end
@interface DCUniInterstitialAd : NSObject

/// 广告位ID
@property (nonatomic, strong, readonly) NSString *slotID;

/// 广告代理对象
@property (nonatomic, weak) id<DCUniInterstitialAdDelegate> delegate;

/// 构造器
/// - Parameter 广告位ID
- (instancetype)initWithSlotID:(NSString *)slotID;

/// 加载广告
- (void)loadAdData;

/// 播放广告
/// @param rootViewController 播放广告所需要的ViewController
- (void)showAdFromRootViewController:(UIViewController *)rootViewController;
@end

NS_ASSUME_NONNULL_END
