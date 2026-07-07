//
//  QIPlayerSpeedListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerSpeedListener_h
#define QIPlayerSpeedListener_h

@class QPlayerContext;
/**
 倍速监听
 */
@protocol QIPlayerSpeedListener <NSObject>

/**
 倍速改变回调
 @param context 当前的播放器 
 @param speed 改变后的倍速
*/
@optional
-(void)onSpeedChanged:(QPlayerContext *)context speed:(float)speed;
@end
#endif /* QIPlayerSpeedListener_h */
