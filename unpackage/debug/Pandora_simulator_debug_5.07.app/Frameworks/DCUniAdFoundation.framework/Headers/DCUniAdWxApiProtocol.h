//
//  DCUniAdWxApiProtocol.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/5.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol DCUniAdWxApiProtocol <NSObject>
- (void)wxApiOnResp:(NSString *)msg;
@end

NS_ASSUME_NONNULL_END
