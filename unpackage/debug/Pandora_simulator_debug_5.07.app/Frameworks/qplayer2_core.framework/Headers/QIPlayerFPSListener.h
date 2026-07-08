//
//  QIPlayerFPSListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerFPSListener_h
#define QIPlayerFPSListener_h

@class QPlayerContext;
/**
 实时帧率监听
 */
@protocol QIPlayerFPSListener <NSObject>

/**
 @brief fps 改变的回调
 @param context 当前的播放器
 @param fps 帧率
 */
@optional
-(void)onFPSChanged:(QPlayerContext *)context FPS:(NSInteger)fps;
@end
#endif /* QIPlayerFPSListener_h */
