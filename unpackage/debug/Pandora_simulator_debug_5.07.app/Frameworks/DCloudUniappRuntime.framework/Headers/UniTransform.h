//
//  UniTransform.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/18.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
@class DCUniComponent;
@class UniLength;

NS_ASSUME_NONNULL_BEGIN

typedef NS_OPTIONS(NSUInteger, UniTransformPropertyUpdateMask) {
    UniTransformPropertyUpdateMaskNone        = 1 << 0,
    UniTransformPropertyUpdateMaskTranslateX  = 1 << 1,
    UniTransformPropertyUpdateMaskTranslateY  = 1 << 2,
    UniTransformPropertyUpdateMaskRotateX     = 1 << 3,
    UniTransformPropertyUpdateMaskRotateY     = 1 << 4,
    UniTransformPropertyUpdateMaskRotateZ     = 1 << 5,
    UniTransformPropertyUpdateMaskRotate      = 1 << 6,
    UniTransformPropertyUpdateMaskScaleX      = 1 << 7,
    UniTransformPropertyUpdateMaskScaleY      = 1 << 8,
};

@interface UniTransform : NSObject

@property (nonatomic, assign, readonly) float rotateAngle;
@property (nonatomic, assign, readonly) float rotateX;
@property (nonatomic, assign, readonly) float rotateY;
@property (nonatomic, assign, readonly) float rotateZ;
@property (nonatomic, strong, readonly) UniLength *translateX;
@property (nonatomic, strong, readonly) UniLength *translateY;
@property (nonatomic, assign, readonly) float scaleX;
@property (nonatomic, assign, readonly) float scaleY;
@property (nonatomic, assign, readonly) UniLength *originX;
@property (nonatomic, assign, readonly) UniLength *originY;
@property (nonatomic, assign) float perspective;
@property (nonatomic, assign) UniTransformPropertyUpdateMask propertyUpdateMask;
@property(nonatomic, strong) NSMutableArray *transformList;


- (instancetype)initWithCSSValue:(NSString *__nullable)cssValue origin:(NSString *__nullable)origin instance:(DCUniComponent *__nullable)component;

- (instancetype)initWithNativeTransform:(CATransform3D)transform instance:(DCUniComponent *)component;

- (void)applyTransformForView:(UIView *)view;

- (void)dc_resetTranform:(UIView*)view;
- (void)dc_resetTranformOrigin:(UIView*)view;
- (BOOL)hasUpdateMask:(UniTransformPropertyUpdateMask)mask;
- (void)setTransformOrigin:(NSString *)transformOriginCSS;

@end

NS_ASSUME_NONNULL_END
