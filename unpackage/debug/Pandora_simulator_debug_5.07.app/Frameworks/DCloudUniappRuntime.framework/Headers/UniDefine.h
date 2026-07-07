//
//  UniDefine.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/17.
//

#ifndef UniDefine_h
#define UniDefine_h

/*
 * Concatenate preprocessor tokens a and b without expanding macro definitions
 * (however, if invoked from a macro, macro arguments are expanded).
 */
#define UNI_CONCAT(a, b)   a ## b
/*
 * Concatenate preprocessor tokens a and b after macro-expanding them.
 */
#define UNI_CONCAT_WRAPPER(a, b)    UNI_CONCAT(a, b)

#define UNI_CONCAT_TRIPLE(a, b, c) a ## b ## c

#define UNI_NSSTRING_HELPER(x) #x
#define UNI_NSSTRING(x) @UNI_NSSTRING_HELPER(x)


#define UNI_FONT_DOWNLOAD_DIR [[UniUtility cacheDirectory] stringByAppendingPathComponent:[NSString stringWithFormat:@"uniappdownload"]]

#define UNI_ICONFONT_DOWNLOAD_NOTIFICATION  @"UNI_ICONFONT_DOWNLOAD_FINISH_NOTIFICATION"
#define UNI_ICONFONT_READY_NOTIFICATION     @"UNI_ICONFONT_READY_NOTIFICATION"

/**
 *  @abstract Estimate component's type. If the type isn't equal to UniComponentTypeCommon, then return.
 */
#define UNI_CHECK_COMPONENT_TYPE(type)\
do {\
if (type != UniComponentTypeCommon) {\
return;\
}\
} while (0);


#define UNI_ERROR_DOMAIN @"UNIErrorDomain"

/**
 *  @abstract Compared with system version of current device
 *
 *  @return YES if greater than or equal to the system verison, otherwise, NO.
 *
 */
#define UNI_SYS_VERSION_GREATER_THAN_OR_EQUAL_TO(v)  ([[[UIDevice currentDevice] systemVersion] compare:v options:NSNumericSearch] != NSOrderedAscending)

#endif /* UniDefine_h */
