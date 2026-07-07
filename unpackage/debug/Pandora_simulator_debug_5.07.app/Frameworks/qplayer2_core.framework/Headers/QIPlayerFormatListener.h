//
//  QIPlayerFormatListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/12.
//

#ifndef QIPlayerFormatListener_h
#define QIPlayerFormatListener_h

@class QPlayerContext;
/**
 像素格式或者音频sample格式不支持的监听
 */
@protocol QIPlayerFormatListener <NSObject>

/**
 @brief 当前有format 不支持，所以视频没法播放
 @param context 当前的播放器
 */
@optional
-(void)onFormatNotSupport:(QPlayerContext*)context;
@end


#endif /* QIPlayerFormatListener_h */
