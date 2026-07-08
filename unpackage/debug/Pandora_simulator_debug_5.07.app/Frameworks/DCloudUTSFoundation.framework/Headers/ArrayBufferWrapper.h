//
//  ArrayBufferWrapper.h
//  DCloudUTSFoundation
//
//  Created by zhongyili on 2024/11/26.
//

#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

@protocol ArrayBufferWrapper <JSExport>

@property (nonatomic, strong) JSValue * _Nonnull buffer;

- (instancetype _Nonnull)initWithBuffer:(JSValue * _Nonnull)buffer;
@end

NS_ASSUME_NONNULL_BEGIN

@interface ArrayBufferWrapper : NSObject <ArrayBufferWrapper>

@property (nonatomic, strong) JSValue *buffer;

- (instancetype)initWithBuffer:(JSValue *)buffer;

@end

NS_ASSUME_NONNULL_END
