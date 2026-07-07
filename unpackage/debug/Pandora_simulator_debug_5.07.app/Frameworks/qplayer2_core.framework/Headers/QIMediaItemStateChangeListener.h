//
//  QIMediaItemStateChangeListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/12.
//

#ifndef QIMediaItemStateChangeListener_h
#define QIMediaItemStateChangeListener_h

#import <qplayer2_core/QIOSCommon.h>
@class QMediaItemContext;


/**
 * 预加载实例的状态变更监听
 */
@protocol QIMediaItemStateChangeListener <NSObject>


/**
 * 状态变更监听
 * @param context 当前预加载上下文
 * @param state 改变后的状态
 */
@optional
-(void)onStateChanged:(QMediaItemContext *)context state:(QMediaItemState)state;
@end
#endif /* QIMediaItemStateChangeListener_h */
