/**
 Copyright 2018 Google Inc. All rights reserved.

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at:

 http://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

#import <DCloudUTSFoundation/UTSObjcPromise.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXTERN NSString const *UTSObjcPromiseISFullfiled NS_REFINED_FOR_SWIFT;
FOUNDATION_EXTERN NSString const *UTSObjcPromiseValue NS_REFINED_FOR_SWIFT;

@interface UTSObjcPromise<Value>(AllAdditions)

/**
 Wait until all of the given promises are fulfilled.
 If one of the given promises is rejected, then the returned promise is rejected with same error.
 If any other arbitrary value or `NSError` appears in the array instead of `UTSObjcPromise`,
 it's implicitly considered a pre-fulfilled or pre-rejected `UTSObjcPromise` correspondingly.
 Promises resolved with `nil` become `NSNull` instances in the resulting array.

 @param promises Promises to wait for.
 @return Promise of an array containing the values of input promises in the same order.
 */
+ (UTSObjcPromise<NSArray *> *)all:(NSArray *)promises NS_SWIFT_UNAVAILABLE("");

/**
 Wait until all of the given promises are fulfilled.
 If one of the given promises is rejected, then the returned promise is rejected with same error.
 If any other arbitrary value or `NSError` appears in the array instead of `UTSObjcPromise`,
 it's implicitly considered a pre-fulfilled or pre-rejected UTSObjcPromise correspondingly.
 Promises resolved with `nil` become `NSNull` instances in the resulting array.

 @param queue A queue to dispatch on.
 @param promises Promises to wait for.
 @return Promise of an array containing the values of input promises in the same order.
 */
+ (UTSObjcPromise<NSArray *> *)onQueue:(dispatch_queue_t)queue
                               all:(NSArray *)promises NS_REFINED_FOR_SWIFT;

+ (UTSObjcPromise<NSArray *> *)allSettled:(NSArray *)promises NS_SWIFT_UNAVAILABLE("");

+ (UTSObjcPromise<NSArray *> *)onQueue:(dispatch_queue_t)queue
                            allSettled:(NSArray *)settledPromises NS_REFINED_FOR_SWIFT;

@end

/**
 Convenience dot-syntax wrappers for `UTSObjcPromise` `all` operators.
 Usage: UTSObjcPromise.all(@[ ... ])
 */
@interface UTSObjcPromise<Value>(DotSyntax_AllAdditions)

+ (UTSObjcPromise<NSArray *> * (^)(NSArray *))all UTSOBJC_PROMISES_DOT_SYNTAX NS_SWIFT_UNAVAILABLE("");
+ (UTSObjcPromise<NSArray *> * (^)(dispatch_queue_t, NSArray *))allOn UTSOBJC_PROMISES_DOT_SYNTAX
    NS_SWIFT_UNAVAILABLE("");
+ (UTSObjcPromise<NSArray *> * (^)(NSArray *))allSettled UTSOBJC_PROMISES_DOT_SYNTAX NS_SWIFT_UNAVAILABLE("");
+ (UTSObjcPromise<NSArray *> * (^)(dispatch_queue_t, NSArray *))allSettledOn UTSOBJC_PROMISES_DOT_SYNTAX
    NS_SWIFT_UNAVAILABLE("");

@end

@interface UTSObjcPromiseAllResult: NSObject

@property (nonatomic, assign) BOOL isFullfiled;
@property (nonatomic, strong, nullable) id value;

@end

NS_ASSUME_NONNULL_END
