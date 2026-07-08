//
//  DCUniAdSpotVideoView.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2025/7/17.
//

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@class DCUniAdNativeAd;

/**
 * 关闭回调block
 */
typedef void(^DCUniAdSpotVideoViewCloseBlock)(void);

@interface DCUniAdSpotVideoView : UIView

/**
 * 关闭回调
 */
@property (nonatomic, copy, nullable) DCUniAdSpotVideoViewCloseBlock closeBlock;

/**
 * 使用原生广告刷新UI
 * @param nativeAd 原生广告对象
 */
- (void)refreshUIWithNativeAd:(DCUniAdNativeAd *)nativeAd;

/**
 * 开始倒计时
 */
- (void)startCountdown;

/**
 * 暂停倒计时
 */
- (void)pauseCountdown;

/**
 * 恢复倒计时
 */
- (void)resumeCountdown;

/**
 * 关闭视图
 */
- (void)close;

@end

NS_ASSUME_NONNULL_END 
