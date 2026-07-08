//
//  NSString+UniExtend.h
//  UniCore
//
//  Created by lizhongyi on 2023/5/4.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface NSString (UniExtend)

- (NSString*)urlEncode;

- (NSString *)URLDecodeStringEx;

- (NSString *)URLEncodedStringEx;

- (BOOL)stringContainsSpecial;

- (BOOL)stringContainsEmoji;

- (BOOL)stringContainsChinese;

- (NSString *)uni_URLEncode;

- (NSString *)convertToMD5;

- (NSString *)convertToMD5Lowercase;

+ (BOOL)uni_isValidString:(NSString*)str;

- (BOOL)isWebUrlString;


@end

NS_ASSUME_NONNULL_END
