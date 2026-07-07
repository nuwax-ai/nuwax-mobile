//
//  DCUniAdCustomContentAdapterBridge.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/7.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@protocol DCUniAdCustomContentAdapter;

@protocol DCUniAdCustomContentAdapterBridge <NSObject>

@optional

- (void)contentAdFullDisplay:(id<DCUniAdCustomContentAdapter>)adapter info:(NSDictionary *)contentInfo;

- (void)contentAdStartPlay:(id<DCUniAdCustomContentAdapter>)adapter info:(NSDictionary *)contentInfo;

- (void)contentAdPause:(id<DCUniAdCustomContentAdapter>)adapter info:(NSDictionary *)contentInfo;

- (void)contentAdResume:(id<DCUniAdCustomContentAdapter>)adapter info:(NSDictionary *)contentInfo;

- (void)contentAdEndPlay:(id<DCUniAdCustomContentAdapter>)adapter info:(NSDictionary *)contentInfo;

@end

NS_ASSUME_NONNULL_END
