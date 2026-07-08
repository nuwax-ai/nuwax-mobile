//
//  QPlayerRenderHandler.h
//  QPlayerKit
//
//  Created by 王声禄 on 2022/8/2.
//

#import <Foundation/Foundation.h>

#import <qplayer2_core/QIOSCommon.h>
#import <UIKit/UIKit.h>
#import <qplayer2_core/QIPlayerRenderListener.h>
NS_ASSUME_NONNULL_BEGIN
@class QPlayer;
@class QMediaModel;
@class QStreamElement;
@class QPlayerContext;

/**
 * 播放器渲染控制器
 */
@interface QPlayerRenderHandler : NSObject{
    
    @package  void *mPlayer;
}


/***
 * 设置色觉优化
 * @param type 色觉优化类型
 * @return true 设置成功 false 设置失败
 */
-(BOOL)setBlindType:(QPlayerBlind)type NS_SWIFT_NAME(setBlindType(type:));

/***
 * 设置VR视频的旋转角度
 * @param rotateX 横向角度 （360度制）
 * @param rotateY 纵向角度 （360度制）
 * @return true 设置成功 false 设置失败
 */
-(BOOL)setPanoramaViewRotate:(float)rotateX rotateY:(float)rotateY NS_SWIFT_NAME(setPanoramaViewRotate(rotateX:rotateY:));

/***
 * 设置VR视频的缩放
 * @param scale 缩放比例（scale区间范围: 0<scale<2)
 * @return true 设置成功 false 设置失败
 */
-(BOOL)setPanoramaViewScale:(float)scale
    NS_SWIFT_NAME(setPanoramaViewScale(scale:));


/***
 * 设置视频渲染比例
 * @param ratio 比例类型
 * @return true 设置成功 false 设置失败
 */
-(BOOL)setRenderRatio:(QPlayerRenderRatio)ratio NS_SWIFT_NAME(setRenderRatio(ratio:));

/***
 * 设置视频镜像
 * @param mirrorType 镜像类型
 * @return true 设置成功 false 设置失败
 */
-(BOOL)setMirrorType:(QPlayerMirror)mirrorType NS_SWIFT_NAME(setMirrorType(mirrorType:));

/***
 * 设置视频旋转角度
 * @param rotation 旋转角度
 * @return true 设置成功 false 设置失败
 */
-(BOOL)setRotation:(int)rotation;

/***
 * 设置视频缩放
 * @param scale 视频缩放
 * @return true 设置成功 false 设置失败
 */
-(BOOL)setScale:(float)scale;
/**
方法废弃
 */
+(instancetype)new NS_UNAVAILABLE;
/**
方法废弃
 */
-(instancetype)init NS_UNAVAILABLE;

/**
 设置RenderViewLayer
 @param layer RenderViewLayer
 @return true 设置成功 false 设置失败
 */
-(BOOL)setRenderViewLayer:(CAEAGLLayer *)layer NS_SWIFT_NAME(setRenderViewLayer(layer:));
/**
 设置RenderView的渲染size
 @param size 渲染大小
 @return true 设置成功 false 设置失败
 */
-(BOOL)setRenderViewFrame:(CGSize)size NS_SWIFT_NAME(setRenderViewFrame(size:));


/**
 * 添加渲染信息监听
 * @param listener 渲染信息回调
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerRenderListener:(id<QIPlayerRenderListener>)listener NS_SWIFT_NAME(addPlayerRenderListener(listener:));
/**
 * 删除渲染信息监听
 * @param listener 渲染信息回调
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerRenderListener:(id<QIPlayerRenderListener>)listener NS_SWIFT_NAME(removePlayerRenderListener(listener:));
/**
 * 删除所有渲染信息监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerRenderListener;
@end

NS_ASSUME_NONNULL_END
