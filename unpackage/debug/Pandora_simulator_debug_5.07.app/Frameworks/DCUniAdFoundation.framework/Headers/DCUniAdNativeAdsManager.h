//
//  DCUniAdNativeAdsManager.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/31.
//

#import <Foundation/Foundation.h>
@class DCUniAdNativeAdsManager;
@class DCUniAdNativeAd;
NS_ASSUME_NONNULL_BEGIN

@protocol DCUniAdNativeAdsManagerDelegate <NSObject>

@optional

/// 广告加载成功回调
/// - Parameter adsManager: DCUniAdNativeAdsManager 实例对象
- (void)nativeAdsManagerSuccessToLoad:(DCUniAdNativeAdsManager *)adsManager nativeAds:(NSArray<DCUniAdNativeAd *> *)nativeAdDataArray;

/// 广告加载出错
/// - Parameters:
///   - adsManager: DCUniAdNativeAdsManager 实例对象
///   - error: 具体错误信息
- (void)nativeAdsManager:(DCUniAdNativeAdsManager *)adsManager didFailWithError:(NSError *)error;

@end

@interface DCUniAdNativeAdsManager : NSObject

/// 广告代理对象
@property (nonatomic, weak) id<DCUniAdNativeAdsManagerDelegate> delegate;

/// 广告位ID
@property (nonatomic, strong, readonly) NSString *slotID;

/*
 * 必传参数，为空时聚合会默认设置为width=screen.bouces.size.width; height=0
 */
@property (nonatomic, assign, readwrite) CGSize adSize;

/// 构造器
/// - Parameter slotID: 广告位ID
- (instancetype)initWithSlotID:(NSString *)slotID;


/// 加载广告
/// @param count 加载广告的个数，推荐一次性不要超过3条，默认1条
- (void)loadAdDataWithCount:(NSInteger)count;

@end

NS_ASSUME_NONNULL_END
