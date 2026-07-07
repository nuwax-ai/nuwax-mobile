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

@interface UTSObjcPromise<Value>(AsyncAdditions)

typedef void (^UTSObjcPromiseFulfillBlock)(Value __nullable value) NS_SWIFT_UNAVAILABLE("");
typedef void (^UTSObjcPromiseRejectBlock)(id __nullable error) NS_SWIFT_UNAVAILABLE("");
typedef void (^UTSObjcPromiseAsyncWorkBlock)(UTSObjcPromiseFulfillBlock fulfill,
                                         UTSObjcPromiseRejectBlock reject) NS_SWIFT_UNAVAILABLE("");

/**
 Creates a pending promise and executes `work` block asynchronously.

 @param work A block to perform any operations needed to resolve the promise.
 @return A new pending promise.
 */
+ (instancetype)async:(UTSObjcPromiseAsyncWorkBlock)work NS_SWIFT_UNAVAILABLE("");

/**
 Creates a pending promise and executes `work` block asynchronously on the given queue.

 @param queue A queue to invoke the `work` block on.
 @param work A block to perform any operations needed to resolve the promise.
 @return A new pending promise.
 */
+ (instancetype)onQueue:(dispatch_queue_t)queue
                  async:(UTSObjcPromiseAsyncWorkBlock)work NS_REFINED_FOR_SWIFT;

@end

/**
 Convenience dot-syntax wrappers for `UTSObjcPromise` `async` operators.
 Usage: UTSObjcPromise.async(^(UTSObjcPromiseFulfillBlock fulfill, UTSObjcPromiseRejectBlock reject) { ... })
 */
@interface UTSObjcPromise<Value>(DotSyntax_AsyncAdditions)

+ (UTSObjcPromise* (^)(UTSObjcPromiseAsyncWorkBlock))async UTSOBJC_PROMISES_DOT_SYNTAX NS_SWIFT_UNAVAILABLE("");
+ (UTSObjcPromise* (^)(dispatch_queue_t, UTSObjcPromiseAsyncWorkBlock))asyncOn UTSOBJC_PROMISES_DOT_SYNTAX
    NS_SWIFT_UNAVAILABLE("");

@end

NS_ASSUME_NONNULL_END
