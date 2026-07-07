//
//  DCUniAdWmSDKProtocol.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/5.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@protocol DCUniAdWxApiProtocol;

@protocol DCUniAdWmSDKProtocol <NSObject>
- (BOOL)registerApp:(NSString *)appid universalLink:(NSString *)universalLink andDelegate:(id<DCUniAdWxApiProtocol>)delegate;
- (BOOL)handleOpenUrl:(NSURL *)url;
- (BOOL)handleOpenUniversalLink:(NSUserActivity *)userActivity;
- (BOOL)isWXAppInstalled;
- (void)launchMiniProgram:(NSString *)userName withPath:(NSString *)path withType:(NSString *)type withCompletion:(void(^)(BOOL isSuccess))completion;
@end

NS_ASSUME_NONNULL_END
