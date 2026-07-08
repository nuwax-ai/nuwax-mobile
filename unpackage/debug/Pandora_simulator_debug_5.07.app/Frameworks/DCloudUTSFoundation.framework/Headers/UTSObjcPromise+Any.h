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

@interface UTSObjcPromise<Value>(AnyAdditions)

/**
 Waits until all of the given promises are either fulfilled or rejected.
 If all promises are rejected, then the returned promise is rejected with same error
 as the last one rejected.
 If at least one of the promises is fulfilled, the resulting promise is fulfilled with an array of
 values or `NSErrors`, matching the original order of fulfilled or rejected promises respectively.
 If any other arbitrary value or `NSError` appears in the array instead of `UTSObjcPromise`,
 it's implicitly considered a pre-fulfilled or pre-rejected `UTSObjcPromise` correspondingly.
 Promises resolved with `nil` become `NSNull` instances in the resulting array.

 @param promises Promises to wait for.
 @return Promise of array containing the values or `NSError`s of input promises in the same order.
 */
+ (UTSObjcPromise *)any:(NSArray *)promises NS_SWIFT_UNAVAILABLE("");

/**
 Waits until all of the given promises are either fulfilled or rejected.
 If all promises are rejected, then the returned promise is rejected with same error
 as the last one rejected.
 If at least one of the promises is fulfilled, the resulting promise is fulfilled with an array of
 values or `NSError`s, matching the original order of fulfilled or rejected promises respectively.
 If any other arbitrary value or `NSError` appears in the array instead of `UTSObjcPromise`,
 it's implicitly considered a pre-fulfilled or pre-rejected `UTSObjcPromise` correspondingly.
 Promises resolved with `nil` become `NSNull` instances in the resulting array.

 @param queue A queue to dispatch on.
 @param promises Promises to wait for.
 @return Promise of array containing the values or `NSError`s of input promises in the same order.
 */
+ (UTSObjcPromise *)onQueue:(dispatch_queue_t)queue
                               any:(NSArray *)promises NS_REFINED_FOR_SWIFT;

@end

/**
 Convenience dot-syntax wrappers for `UTSObjcPromise` `any` operators.
 Usage: UTSObjcPromise.any(@[ ... ])
 */
@interface UTSObjcPromise<Value>(DotSyntax_AnyAdditions)

+ (UTSObjcPromise * (^)(NSArray *))any UTSOBJC_PROMISES_DOT_SYNTAX NS_SWIFT_UNAVAILABLE("");
+ (UTSObjcPromise * (^)(dispatch_queue_t, NSArray *))anyOn UTSOBJC_PROMISES_DOT_SYNTAX
    NS_SWIFT_UNAVAILABLE("");

@end

NS_ASSUME_NONNULL_END
