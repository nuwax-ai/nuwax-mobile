//
//  QMediaItemControlHandler.h
//  QPlayerKit
//
//  Created by 王声禄 on 2022/8/3.
//

#import <Foundation/Foundation.h>
#import <qplayer2_core/QMediaModel.h>
#import <qplayer2_core/QIOSCommon.h>
#import <qplayer2_core/QIMediaItemCommandNotAllowListener.h>
#import <qplayer2_core/QIMediaItemStateChangeListener.h>
NS_ASSUME_NONNULL_BEGIN
@class QMediaItemContext;
@class QMediaItem;
@interface QMediaItemControlHandler : NSObject
{
    @package void *log;
    
    @package void *mQMediaItem;
}

@property(nonatomic,readonly)QMediaModel *mediaModel;

/**
 * 当前预加载状态
 */
@property (nonatomic, assign, readonly) QMediaItemState  currentState;

-(instancetype)init NS_UNAVAILABLE;

/**
 * 开始预加载
 * @return true: start成功 false: start 失败
 */
-(BOOL)start;

/**
 * 暂停预加载
 * @return true: pause成功 false: pause失败
 */
-(BOOL)pause;

/**
 * 如果之前是暂停状态 ，那么调用resume 则恢复下载
 * @return true: resume成功 false: resume失败
 */
-(BOOL)resume;

/**
 * 停止预加载，结束当前预加载实例的生命周期 停止后调用其他接口就无效了，
 * @return true: stop成功 false: stop失败
 */
-(BOOL)stop;


/**
 * 添加调用播放器接口时状态异常的监听
 * @param listener 状态异常的监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addMediaItemCommandNotAllowListener:(id<QIMediaItemCommandNotAllowListener>)listener NS_SWIFT_NAME(addMediaItemCommandNotAllowListener(listener:));

/**
 * 移除调用播放器接口时状态异常的监听
 * @param listener 状态异常的监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeMediaItemCommandNotAllowListener:(id<QIMediaItemCommandNotAllowListener>)listener NS_SWIFT_NAME(removeMediaItemCommandNotAllowListener(listener:));

/**
 * 移除所有调用播放器接口时状态异常的监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllMediaItemCommandNotAllowListener;

/**
 * 添加预加载状态的监听
 * @param listener 状态监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addMediaItemStateChangeListener:(id<QIMediaItemStateChangeListener>)listener NS_SWIFT_NAME(addMediaItemStateChangeListener(listener:));

/**
 * 移除预加载状态的监听
 * @param listener 状态监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeMediaItemStateChangeListener:(id<QIMediaItemStateChangeListener>)listener NS_SWIFT_NAME(removeMediaItemStateChangeListener(listener:));

/**
 * 移除所有预加载状态的监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllMediaItemStateChangeListener;
@end

NS_ASSUME_NONNULL_END
