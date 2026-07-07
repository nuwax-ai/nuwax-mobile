//
//  QIPlayerBiteRateListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerBiteRateListener_h
#define QIPlayerBiteRateListener_h

@class QPlayerContext;
/**
 实时码率监听
 */
@protocol QIPlayerBiteRateListener <NSObject>

/**
 @brief 码率变换回调
 @param context 当前播放器 
 @param bitrate 比特率， 单位：bps
 */
@optional
-(void)onBiteRateChanged:(QPlayerContext *)context bitrate:(NSInteger)bitrate;
@end
#endif /* QIPlayerBiteRateListener_h */
