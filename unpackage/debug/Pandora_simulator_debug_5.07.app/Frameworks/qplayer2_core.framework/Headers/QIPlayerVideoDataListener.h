//
//  QIPlayerVideoDataListener.h
//  qplayer2-core
//
//  Created by Dynasty Dream on 2023/7/20.
//

#ifndef QIPlayerVideoDataListener_h
#define QIPlayerVideoDataListener_h

@class QPlayerContext;

typedef NS_ENUM(NSInteger,QVideoType) {
    QVIDEO_TYPE_YUV_420P = 1,
    QVIDEO_TYPE_NV12 = 2,
    QVIDEO_TYPE_RGBA = 3
};
@protocol QIPlayerVideoDataListener <NSObject>

/**
 视频数据回调
 @param context 当前的播放器
 @param sampleRate 采样率
 @param format
 @param channelNum 通道数
 @param channelLayout
 @param context 音频数据
*/
@optional
-(void)onVideoData:(QPlayerContext *)context width:(int)width height:(int)height videoType:(QVideoType)videoType buffer:(NSData *)buffer;
@end

#endif /* QIPlayerVideoDataListener_h */
