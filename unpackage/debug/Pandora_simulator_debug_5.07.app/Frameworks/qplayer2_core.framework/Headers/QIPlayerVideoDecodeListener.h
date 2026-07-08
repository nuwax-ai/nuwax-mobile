//
//  QIPlayerVideoDecodeListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerVideoDecodeListener_h
#define QIPlayerVideoDecodeListener_h

@class QPlayerContext;
/**
 播放器视频解码监听
 */
@protocol QIPlayerVideoDecodeListener <NSObject>

/**
 当前视频用的是哪种解码方式
 @param context 当前的播放器
 @param type 解码方式
*/
@optional
-(void)onVideoDecodeByType:(QPlayerContext *)context Type:(QPlayerDecoderType)type;

/**
 * 通知当前视频解码失败，
 * @param retry 底层是重试
 */
@optional
-(void)onDecodeFailed:(QPlayerContext *)context retry:(BOOL)retry;

/**
 如果当前视频编码 所在设备或者sdk不支持 则回调该方法
 @param context 当前的播放器
 @param codecId 视频的编码id
*/
@optional
-(void)notSupportCodecFormat:(QPlayerContext *)context codec:(NSInteger)codecId;
@end
#endif /* QIPlayerVideoDecodeListener_h */
