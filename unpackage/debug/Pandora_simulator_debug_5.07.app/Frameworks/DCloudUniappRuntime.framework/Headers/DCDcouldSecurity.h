//
//  DCDcouldSecurity.h
//  libPDRCore
//
//  Created by TaoHebin on 2022/9/13.
//  Copyright © 2022 DCloud. All rights reserved.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCDcouldSecurity : NSObject

+ (BOOL)verifyClientKeyPayloadWithAppkey:(NSString *)appKey data:(NSDictionary *)dic;

+ (nullable NSDictionary *)preGetClientKeyPayload:(NSDictionary *)data appKey:(NSString *)appKey;

+ (nullable NSDictionary *)encrypt:(NSString *)data appKey:(NSString *)appKey clientKeyData:(NSString *)clientKeyData;

+ (nullable NSDictionary *)decrypt:(NSDictionary *)data appKey:(NSString *)appKey clientKeyData:(NSString *)clientKeyData;
@end

NS_ASSUME_NONNULL_END
