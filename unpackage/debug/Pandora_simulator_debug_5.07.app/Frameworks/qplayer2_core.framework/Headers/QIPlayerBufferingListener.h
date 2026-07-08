//
//  QIPlayerBufferingListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerBufferingListener_h
#define QIPlayerBufferingListener_h

@class QPlayerContext;
/**
 buffering 监听
 */
@protocol QIPlayerBufferingListener <NSObject>

/**
 @brief 开始buffering
 @param context 当前播放器  
 */
@optional
-(void)onBufferingStart:(QPlayerContext *)context;

/**
 @brief 结束buffering
 @param context 当前播放器
 */
@optional
-(void)onBufferingEnd:(QPlayerContext *)context;
@end
#endif /* QIPlayerBufferingListener_h */
