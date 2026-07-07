//
//  UniResourceRequest.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/5/5.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniResourceRequest : NSMutableURLRequest

@property (nonatomic, strong) id taskIdentifier;
@property (nonatomic, strong) NSString *referrer;
@property (nonatomic, strong) NSString *userAgent;

+ (instancetype)requestWithURL:(NSURL *)url
                      referrer:(NSString *)referrer
                   cachePolicy:(NSURLRequestCachePolicy)cachePolicy;

@end

NS_ASSUME_NONNULL_END
