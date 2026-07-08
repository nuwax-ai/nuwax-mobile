//
//  NSTimer+UniExt.h
//  DCloudUniappRuntime
//
//  Created by DCloud-iOS-XHY on 2023/10/23.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface NSTimer (UniExt)

+ (NSTimer *)uni_scheduledTimerWithTimeInterval:(NSTimeInterval)interval
                                         block:(void(^)(void))block
                                       repeats:(BOOL)repeats;

@end

NS_ASSUME_NONNULL_END
