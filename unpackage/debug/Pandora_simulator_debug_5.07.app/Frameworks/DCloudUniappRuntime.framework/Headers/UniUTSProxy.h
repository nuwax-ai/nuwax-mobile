//
//  UniUTSProxy.h
//  DCloudUniappRuntime
//
//  Created by X on 2023/11/2.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@protocol UniUTSProxyProtocol <NSObject>
typedef void (^UniUTSProxyKeepAliveCallback)(id result, BOOL keepAlive);
@required
- (id)invokeSync:(NSDictionary *)options callback:(UniUTSProxyKeepAliveCallback)callback;
- (void)invokeAsync:(NSDictionary *)options callback:(UniUTSProxyKeepAliveCallback)callback;
- (void)destory;
@end

@interface UniUTSProxyManager : NSObject {
    NSMutableDictionary<NSString*, id<UniUTSProxyProtocol>>* _utsProxy;
}
-(id<UniUTSProxyProtocol>)getProxyWithPageId:(NSString*)pageId;
-(void)removeProxyWithPageId:(NSString*)pageId;
-(void)destory;
@end

NS_ASSUME_NONNULL_END
