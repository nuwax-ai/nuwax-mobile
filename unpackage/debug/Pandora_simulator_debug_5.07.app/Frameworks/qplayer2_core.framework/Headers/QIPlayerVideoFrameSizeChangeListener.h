//
//  QIPlayerVideoFrameSizeChangeListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/11/21.
//

#ifndef QIPlayerVideoFrameSizeChangeListener_h
#define QIPlayerVideoFrameSizeChangeListener_h

@class QPlayerContext;
/**
 推流端视频长宽变化监听
 */
@protocol QIPlayerVideoFrameSizeChangeListener <NSObject>

/**
 推流端视频长宽变化回调
 @param context 当前的播放器
 @param width 视频宽度
 @param height 视频高度
*/
@optional
-(void)onVideoFrameSizeChanged:(QPlayerContext *)context width:(int)width height:(int)height;

@end
#endif /* QIPlayerVideoFrameSizeChangeListener_h */
