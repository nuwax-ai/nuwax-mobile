//
//  DCUniAdCustomConfigAdapterBridge.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/18.
//

#import <Foundation/Foundation.h>

@protocol DCUniAdCustomConfigAdapter;

@protocol DCUniAdCustomConfigAdapterBridge <NSObject>

/// adn初始化成功
/// @param adapter 初始化配置类
- (void)initializeSuccess:(id<DCUniAdCustomConfigAdapter>)adapter;

/// adn初始化失败
/// @param adapter 初始化配置类
/// @param error 初始化错误信息
- (void)initializeFailed:(id<DCUniAdCustomConfigAdapter>)adapter error:(NSError *)error;
@end
