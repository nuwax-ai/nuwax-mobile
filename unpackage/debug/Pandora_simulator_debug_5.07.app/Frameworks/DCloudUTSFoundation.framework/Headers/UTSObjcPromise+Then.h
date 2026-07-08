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
#import <DCloudUTSFoundation/UTSObjcPromisePrivate.h>

NS_ASSUME_NONNULL_BEGIN

@interface UTSObjcPromise<Value>(ThenAdditions)

typedef id __nullable (^UTSObjcPromiseThenWorkBlock)(Value __nullable value) NS_SWIFT_UNAVAILABLE("");

/**
 Creates a pending promise which eventually gets resolved with resolution returned from `work`
 block: either value, error or another promise. The `work` block is executed asynchronously only
 when the receiver is fulfilled. If receiver is rejected, the returned promise is also rejected with
 the same error.

 @param work A block to handle the value that receiver was fulfilled with.
 @return A new pending promise to be resolved with resolution returned from the `work` block.
 */
- (UTSObjcPromise *)then:(UTSObjcPromiseThenWorkBlock)work
              onRejected:(UTSObjcPromiseChainedRejectBlock __nullable)rejected NS_SWIFT_UNAVAILABLE("");

/**
 Creates a pending promise which eventually gets resolved with resolution returned from `work`
 block: either value, error or another promise. The `work` block is executed asynchronously when the
 receiver is fulfilled. If receiver is rejected, the returned promise is also rejected with the same
 error.

 @param queue A queue to invoke the `work` block on.
 @param work A block to handle the value that receiver was fulfilled with.
 @return A new pending promise to be resolved with resolution returned from the `work` block.
 */
- (UTSObjcPromise *)onQueue:(dispatch_queue_t)queue
                   then:(UTSObjcPromiseThenWorkBlock)work 
                 onRejected:(UTSObjcPromiseChainedRejectBlock __nullable)rejected NS_REFINED_FOR_SWIFT;

@end

/**
 Convenience dot-syntax wrappers for `UTSObjcPromise` `then` operators.
 Usage: promise.then(^id(id value) { ... })
 */
@interface UTSObjcPromise<Value>(DotSyntax_ThenAdditions)

- (UTSObjcPromise* (^)(UTSObjcPromiseThenWorkBlock))then UTSOBJC_PROMISES_DOT_SYNTAX NS_SWIFT_UNAVAILABLE("");
- (UTSObjcPromise* (^)(dispatch_queue_t, UTSObjcPromiseThenWorkBlock))thenOn UTSOBJC_PROMISES_DOT_SYNTAX
    NS_SWIFT_UNAVAILABLE("");

@end

NS_ASSUME_NONNULL_END
