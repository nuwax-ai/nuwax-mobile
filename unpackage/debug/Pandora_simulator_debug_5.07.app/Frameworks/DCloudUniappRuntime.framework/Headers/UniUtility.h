//
//  UniUtility.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/13.
//

#import <Foundation/Foundation.h>
#import <DCloudUniappRuntime/UniTypeDef.h>

NS_ASSUME_NONNULL_BEGIN

#define UNI_ENUMBER_CASE(_invoke, idx, code, obj, _type, op, _flist) \
case code:{\
    _type *_tmp = malloc(sizeof(_type));\
    memset(_tmp, 0, sizeof(_type));\
    *_tmp = [obj op];\
    [_invoke setArgument:_tmp atIndex:(idx) + 2];\
    *(_flist + idx) = _tmp;\
    break;\
}
#define UNI_EPCHAR_CASE(_invoke, idx, code, obj, _type, op, _flist) \
case code:{\
    _type *_tmp = (_type  *)[obj op];\
    [_invoke setArgument:&_tmp atIndex:(idx) + 2];\
    *(_flist + idx) = 0;\
    break;\
}\

#define UNI_ALLOC_FLIST(_ppFree, _count) \
do {\
    _ppFree = (void *)malloc(sizeof(void *) * (_count));\
    memset(_ppFree, 0, sizeof(void *) * (_count));\
} while(0)

#define UNI_FREE_FLIST(_ppFree, _count) \
do {\
    for(int i = 0; i < _count; i++){\
        if(*(_ppFree + i ) != 0) {\
            free(*(_ppFree + i));\
        }\
    }\
    free(_ppFree);\
}while(0)

#define UNI_ARGUMENTS_SET(_invocation, _sig, idx, _obj, _ppFree) \
do {\
    const char *encode = [_sig getArgumentTypeAtIndex:(idx) + 2];\
    switch(encode[0]){\
        UNI_EPCHAR_CASE(_invocation, idx, _C_CHARPTR, _obj, char *, UTF8String, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_INT, _obj, int, intValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_SHT, _obj, short, shortValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_LNG, _obj, long, longValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_LNG_LNG, _obj, long long, longLongValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_UCHR, _obj, unsigned char, unsignedCharValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_UINT, _obj, unsigned int, unsignedIntValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_USHT, _obj, unsigned short, unsignedShortValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_ULNG, _obj, unsigned long, unsignedLongValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_ULNG_LNG, _obj,unsigned long long, unsignedLongLongValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_FLT, _obj, float, floatValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_DBL, _obj, double, doubleValue, _ppFree)\
        UNI_ENUMBER_CASE(_invocation, idx, _C_BOOL, _obj, bool, boolValue, _ppFree)\
        default: { [_invocation setArgument:&_obj atIndex:(idx) + 2]; *(_ppFree + idx) = 0; break;}\
    }\
}while(0)

/**
 * 默认屏幕宽度。
 */
static const CGFloat UniDefaultScreenWidth = 750.0;

/**
 * 在主线程上执行指定的 block。
 *
 * @param block 要执行的 block。
 */
void UniPerformBlockOnMainThread( void (^ _Nonnull block)(void));

/**
 * 工具类。
 */
@interface UniUtility : NSObject

/**
 * 获取竖屏屏幕尺寸。
 *
 * @return 竖屏屏幕尺寸。
 */
+ (CGSize)portraitScreenSize;

/**
 * 获取默认像素缩放因子。
 *
 * @return 默认像素缩放因子。
 */
+ (CGFloat)defaultPixelScaleFactor;

/**
 * 获取屏幕缩放因子。
 *
 * @return 屏幕缩放因子。
 */
CGFloat UniScreenScale(void);

/**
 * 将像素值转换为点值。
 *
 * @param value 像素值。
 * @param scaleFactor 缩放因子。
 * @return 点值。
 */
CGFloat UniPixelScale(CGFloat value, CGFloat scaleFactor);

/**
 * 四舍五入像素值。
 *
 * @param value 像素值。
 * @return 四舍五入后的像素值。
 */
CGFloat UniRoundPixelValue(CGFloat value);

/**
 * 向下取整像素值。
 *
 * @param value 像素值。
 * @return 向下取整后的像素值。
 */
CGFloat UniFloorPixelValue(CGFloat value);

/**
 * 向上取整像素值。
 *
 * @param value 像素值。
 * @return 向上取整后的像素值。
 */
CGFloat UniCeilPixelValue(CGFloat value);

/**
 * 获取字符串中子字符串出现的次数。
 *
 * @param string 字符串。
 * @param subString 子字符串。
 * @return 子字符串出现的次数。
 */
+ (NSUInteger)getSubStringNumber:(NSString *_Nullable)string subString:(NSString *_Nullable)subString;

/**
 * 根据颜色、位置、尺寸等参数创建渐变层。
 *
 * @param colors 渐变颜色数组。
 * @param locations 渐变颜色位置数组。
 * @param frame 渐变层的尺寸和位置。
 * @param gradientType 渐变类型。
 * @return 渐变层。
 */
+ (CAGradientLayer *_Nullable)gradientLayerFromColors:(NSArray*_Nullable)colors
                                           locations:(NSArray*_Nullable)locations
                                               frame:(CGRect)frame
                                        gradientType:(UniGradientType)gradientType;

/**
 * 根据背景图片创建线性渐变。
 *
 * @param backgroundImage 背景图片。
 * @return 线性渐变。
 */
+ (NSDictionary *_Nullable)linearGradientWithBackgroundImage:(NSString *_Nullable)backgroundImage;

