//
//  DCUniAdRewardInfo.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/8/5.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniAdRewardInfo : NSObject
/// 是否达到激励条件
@property (nonatomic,assign) BOOL isCompelted;

/// 区分广告是 大陆/海外，china/global
@property (nonatomic,strong) NSString *provider;

@end

NS_ASSUME_NONNULL_END
