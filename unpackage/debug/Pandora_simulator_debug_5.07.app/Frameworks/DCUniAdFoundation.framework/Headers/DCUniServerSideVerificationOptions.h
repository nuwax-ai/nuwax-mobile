//
//  DCUniServerSideVerificationOptions.h
//  DCUniAdFoundation
//
//  Created by dcloud on 2022/3/9.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniServerSideVerificationOptions : NSObject
/// 用户的 userid，可选
@property (nonatomic, copy, nullable) NSString *userIdentifier;
/// 服务器端验证回调中包含的自定义奖励字符串，可选
@property (nonatomic, copy, nullable) NSString *extra;
@end

NS_ASSUME_NONNULL_END
