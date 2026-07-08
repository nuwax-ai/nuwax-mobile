//
//  DCUniAdDislikeWords.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/31.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniAdDislikeWords : NSObject
@property (nonatomic, copy, readonly) NSString *name;
- (instancetype)initWithName:(NSString *)name;
@end

NS_ASSUME_NONNULL_END
