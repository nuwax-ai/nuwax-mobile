//
//  TypedArrayWrapper.h
//  DCloudUTSFoundation
//
//  Created by Fred on 2025/5/19.
//

#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>

@protocol TypedArrayWrapper <JSExport>

@property (nonatomic, strong) JSValue * _Nonnull buffer;

- (instancetype _Nonnull)initWithBuffer:(JSValue * _Nonnull)buffer;
@end

NS_ASSUME_NONNULL_BEGIN

@interface TypedArrayWrapper : NSObject <TypedArrayWrapper>

@property (nonatomic, strong) JSValue *buffer;

- (instancetype)initWithBuffer:(JSValue *)buffer;

@end

NS_ASSUME_NONNULL_END
