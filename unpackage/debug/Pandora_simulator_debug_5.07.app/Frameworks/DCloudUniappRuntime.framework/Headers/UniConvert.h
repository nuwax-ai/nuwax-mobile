//
//  UniConvert.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/3/13.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <DCloudUniappRuntime/UniTypeDef.h>
#import <DCloudUniappRuntime/UniUtility.h>
#import <DCloudUniappRuntime/UniBoxShadow.h>
#import <objc/runtime.h>
#import <DCloudUniappRuntime/UniDefine.h>
#import <DCloudUniappRuntime/UniLength.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniConvert : NSObject

+ (BOOL)BOOL:(id)value;

+ (CGFloat)CGFloat:(id)value;

+ (CGFloat)flexCGFloat:(id)value;
+ (BOOL)checkStringIsRealNum:(NSString *)checkedNumString;
+ (NSUInteger)NSUInteger:(id)value;
+ (NSInteger)NSInteger:(id)value;
+ (nullable NSString *)NSString:(id)value;

typedef CGFloat UniPixelType;
+ (UniPixelType)UniPixelType:(id)value scaleFactor:(CGFloat)scaleFactor viewport:(CGFloat)viewport;
+ (UniPixelType)UniFlexPixelType:(id)value scaleFactor:(CGFloat)scaleFactor viewport:(CGFloat)viewport;

+ (UIAccessibilityTraits)UniUIAccessibilityTraits:(id)value;

/// 解析失败默认返回白色
+ (nullable UIColor *)UIColor:(id)value;
/// 解析失败返回 defaultColor
+ (nullable UIColor *)UIColor:(id)value default:(UIColor * __nullable)defaultColor;
+ (CGColorRef)CGColor:(id)value;
+ (NSArray<NSNumber*>*)dealWithColor:(UIColor *)color;
+ (NSString *)HexWithColor:(UIColor *)color;

+ (UniBorderStyle)UniBorderStyle:(id)value;
typedef BOOL UniClipType;
+ (UniClipType)UniClipType:(id)value;
+ (UniPositionType)UniPositionType:(id)value;
+ (CGFloat)UniTextWeight:(id)value;
+ (UniTextStyle)UniTextStyle:(id)value;
+ (UniTextDecoration)UniTextDecoration:(id)value;
+ (NSTextAlignment)NSTextAlignment:(id)value;
+ (UIReturnKeyType)UIReturnKeyType:(id)value;
+ (UITextContentType)UITextContentType:(id)value;


+ (UniVisibility)UniVisibility:(id __nullable)value;

+ (UniGradientType)gradientType:(id)value;

+ (nullable UniLength *)UniLength:(id)value isFloat:(BOOL)isFloat scaleFactor:(CGFloat)scaleFactor;
+ (UniBoxShadow *)UniBoxShadow:(id)value scaleFactor:(CGFloat)scaleFactor  viewport:(CGFloat)viewport;

+ (UIViewAnimationOptions)UIViewAnimationTimingFunction:(id)value;
+ (UITableViewRowAnimation)UITableViewRowAnimation:(id)value;
+ (CAMediaTimingFunction *)CAMediaTimingFunction:(id)value;

+ (UIViewContentMode)UIViewContentMode:(id)value;
+ (UniImageQuality)UniImageQuality:(id)value;
+ (UniImageSharp)UniImageSharp:(id)value;

+ (CGFloat)safeAreaInset:(NSString*)value;

@end

NS_ASSUME_NONNULL_END
