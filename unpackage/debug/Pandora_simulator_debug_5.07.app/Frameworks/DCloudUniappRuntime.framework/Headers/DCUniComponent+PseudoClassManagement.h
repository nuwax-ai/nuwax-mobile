//
//  DCUniComponent+PseudoClassManagement.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/14.
//

#import <DCloudUniappRuntime/DCUniComponent.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniComponent (PseudoClassManagement)

/**
 *  @abstract filter common styles and pseudoClassStyles.
 *
 */
-(NSMutableDictionary *)parseStyles:(NSDictionary *)styles;

/**
 *  @abstract reset pseudoClassStyles.
 *
 */
- (void)resetPseudoClassStyles:(NSArray *)resetstyle;

- (void)clearPseudoClassStyles;

/**
 *  @abstract filter common styles and pseudoClassStyles.
 *
 */
-(NSString *)getPseudoKey:(NSString *)key;

/**
 *  @abstract get pseudo class styles through key.
 *
 *  @param key      the key to search pseudo class
 *
 *  @return pseudo class.
 */
-(NSMutableDictionary *)getPseudoClassStyles:(NSString *)key;

/**
 *  @abstract get pseudo class styles through keys.
 *
 *  @param keys      the keys to search pseudo class
 *
 *  @return pseudo class.
 */
-(NSMutableDictionary *)getPseudoClassStylesByKeys:(NSArray *)keys;

///--------------------------------------
/// @name Updating PseudoClass
///--------------------------------------

/**
 * @abstract Called when component's style are updated
 *
 * @param pseudoClassStyles The updated style dictionary
 * @discussion It can be overrided to handle specific style updating. The method is called on the main thread.
 **/
- (void)updatePseudoClassStyles:(NSDictionary *)pseudoClassStyles;

///--------------------------------------
/// @name recovery styles
///--------------------------------------

/**
 * @abstract Called when component recovery styles
 *
 * @discussion It can be overrided to handle specific style recovery. The method is called on the main thread.
 **/
- (void)recoveryPseudoStyles:(NSDictionary *)styles;

@end

NS_ASSUME_NONNULL_END
