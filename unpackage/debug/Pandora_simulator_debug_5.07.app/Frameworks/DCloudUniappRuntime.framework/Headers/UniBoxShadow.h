//
//  UniBoxShadow.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/13.
//

#import <Foundation/Foundation.h>
#import <DCloudUniappRuntime/UniInnerLayer.h>


NS_ASSUME_NONNULL_BEGIN

@interface UniBoxShadow : NSObject

@property(nonatomic,strong,nullable) UIColor *shadowColor;
@property CGSize shadowOffset;
@property CGFloat shadowRadius;
@property BOOL isInset;
@property (nonatomic, strong, nullable)UniInnerLayer *innerLayer;
@property CGFloat shadowOpacity;
@property CGFloat shadowWidth;

/**
 *  @abstract get boxshadow from string and adapter phone screen
 *
 *  @param string the boxshadow string
 *
 *  @param scaleFactor the boxshadow set last time
 *
 *  @return A WXBoxShadow object
 */
+(UniBoxShadow *_Nullable)getBoxShadowFromString:(NSString *_Nullable)string scaleFactor:(CGFloat)scaleFactor viewport:(CGFloat)viewport;

@end

NS_ASSUME_NONNULL_END
