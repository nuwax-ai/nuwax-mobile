//
//  QRenderView.h
//  qplayer2-core
//
//  Created by 老干部 on 2022/8/8.
//
#import <qplayer2_core/QPlayerContext.h>
#import <UIKit/UIKit.h>
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
/**
 渲染的view
 */
@interface QRenderView : UIView
/**
 初始化
 @param frame view的大小
 */
-(instancetype)initWithFrame:(CGRect)frame;

/**
方法废弃
 */
+(instancetype)new NS_UNAVAILABLE;
/**
方法废弃
 */
-(instancetype)init NS_UNAVAILABLE;
/**
 与播放器的 QPlayerContext 绑定,绑定之后便无需处理播放器相关的逻辑
 @param handler 渲染句柄
 @return true 调用成功， false 调用失败
 */
- (BOOL)attachPlayerContext:(QPlayerContext *)handler;

@end

NS_ASSUME_NONNULL_END
