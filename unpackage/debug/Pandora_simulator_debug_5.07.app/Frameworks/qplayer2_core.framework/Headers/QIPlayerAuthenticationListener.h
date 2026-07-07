//
//  Header.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/12.
//

#ifndef QIPlayerAuthenticationListener_h
#define QIPlayerAuthenticationListener_h
@class QPlayerContext;

/**
 鉴权结果回调监听
 */
@protocol QIPlayerAuthenticationListener <NSObject>

/**
 @brief 鉴权失败回调
 @param context 当前播放器
 @param error 失败错误码
 */
@optional
-(void)onAuthenticationFailed:(QPlayerContext*)context error:(QPlayerAuthenticationErrorType)error;

/**
 @brief 鉴权成功回调
 @param context 当前播放器
 */
@optional
-(void)onAuthenticationSuccess:(QPlayerContext*)context;
@end

#endif /* QIPlayerAuthenticationListener_h */
