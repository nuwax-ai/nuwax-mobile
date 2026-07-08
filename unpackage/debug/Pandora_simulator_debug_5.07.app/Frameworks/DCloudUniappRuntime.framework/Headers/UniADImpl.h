//
//  UniADImpl.h
//  DCloudUniappRuntime
//
//  Created by wangzhitong on 2024/5/15.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniADImpl : NSObject
+ (void)create:(NSDictionary *)params;
+ (BOOL)isEnded;
@end

NS_ASSUME_NONNULL_END
