//
//  UniTypeDef.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/13.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

typedef NS_ENUM(NSUInteger, UniLayoutDirection) {
    UniLayoutDirectionLTR,
    UniLayoutDirectionRTL,
    UniLayoutDirectionAuto,
};

typedef NS_ENUM(NSUInteger, UniComponentType) {
    UniComponentTypeCommon = 0,
    UniComponentTypeVirtual
};

typedef NS_ENUM(NSUInteger, UniScrollDirection) {
    UniScrollDirectionVertical,
    UniScrollDirectionHorizontal,
    UniScrollDirectionNone,
};

typedef NS_ENUM(NSUInteger, UniTextStyle) {
    UniTextStyleNormal = 0,
    UniTextStyleItalic
};

typedef NS_ENUM(NSInteger, UniTextDecoration) {
    UniTextDecorationNone = 0,
    UniTextDecorationUnderline,
    UniTextDecorationLineThrough
};

typedef NS_ENUM(NSInteger, UniImageQuality) {
    UniImageQualityOriginal = -1,
    UniImageQualityLow = 0,
    UniImageQualityNormal,
    UniImageQualityHigh,
    UniImageQualityNone,
};

typedef NS_ENUM(NSInteger, UniImageSharp) {
    UniImageSharpeningNone = 0,
    UniImageSharpening
};

typedef NS_ENUM(NSInteger, UniVisibility) {
    UniVisibilityShow = 0,
    UniVisibilityHidden
};

typedef NS_ENUM(NSInteger, UniBorderStyle) {
    UniBorderStyleNone = 0,
    UniBorderStyleDotted,
    UniBorderStyleDashed,
    UniBorderStyleSolid
};

typedef NS_ENUM(NSInteger, UniPositionType) {
    UniPositionTypeRelative = 0,
    UniPositionTypeAbsolute,
    UniPositionTypeSticky,
    UniPositionTypeFixed
};

typedef NS_ENUM(NSInteger, UniGradientType) {
    UniGradientTypeToTop = 0,
    UniGradientTypeToBottom,
    UniGradientTypeToLeft,
    UniGradientTypeToRight,
    UniGradientTypeToTopleft,
    UniGradientTypeToTopright,
    UniGradientTypeToBottomleft,
    UniGradientTypeToBottomright,
};

typedef NS_ENUM(NSInteger, UIViewContentModeDCExtend) {
    UIViewContentModeWidthFix_DCExtend = 1000,
    UIViewContentModeHeightFix_DCExtend
};

typedef NS_ENUM(NSInteger, UniWhiteSpaceType) {
    UniWhiteSpaceTypeNormal = 0,
    UniWhiteSpaceTypeNowrap,
    UniWhiteSpaceTypePre,
    UniWhiteSpaceTypePreWrap,
    UniWhiteSpaceTypePreLine,
    UniWhiteSpaceTypeBreakSpaces,
    UniWhiteSpaceTypeKeep
};

typedef NS_ENUM(NSInteger, UniTextOverflow) {
    UniTextOverflowClip = 0,
    UniTextOverflowEllipsis
};
