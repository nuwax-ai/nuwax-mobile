//
//  QIPlayerRenderListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/12.
//

#ifndef QIPlayerRenderListener_h
#define QIPlayerRenderListener_h

@class QPlayerContext;
/**
 渲染相关监听
 */
@protocol QIPlayerRenderListener <NSObject>

/**
 首帧耗时回调
 @param context 当前的播放器
 @param elapsedTime 从play 开始到首帧渲染出来的总耗时 单位毫秒
*/
@optional
-(void)onFirstFrameRendered:(QPlayerContext *)context elapsedTime:(NSInteger)elapsedTime;
@end
#endif /* QIPlayerRenderListener_h */
