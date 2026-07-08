//
//  QIPlayerAudioDataListener.h
//  qplayer2-core
//
//  Created by Dynasty Dream on 2023/7/17.
//

#ifndef QIPlayerAudioDataListener_h
#define QIPlayerAudioDataListener_h

@class QPlayerContext;
typedef NS_ENUM(NSInteger, QSampleFormat){
    QSAMPLE_FORMAT_NONE = 0,
    QSAMPLE_FORMAT_SIGN_INT_16 = 1
    
};
typedef NS_ENUM(NSInteger, QChannelLayout) {
    QCHANNEL_LAYOUT_NONE = 0,
    QCHANNEL_LAYOUT_STEREO = 1
};

@protocol QIPlayerAudioDataListener <NSObject>

/**
 音频数据回调
 @param context 当前的播放器
 @param sampleRate 采样率
 @param format
 @param channelNum 通道数
 @param channelLayout
 @param context 音频数据
*/
@optional
-(void)onAudioData:(QPlayerContext *)context sampleRate:(int)sampleRate format:(QSampleFormat)format channelNum:(int)channelNum channelLayout:(QChannelLayout)channelLayout data:(NSData *)data;

@end
#endif /* QIPlayerAudioDataListener_h */
