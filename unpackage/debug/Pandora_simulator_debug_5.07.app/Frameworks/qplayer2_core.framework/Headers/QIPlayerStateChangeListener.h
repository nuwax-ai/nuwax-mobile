//
//  QIPlayerStateListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerStateChangeListener_h
#define QIPlayerStateChangeListener_h
#import <qplayer2_core/QIOSCommon.h>
@class QPlayerContext;
/**
 播放器状态变更监听
 */
@protocol QIPlayerStateChangeListener <NSObject>
/**
 状态变更回调
 @param context 当前的播放器 
 @param state 播放器状态
 */
@optional
-(void)onStateChange:(QPlayerContext *)context state:(QPlayerState)state;
@end
#endif /* QIPlayerStateChangeListener_h */
