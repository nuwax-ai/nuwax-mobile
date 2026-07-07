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

@interface UTSObjcPromise<Value>(AlwaysAdditions)

typedef id __nullable (^UTSObjcPromiseAlwaysWorkBlock)(void) NS_SWIFT_UNAVAILABLE("");

/**
 @param work A block that always executes, no matter if the receiver is rejected or fulfilled.
 @return A new pending promise to be resolved with same resolution as the receiver.
 */
- (UTSObjcPromise *)always:(UTSObjcPromiseAlwaysWorkBlock)work NS_SWIFT_UNAVAILABLE("");

/**
 @param queue A queue to dispatch on.
 @param work A block that always executes, no matter if the receiver is rejected or fulfilled.
 @return A new pending promise to be resolved with same resolution as the receiver.
 */
- (UTSObjcPromise *)onQueue:(dispatch_queue_t)queue
                 always:(UTSObjcPromiseAlwaysWorkBlock)work NS_REFINED_FOR_SWIFT;

@end

/**
 Convenience dot-syntax wrappers for `UTSObjcPromise` `always` operators.
 Usage: promise.always(^{...})
 */
@interface UTSObjcPromise<Value>(DotSyntax_AlwaysAdditions)

- (UTSObjcPromise* (^)(UTSObjcPromiseAlwaysWorkBlock))always UTSOBJC_PROMISES_DOT_SYNTAX
    NS_SWIFT_UNAVAILABLE("");
- (UTSObjcPromise* (^)(dispatch_queue_t, UTSObjcPromiseAlwaysWorkBlock))alwaysOn UTSOBJC_PROMISES_DOT_SYNTAX
    NS_SWIFT_UNAVAILABLE("");

@end

NS_ASSUME_NONNULL_END
