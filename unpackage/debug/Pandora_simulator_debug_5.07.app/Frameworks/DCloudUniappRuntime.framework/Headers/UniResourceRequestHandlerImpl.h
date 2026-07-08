//
//  UniResourceRequestHandlerImpl.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/5/5.
//

#import <Foundation/Foundation.h>
#import <DCloudUniappRuntime/UniResourceRequest.h>
#import <DCloudUniappRuntime/UniResourceResponse.h>

@protocol UniResourceRequestDelegate <NSObject>

// Periodically informs the delegate of the progress of sending content to the server.
- (void)request:(UniResourceRequest *_Nonnull)request didSendData:(unsigned long long)bytesSent totalBytesToBeSent:(unsigned long long)totalBytesToBeSent;

// Tells the delegate that the request received the initial reply (headers) from the server.
- (void)request:(UniResourceRequest *_Nonnull)request didReceiveResponse:(UniResourceResponse *_Nonnull)response;

// Tells the delegate that the request has received some of the expected data.
- (void)request:(UniResourceRequest *_Nonnull)request didReceiveData:(NSData *_Nonnull)data;

// Tells the delegate that the request finished transferring data.
- (void)requestDidFinishLoading:(UniResourceRequest *_Nonnull)request;

// Tells the delegate that the request failed to load successfully.
- (void)request:(UniResourceRequest *_Nonnull)request didFailWithError:(NSError *_Nullable)error;
    
// Tells the delegate that when complete statistics information has been collected for the task.
#ifdef __IPHONE_10_0
- (void)request:(UniResourceRequest *_Nonnull)request didFinishCollectingMetrics:(NSURLSessionTaskMetrics *_Nullable)metrics API_AVAILABLE(macosx(10.12), ios(10.0), watchos(3.0), tvos(10.0));
#endif

@end

@protocol UniResourceRequestHandler <NSObject>

// Send a resource request with a delegate
- (void)sendRequest:(UniResourceRequest *_Nonnull)request withDelegate:(id<UniResourceRequestDelegate>_Nonnull)delegate;

@optional

// Cancel the ongoing request
- (void)cancelRequest:(UniResourceRequest *_Nonnull)request;

@end


NS_ASSUME_NONNULL_BEGIN

@interface DCTLSCertificateItem : NSObject
@property (nonatomic, copy) NSString *client;
@property (nonatomic, copy) NSString *clientPassword;
@property (nonatomic, strong) NSArray *server;
@end

@interface DCSecurityPolicy : NSObject

//+ (void)configTLSCertificate:(NSArray *)certificates weexInstance:(WXSDKInstance *)weexInstance callback:(WXModuleKeepAliveCallback)callback;

@end

@interface UniResourceRequestHandlerImpl : NSObject <UniResourceRequestHandler>
@property (nonatomic, strong) DCSecurityPolicy *securityPolicy;
@end

NS_ASSUME_NONNULL_END
