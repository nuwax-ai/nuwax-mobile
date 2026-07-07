//
//  UniRoundedRect.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/17.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniRadii : NSObject

@property (nonatomic, assign) CGFloat topLeft;
@property (nonatomic, assign) CGFloat topRight;
@property (nonatomic, assign) CGFloat bottomLeft;
@property (nonatomic, assign) CGFloat bottomRight;

- (BOOL)hasBorderRadius;

- (BOOL)radiusesAreEqual;

@end


@interface UniRoundedRect : NSObject

@property (nonatomic, assign) CGRect rect;
@property (nonatomic, strong) UniRadii *radii;

- (instancetype)initWithRect:(CGRect)rect
                     topLeft:(CGFloat)topLeft
                    topRight:(CGFloat)topRight
                  bottomLeft:(CGFloat)bottomLeft
                 bottomRight:(CGFloat)bottomRight;


@end

NS_ASSUME_NONNULL_END
