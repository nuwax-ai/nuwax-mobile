//
//  QIPlayerShootVideoListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/11/16.
//

#ifndef QIPlayerShootVideoListener_h
#define QIPlayerShootVideoListener_h

/**
 截图图片类型
 */
typedef NS_ENUM(NSInteger, QPlayerShootVideoType) {
    QPLAYER_SHOOT_VIDEO_NONE = 0,
    QPLAYER_SHOOT_VIDEO_JPEG            //jpeg格式
};
@class QPlayerContext;
/**
 截图监听
 */
@protocol QIPlayerShootVideoListener <NSObject>

/**
 截图成功回调
 @param context 当前的播放器
 @param imageData 图片的 NSData 数据
 @param width 图片的宽
 @param height 图片的高
 @param type 图片类型
*/
@optional
-(void)onShootSuccessful:(QPlayerContext *)context imageData:(NSData *)imageData width:(int)width height:(int)height type:(QPlayerShootVideoType)type;

/**
 截图失败回调
 @param context 当前的播放器
*/
@optional
-(void)onShootFailed:(QPlayerContext *)context;
@end

#endif /* QIPlayerShootVideoListener_h */
