//
//  QIPlayerQualityListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerQualityListener_h
#define QIPlayerQualityListener_h

@class QPlayerContext;
/**
 播放器清晰度相关监听
 */
@protocol QIPlayerQualityListener <NSObject>
/**
 开始清晰度切换
 @param context 当前的播放器
 @param usertype 开始切换清晰度的url流的userType
 @param urlType 开始切换清晰度的url流的
 @param oldQuality 切换前的清晰度
 @param newQuality 要切到哪路清晰度
*/
@optional
-(void)onQualitySwitchStart:(QPlayerContext *)context usertype:(NSString *)usertype urlType:(QPlayerURLType)urlType oldQuality:(NSInteger)oldQuality newQuality:(NSInteger)newQuality;

/**
 清晰度切换完成
 @param context 当前的播放器
 @param usertype 开始切换清晰度的url流的userType
 @param urlType 开始切换清晰度的url流的
 @param oldQuality 切换前的清晰度
 @param newQuality 要切到哪路清晰度
*/
@optional
-(void)onQualitySwitchComplete:(QPlayerContext *)context usertype:(NSString *)usertype urlType:(QPlayerURLType)urlType oldQuality:(NSInteger)oldQuality newQuality:(NSInteger)newQuality;

/**
 清晰度切换取消
 @param context 当前的播放器
 @param usertype 开始切换清晰度的url流的userType
 @param urlType 开始切换清晰度的url流的
 @param oldQuality 切换前的清晰度
 @param newQuality 要切到哪路清晰度
*/
@optional
-(void)onQualitySwitchCanceled:(QPlayerContext *)context usertype:(NSString *)usertype urlType:(QPlayerURLType)urlType oldQuality:(NSInteger)oldQuality newQuality:(NSInteger)newQuality;

/**
 清晰度切换失败
 @param context 当前的播放器
 @param usertype 开始切换清晰度的url流的userType
 @param urlType 开始切换清晰度的url流的
 @param oldQuality 切换前的清晰度
 @param newQuality 要切到哪路清晰度
*/
@optional
-(void)onQualitySwitchFailed:(QPlayerContext *)context usertype:(NSString *)usertype urlType:(QPlayerURLType)urlType oldQuality:(NSInteger)oldQuality newQuality:(NSInteger)newQuality;

/**
 目前仅支持同时有一个清晰度切换，如果前一个还未切换完，再次发起切换 会回调这个函数
 @param context 当前的播放器
 @param usertype 开始切换清晰度的url流的userType
 @param urlType 开始切换清晰度的url流的
*/
@optional
-(void)onQualitySwitchRetryLater:(QPlayerContext *)context  usertype:(NSString *)usertype urlType:(QPlayerURLType)urlType;
@end
#endif /* QIPlayerQualityListener_h */
