//
//  QPlayerContext.h
//  QPlayerKit
//
//  Created by 王声禄 on 2022/8/2.
//
#import <Foundation/Foundation.h>
#import <qplayer2_core/QIOSCommon.h>
#import <qplayer2_core/QPlayerControlHandler.h>
#import <qplayer2_core/QPlayerRenderHandler.h>
#import <qplayer2_core/QRenderView.h>
NS_ASSUME_NONNULL_BEGIN
@class QMediaModel;
@class QStreamElement;
/**
 * 播放器上下文
 */
@interface QPlayerContext : NSObject

/**
方法废弃: new    init
 */
+(instancetype)new NS_UNAVAILABLE;

-(instancetype)init NS_UNAVAILABLE;

/**
 初始化
 @param APPVersion APP版本号
 @param localStorageDir 持久化相关的路径（注意权限） 目前只存日志
 @param logLevel 日志等级
 */
-(instancetype)initPlayerAPPVersion:(NSString *)APPVersion localStorageDir:(NSString *)localStorageDir logLevel:(QLogLevel)logLevel;

/**
 初始化
 @param APPVersion APP版本号
 @param localStorageDir 持久化相关的路径（注意权限） 目前只存日志
 @param logLevel 日志等级
 @param authorid authorid
 */

-(instancetype)initPlayerAPPVersion:(NSString *)APPVersion localStorageDir:(NSString *)localStorageDir logLevel:(QLogLevel)logLevel authorid:(NSString *)authorid;

/**
 * 获取播放控制Handler
 */
@property (nonatomic, strong) QPlayerControlHandler *controlHandler;


/**
 * 获取渲染控制Handler
 */
@property (nonatomic, strong) QPlayerRenderHandler *renderHandler;



@end

NS_ASSUME_NONNULL_END

