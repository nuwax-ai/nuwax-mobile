//
//  UniThreadSafeCounter.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/21.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniThreadSafeCounter : NSObject

@property (atomic, readonly) int32_t value;

- (int32_t)increase;

@end

NS_ASSUME_NONNULL_END
