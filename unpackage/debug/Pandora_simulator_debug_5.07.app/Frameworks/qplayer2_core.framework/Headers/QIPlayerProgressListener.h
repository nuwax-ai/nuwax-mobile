//
//  QIPlayerProgressListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerProgressListener_h
#define QIPlayerProgressListener_h

@class QPlayerContext;
/**
 播放器进度监听
 */
@protocol QIPlayerProgressListener <NSObject>

/***
 进度变更回调
 @param context 当前的播放器
 @param progress 当前进度 单位毫秒
 @param duration 当前视频总时长 单位毫秒
*/
@optional
-(void)onProgressChanged:(QPlayerContext *)context  progress:(NSInteger)progress duration:(NSInteger)duration;


@end
#endif /* QIPlayerProgressListener_h */
