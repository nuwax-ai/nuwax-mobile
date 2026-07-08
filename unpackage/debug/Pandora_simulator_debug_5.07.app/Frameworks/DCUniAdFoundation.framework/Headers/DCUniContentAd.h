//
//  DCUniContentAd.h
//  DCUniAdFoundation
//
//  Created by dcloud on 2022/4/12.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
@class DCUniContentAd;
NS_ASSUME_NONNULL_BEGIN

@protocol DCUniContentAdDelegate <NSObject>

@optional
/// 加载完成
/// @param contentAd  实例对象
- (void)contentDidLoad:(DCUniContentAd *)contentAd;

/// 加载出错
/// @param contentAd 实例对象
/// @param error 错误信息
- (void)content:(DCUniContentAd *)contentAd didFailWithError:(NSError *_Nullable)error;


/// 播放暂停
/// @param contentAd 实例对象
/// @param contentInfo 视频信息
- (void)contentDidPause:(DCUniContentAd *)contentAd info:(NSDictionary *)contentInfo;


/// 恢复播放
/// @param contentAd 实例对象
/// @param contentInfo 视频信息
- (void)contentDidResume:(DCUniContentAd *)contentAd info:(NSDictionary *)contentInfo;


/// 开始播放
/// @param contentAd 实例对象
/// @param contentInfo 视频信息
- (void)contentDidStartPlay:(DCUniContentAd *)contentAd info:(NSDictionary *)contentInfo;


/// 结束播放
/// @param contentAd 实例对象
/// @param contentInfo 视频信息
- (void)contentDidEndPlay:(DCUniContentAd *)contentAd info:(NSDictionary *)contentInfo;

@end

@interface DCUniContentAd : NSObject

/// 广告位ID
@property (nonatomic, strong, readonly) NSString *slotID;

/// 视图容器
@property (nonatomic, readonly) UIViewController *viewController;

/// 代理对象
@property (nonatomic, weak) id<DCUniContentAdDelegate> delegate;

/// 构造器
/// - Parameter 广告位ID
- (instancetype)initWithSlotID:(NSString *)slotID;


/// 加载内容联盟
- (void)loadContent;
@end

NS_ASSUME_NONNULL_END
