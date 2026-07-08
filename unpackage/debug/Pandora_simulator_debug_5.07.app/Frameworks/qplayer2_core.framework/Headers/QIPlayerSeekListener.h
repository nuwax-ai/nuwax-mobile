//
//  QIPlayerSeekListener.h
//  qplayer2-core
//
//  Created by Dynasty Dream on 2022/12/7.
//

#ifndef QIPlayerSeekListener_h
#define QIPlayerSeekListener_h

@class QPlayerContext;
/**
 seek监听
 */
@protocol QIPlayerSeekListener <NSObject>

/**
 seek成功回调
 @param context 当前的播放器
*/
@optional
-(void)onSeekSuccess:(QPlayerContext *)context;

/**
 seek失败回调
 @param context 当前的播放器
*/
@optional
-(void)onSeekFailed:(QPlayerContext *)context;
@end
#endif /* QIPlayerSeekListener_h */
