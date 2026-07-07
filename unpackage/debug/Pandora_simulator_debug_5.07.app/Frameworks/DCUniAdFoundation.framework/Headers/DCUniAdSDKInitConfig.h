//
//  UniAdSDKInitConfig.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/17.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniAdSDKInitConfig : NSObject

/// appID
@property (nonatomic, copy, readonly) NSString *appID;

/// appKey
@property (nonatomic, copy, readonly) NSString *appKey;

/// 扩展参数
@property (nonatomic, copy) NSDictionary *extra;
@end

NS_ASSUME_NONNULL_END
