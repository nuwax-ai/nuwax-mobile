//
//  QMediaItemContext.h
//  QPlayerKit
//
//  Created by 王声禄 on 2022/8/3.
//

#import <Foundation/Foundation.h>
#import <qplayer2_core/QMediaItemControlHandler.h>
#import <qplayer2_core/QIOSCommon.h>
NS_ASSUME_NONNULL_BEGIN

@class QMediaModel;

@interface QMediaItemContext : NSObject{
    @package void *mMediaItem;
}
/***
 * 预加载Item控制器
 */
@property (nonatomic, strong) QMediaItemControlHandler * controlHandler;

/**
 废弃方法
 */
-(instancetype)init NS_UNAVAILABLE;
/**
 废弃方法
 */
-(instancetype)new NS_UNAVAILABLE;

/***
 * 预加载初始化上下文
 * @param mediaModel 预加载资源
 * @param startPos 起播位置 
 * @param storageDir 持久化相关的路径（注意权限） 目前只存日志
 * @param logLevel 日志等级
 */
-(instancetype)initItemComtextWithMediaModel:(QMediaModel *)mediaModel startPos:(int64_t)startPos storageDir:(NSString *)storageDir logLevel:(QLogLevel)logLevel;
@end

NS_ASSUME_NONNULL_END
