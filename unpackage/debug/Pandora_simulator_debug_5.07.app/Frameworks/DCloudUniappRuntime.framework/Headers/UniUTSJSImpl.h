//
//  UniUTSJS.h
//  DCloudUniappRuntime
//
//  Created by X on 2024/9/23.
//

#import <Foundation/Foundation.h>


NS_ASSUME_NONNULL_BEGIN
typedef void (^UniUTSJSImplCallback)(NSArray<id>*);

typedef void (^UniOpenDialogCallback)(NSDictionary<NSString*,id>*);

@interface UniOpenDialogPageOptions : NSObject
@property(nonatomic, strong)NSString* url;
@property(nonatomic, strong) NSString* _Nullable animationType;
@property(nonatomic, strong)NSNumber* _Nullable animationDuration;
@property(nonatomic, strong)NSNumber* _Nullable disableEscBack;
@property(nonatomic, strong)NSNumber* _Nullable triggerParentHide;
@property(nonatomic, strong)id _Nullable parentPage;
@property(nonatomic, strong)UniOpenDialogCallback success;
@property(nonatomic, strong)UniOpenDialogCallback fail;
@property(nonatomic, strong)UniOpenDialogCallback complete;
@end

@interface UniCloseDialogPageOptions : NSObject
@property(nonatomic, strong)NSString* _Nullable animationType;
@property(nonatomic, strong)NSNumber* _Nullable animationDuration;
@property(nonatomic, strong)id dialogPage;
@property(nonatomic, strong)UniOpenDialogCallback success;
@property(nonatomic, strong)UniOpenDialogCallback fail;
@property(nonatomic, strong)UniOpenDialogCallback complete;
@end

@interface UniUTSJSImpl : NSObject
+(NSNumber*)on:(NSString*)eventName callback:(UniUTSJSImplCallback)callback;
+(void)off:(NSString*)eventName callback:(nullable NSNumber*)callbackid;
+(NSNumber*)once:(NSString*)eventName callback:(UniUTSJSImplCallback)callback;
+(void)emit:(NSString*)eventName arguments:(nullable NSArray<id>*)arguments;
+(id)openDialogPage:(UniOpenDialogPageOptions*)options;
+(void)closeDialogPage:(UniCloseDialogPageOptions*)option;
@end

@interface UniUTSJSEventBusContext : NSObject {
    NSMutableDictionary *_callbacks;
}
+(instancetype)shared;
- (void)removeCallback:(int)cbId;
- (void)removeCallbackWithName:(NSString*)name;
- (void)removeCallbackWithName:(NSString*)name withCallbackId:(int)cbId;
@end

NS_ASSUME_NONNULL_END
