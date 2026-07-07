//
//  DCUniComponent+ViewManagement.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/15.
//

#import <DCloudUniappRuntime/DCUniComponent.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniComponent (ViewManagement)

- (void)_unloadViewWithReusing:(BOOL)isReusing;

@end

NS_ASSUME_NONNULL_END
