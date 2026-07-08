//
//  UniDisplayQueue.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/21.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniDisplayQueue : NSObject

+ (void)addBlock:(void(^)(void))block;

@end

NS_ASSUME_NONNULL_END
