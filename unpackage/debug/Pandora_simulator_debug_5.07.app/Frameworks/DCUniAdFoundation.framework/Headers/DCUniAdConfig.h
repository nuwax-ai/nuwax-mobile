//
//  DCUniAdConfig.h
//  DCUniAdFoundation
//
//  Created by dcloud on 2022/1/27.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface DCUniAdConfig : NSObject

/// SDK 注册接口，请在 app 初始化时调用。
/// @param appID - 媒体ID
/// @param unionID - 联盟ID
+ (void)registerAppID:(NSString *)appID unionID:(NSString *)unionID;


/// 获取 SDK 版本
+ (NSString *)sdkVersion;


/// 设置个性化推荐状态 默认开启
/// @param isOpen YES : 开启  NO : 关闭
+ (void)setPersonalAd:(BOOL)isOpen;


/// 获取当前个性化推荐状态
+ (BOOL)getPersonalAd;


/// 获取当前环境 china | global
+ (NSString *)getEnvironment;

/*! @brief 处理SDK通过URL启动App时传递的数据
 *
 * 需要在 application:openURL:sourceApplication:annotation:或者application:handleOpenURL中调用。
 * @param url 启动第三方应用时传递过来的URL
 * @return 成功返回YES，失败返回NO。
 */
+ (BOOL)handleOpenUrl:(NSURL *)url;

/*! @brief 处理SDK通过Universal Link启动App时传递的数据
 *
 * 需要在 application:continueUserActivity:restorationHandler:中调用。
 * @param userActivity 启动第三方应用时系统API传递过来的userActivity
 * @return 成功返回YES，失败返回NO。
 */
+ (BOOL)handleOpenUniversalLink:(NSUserActivity *)userActivity;

@end
NS_ASSUME_NONNULL_END
