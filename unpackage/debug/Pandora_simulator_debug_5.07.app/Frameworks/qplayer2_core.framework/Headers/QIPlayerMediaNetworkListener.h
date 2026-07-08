//
//  QIPlayerMediaNetworkListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/11.
//

#ifndef QIPlayerMediaNetworkListener_h
#define QIPlayerMediaNetworkListener_h

@class QPlayerContext;
/**
 播放器媒体相关监听
 */
@protocol QIPlayerMediaNetworkListener <NSObject>
/***
 开始重连
 @param context 当前的播放器
 @param userType 重连url流的userType
 @param urlType 重连url流的urlType
 @param url 重连的url
 @param retryTime 已重试的次数
*/
@optional
-(void)onReconnectStart:(QPlayerContext *)context userType:(NSString *)userType urlType:(QPlayerURLType)urlType url:(NSString *)url retryTime:(NSInteger)retryTime;

/***
 重连结束
 @param context 当前的播放器
 @param userType 重连url流的userType
 @param urlType 重连url流的urlType
 @param url 重连的url
 @param retryTime 已重试的次数
 @param error 错误码
*/
@optional
-(void)onReconnectEnd:(QPlayerContext *)context userType:(NSString *)userType urlType:(QPlayerURLType)urlType url:(NSString *)url retryTime:(NSInteger)retryTime error:(QPlayerOpenError)error;

/***
 打开失败
 @param context 当前的播放器
 @param userType 重连url流的userType
 @param urlType 重连url流的urlType
 @param url 重连的url
 @param error 错误码
*/
@optional
-(void)onOpenFailed:(QPlayerContext *)context userType:(NSString *)userType urlType:(QPlayerURLType)urlType url:(NSString *)url error:(QPlayerOpenError)error;

@end
#endif /* QIPlayerMediaNetworkListener_h */
