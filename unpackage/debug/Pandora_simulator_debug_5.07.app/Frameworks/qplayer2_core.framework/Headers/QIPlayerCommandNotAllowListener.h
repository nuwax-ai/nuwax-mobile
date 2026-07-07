//
//  QIPlayerCommandNotAllowListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerCommandNotAllowListener_h
#define QIPlayerCommandNotAllowListener_h

#import <qplayer2_core/QIOSCommon.h>
@class QPlayerContext;
/**
 调用播放器接口时状态异常的监听
 */
@protocol QIPlayerCommandNotAllowListener <NSObject>

/**
 @brief 操作不被允许回调
 @param context 操作异常的播放器
 @param commandName 操作名称
 @param state 操作被检测时播放器的状态
 */
@optional
-(void)onCommandNotAllow:(QPlayerContext *)context commandName:(NSString *)commandName state:(QPlayerState) state;
@end

#endif /* QIPlayerCommandNotAllowListener_h */
