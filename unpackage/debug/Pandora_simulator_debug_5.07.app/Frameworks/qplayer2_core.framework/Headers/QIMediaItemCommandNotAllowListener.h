//
//  QIMediaItemCommandNotAllowListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/12.
//

#ifndef QIMediaItemCommandNotAllowListener_h
#define QIMediaItemCommandNotAllowListener_h

@class QMediaItemContext;

/**
 * 调用播放器接口时状态异常的监听
 */
@protocol QIMediaItemCommandNotAllowListener <NSObject>

/**
 * 播放器操作（eg.playMediaModel/seek 等操作）由于状态问题导致的失败
 * @param context 当前预加载上下文
 * @param commandName 操作名称
 * @param state 异常发生时的的状态
 */
@optional
-(void)onCommandNotAllow:(QMediaItemContext *)context commandName:(NSString *)commandName state:(QMediaItemState)state;
@end
#endif /* QIMediaItemCommandNotAllowListener_h */
