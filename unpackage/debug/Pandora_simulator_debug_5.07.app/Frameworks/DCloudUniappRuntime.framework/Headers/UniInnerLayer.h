//
//  UniInnerLayer.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/13.
//

#import <Foundation/Foundation.h>
#import <QuartzCore/QuartzCore.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniInnerLayer : CAGradientLayer

@property CGFloat boxShadowRadius;
@property (nonatomic,strong) UIColor *boxShadowColor;
@property CGSize boxShadowOffset;
@property CGFloat boxShadowOpacity;

@end

NS_ASSUME_NONNULL_END
