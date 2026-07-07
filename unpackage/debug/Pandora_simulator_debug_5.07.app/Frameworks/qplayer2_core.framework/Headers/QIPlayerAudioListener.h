//
//  QIPlayerAudioListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/11/21.
//

#ifndef QIPlayerAudioListener_h
#define QIPlayerAudioListener_h
@class QPlayerContext;
/**
 静音播放监听
 */
@protocol QIPlayerAudioListener <NSObject>

/**
 静音播放状态发生变化
 @param context 当前的播放器
 @param isMute 是否静音播放
*/
@optional
-(void)onMuteChanged:(QPlayerContext *)context isMute:(BOOL)isMute;
@end

#endif /* QIPlayerAudioListener_h */