/**
 * 判断两个浮点数是否相等。
 *
 * @param a 浮点数 a。
 * @param b 浮点数 b。
 * @return 是否相等。
 */
BOOL UniFloatEqual(CGFloat a, CGFloat b);

/**
 * 判断两个浮点数是否相等，可指定精度。
 *
 * @param a 浮点数 a。
 * @param b 浮点数 b。
 * @param precision 精度。
 * @return 是否相等。
 */
BOOL UniFloatEqualWithPrecision(CGFloat a, CGFloat b ,double precision);

/**
 * 判断一个浮点数是否小于另一个浮点数。
 *
 * @param a 浮点数 a。
 * @param b 浮点数 b。
 * @return 是否小于。
 */
BOOL UniFloatLessThan(CGFloat a, CGFloat b);

/**
 * 判断一个浮点数是否小于另一个浮点数，可指定精度。
 *
 * @param a 浮点数 a。
 * @param b 浮点数 b。
 * @param precision 精度。
 * @return 是否小于。
 */
BOOL UniFloatLessThanWithPrecision(CGFloat a, CGFloat b,double precision);

/**
 * 判断一个浮点数是否大于另一个浮点数。
 *
 * @param a 浮点数 a。
 * @param b 浮点数 b。
 * @return 是否大于。
 */
BOOL UniFloatGreaterThan(CGFloat a, CGFloat b);

/**
 * 判断一个浮点数是否大于另一个浮点数，可指定精度。
 *
 * @param a 浮点数 a。
 * @param b 浮点数 b。
 * @param precision 精度。
 * @return 是否大于。
 */
BOOL UniFloatGreaterThanWithPrecision(CGFloat a,CGFloat b,double precision);

/**
 * 判断字符串是否为空。
 *
 * @param string 字符串。
 * @return 是否为空。
 */
+ (BOOL)isBlankString:(NSString * _Nullable)string;

/**
 * 判断点是否有效。
 *
 * @param point 点。
 * @return 是否有效。
 */
+ (BOOL)isValidPoint:(CGPoint)point;

/**
 * 根据字体大小、字重、字体样式、字体名称、缩放因子等参数创建字体。
 *
 * @param size 字体大小。
 * @param textWeight 字重。
 * @param textStyle 字体样式。
 * @param fontFamily 字体名称。
 * @param scaleFactor 缩放因子。
 * @param defaultFontSize 默认字体大小。
 * @return 字体。
 */
+ (UIFont *_Nonnull)fontWithSize:(CGFloat)size textWeight:(CGFloat)textWeight textStyle:(UniTextStyle)textStyle fontFamily:(NSString *_Nullable)fontFamily scaleFactor:(CGFloat)scaleFactor defaultFontSize:(CGFloat)defaultFontSize;

/**
 * 根据字体大小、字重、字体样式、字体名称、缩放因子等参数创建字体，可选择是否使用 Core Text。
 *
 * @param size 字体大小。
 * @param textWeight 字重。
 * @param textStyle 字体样式。
 * @param fontFamily 字体名称。
 * @param scaleFactor 缩放因子。
 * @param defaultFontSize 默认字体大小。
 * @param useCoreText 是否使用 Core Text。
 * @return 字体。
 */
+ (UIFont *_Nonnull)fontWithSize:(CGFloat)size textWeight:(CGFloat)textWeight textStyle:(UniTextStyle)textStyle fontFamily:(NSString *_Nullable)fontFamily scaleFactor:(CGFloat)scaleFactor  defaultFontSize:(CGFloat)defaultFontSize useCoreText:(BOOL)useCoreText;
+ (UIFont *_Nonnull)fontWithSize:(CGFloat)size textWeight:(CGFloat)textWeight textStyle:(UniTextStyle)textStyle fontFamily:(NSString *_Nullable)fontFamily scaleFactor:(CGFloat)scaleFactor  defaultFontSize:(CGFloat)defaultFontSize useCoreText:(BOOL)useCoreText fallbackFont:(BOOL)fallbackFont/*字体加载失败是否使用默认字体canvas*/;
+ (BOOL)testCustomFont:(NSString*)fontFamily;
/**
 * 判断文件是否存在。
 *
 * @param filePath 文件路径。
 * @return 是否存在。
 */
+ (BOOL)isFileExist:(NSString * _Nonnull)filePath;

/**
 * 获取文档目录。
 *
 * @return 文档目录。
 */
+ (NSString *_Nonnull)documentDirectory;

/**
 * 获取缓存目录。
 *
 * @return 缓存目录。
 */
+ (NSString *_Nonnull)cacheDirectory;

/**
 * 对字符串进行 MD5 散列。
 *
 * @param string 字符串。
 * @return MD5 散列值。
 */
+ (NSString *_Nullable)md5:(NSString *_Nullable)string;

/**
 * 获取 Library 目录。
 *
 * @return Library 目录。
 */
+ (NSString *_Nonnull)libraryDirectory;

/**
 * 设置是否启用 RTL 布局方向。
 *
 * @param value 是否启用 RTL 布局方向。
 */
+ (void)setEnableRTLLayoutDirection:(BOOL)value;

/**
 * 获取是否启用 RTL 布局方向。
 *
 * @return 是否启用 RTL 布局方向。
 */
+ (BOOL)enableRTLLayoutDirection;

+ (NSString *)originTypeFromNumber:(NSNumber *)data;

+ (NSData *)aesDecryptWithData:(NSData *)data key:(NSString *)key;

/**
 * @abstract JSON Encode Method
 *
 * @param object Object.
 *
 * @return A json string by encoding json object.
 *
 */
+ (NSString * _Nullable)JSONString:(id _Nonnull)object;

@end

NS_ASSUME_NONNULL_END
