//
//  QIPlayerSubtitleListener.h
//  qplayer2-core
//
//  Created by Dynasty Dream on 2023/7/17.
//

#ifndef QIPlayerSubtitleListener_h
#define QIPlayerSubtitleListener_h
@class QPlayerContext;
/**
 字幕监听
 */
@protocol QIPlayerSubtitleListener <NSObject>

/**
 字幕信息改变回调
 @param context 当前的播放器
 @param text 字幕文本
*/
@optional
-(void)onSubtitleTextChange:(QPlayerContext *)context text:(NSString*)text;

/**
 字幕切换成功回调
 @param context 当前的播放器
 @param name 字幕名称
*/
@optional
-(void)onSubtitleNameChange:(QPlayerContext *)context name:(NSString *)name;

/**
 字幕开关设置回调
 @param context 当前的播放器
 @param enable 当前是否开启 true 开启，false 关闭
*/
@optional
-(void)onSubtitleEnable:(QPlayerContext *)context enable:(BOOL)enable;

/**
 字幕加载结果回调
 @param context 当前的播放器
 @param name 字幕名称
 @param result 加载结果 true 加载成功 false 加载失败
*/
@optional
-(void)onSubtitleLoaded:(QPlayerContext *)context name:(NSString*)name result:(BOOL)result;

/**
 字幕解码结果回调
 @param context 当前的播放器
 @param name 字幕名称
 @param result 字幕解码结果  true 解码成功 false 解码失败
*/
@optional
-(void)onSubtitleDecoded:(QPlayerContext *)context name:(NSString*)name result:(BOOL)result;
@end

#endif /* QIPlayerSubtitleListener_h */
