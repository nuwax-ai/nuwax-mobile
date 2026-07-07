//
//  DCUniFullscreenVideoAd.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/6.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
NS_ASSUME_NONNULL_BEGIN

@class DCUniFullscreenVideoAd;
@protocol DCUniFullscreenVideoAdDelegate <NSObject>
@optional
/// 广告加载完成
/// @param fullscreenVideoAd 实例对象
- (void)fullscreenVideoAdDidLoad:(DCUniFullscreenVideoAd *)fullscreenVideoAd;

/// 广告加载出错
/// @param fullscreenVideoAd 实例对象
/// @param error 错误信息
- (void)fullscreenVideoAd:(DCUniFullscreenVideoAd *)fullscreenVideoAd didFailWithError:(NSError *_Nullable)error;


/// 广告关闭
/// @param fullscreenVideoAd 实例对象
- (void)fullscreenVideoAdDidClose:(DCUniFullscreenVideoAd *)fullscreenVideoAd;


/// 广告播放完毕
/// @param fullscreenVideoAd 实例对象
/// @param error 错误信息
- (void)fullscreenVideoAdDidPlayFinish:(DCUniFullscreenVideoAd *)fullscreenVideoAd didFailWithError:(NSError *_Nullable)error;

/// 广告展示失败
/// - Parameters:
///   - fullscreenVideoAd 实例对象
///   - error 具体错误信息
- (void)fullscreenVideoAdDidShowFailed:(DCUniFullscreenVideoAd *)fullscreenVideoAd error:(NSError *)error;


/// 广告被点击
/// @param fullscreenVideoAd 实例对象
- (void)fullscreenVideoAdDidClicked:(DCUniFullscreenVideoAd *)fullscreenVideoAd;

/// 广告展示完毕
/// @param fullscreenVideoAd 实例对象
- (void)fullscreenVideoAdDidVisible:(DCUniFullscreenVideoAd *)fullscreenVideoAd;

/// 广告跳过回调
/// - Parameter fullscreenVideoAd 实例对象
- (void)fullscreenVideoAdDidClickSkip:(DCUniFullscreenVideoAd *)fullscreenVideoAd;

@end
@interface DCUniFullscreenVideoAd : NSObject
/// 广告位ID
@property (nonatomic, strong, readonly) NSString *slotID;

/// 广告代理对象
@property (nonatomic, weak) id<DCUniFullscreenVideoAdDelegate> delegate;

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
