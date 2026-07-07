//
//  UniAppPermissionManager.h
//  DCloudUniappRuntime
//
//  Created by dcloud on 2023/11/22.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniAppPermissionManager : NSObject

extern NSString *const uni_permission_state_authorized;
extern NSString *const uni_permission_state_denied;
extern NSString *const uni_permission_state_notDetermined;

extern NSString *const k_uni_permission_push;
extern NSString *const k_uni_permission_push_alert;
extern NSString *const k_uni_permission_push_badge;
extern NSString *const k_uni_permission_push_sound;

+ (NSDictionary *)getBluetoothSetting;
+ (NSDictionary *)getLocationSetting;

+ (NSString *)getGgbs;
+ (NSString *)getBluetoothAuthorized;
+ (NSString *)getLocationAuthorized;
+ (NSString *)getLocationAccuracy;
+ (NSString *)getMicrophoneAuthorized;
+ (NSString *)getCameraAuthorized;
+ (NSString *)getAlbumAuthorized;
+ (NSDictionary *)getNotificationAuthorized;
//+ (void)getNotificationAuthorized:(void (^)(NSDictionary *))block;

@end

NS_ASSUME_NONNULL_END
