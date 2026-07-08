//
//  UniRuntimeService.h
//  DCloudUniappRuntime
//
//  Created by DCloud-iOS-XHY on 2023/11/23.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniRuntimeService : NSObject

+ (void)enableDebuggingMonitoring:(NSString *)appid;

+ (void)commitHBLog:(NSString *)log;

+ (void)registerHookProxy:(id)instance;
+ (void)loadCanvasModule;

@end

NS_ASSUME_NONNULL_END
