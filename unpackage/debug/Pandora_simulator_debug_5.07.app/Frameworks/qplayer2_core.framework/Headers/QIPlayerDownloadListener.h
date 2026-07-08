//
//  QIPlayerDownloadListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerDownloadListener_h
#define QIPlayerDownloadListener_h


@class QPlayerContext;
/**
 拉流监听
 */
@protocol QIPlayerDownloadListener <NSObject>

/**
 @brief 拉流速率改变
 @param context 当前的播放器
 @param downloadSpeed 速度 单位: b/s (比特每秒)
 @param bufferPos 缓冲的进度
 */
@optional
-(void)onDownloadChanged:(QPlayerContext *)context speed:(NSInteger)downloadSpeed bufferPos:(NSInteger)bufferPos;
@end
#endif /* QIPlayerDownloadListener_h */
