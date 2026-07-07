//
//  DCUniComponent+BoxShadow.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/18.
//

#import <DCloudUniappRuntime/DCUniComponent.h>
#import <DCloudUniappRuntime/UniBoxShadow.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniComponent (BoxShadow)


/**
 *  @abstract compare boxshadow
 *
 *  @return if not equal return NO, if equal return YES
 */
- (BOOL)equalBoxShadow:(UniBoxShadow *_Nullable)boxShadow withBoxShadow:(UniBoxShadow *_Nullable)compareBoxShadow;

/**
 *  @abstract config view Layer with boxshadow, lastboxshadow and originalBoxShadow
 *
 *  @param boxShadow the boxshadow will be set
 *
 *
 */
- (void)configBoxShadow:(UniBoxShadow *_Nullable)boxShadow;

@end

NS_ASSUME_NONNULL_END
