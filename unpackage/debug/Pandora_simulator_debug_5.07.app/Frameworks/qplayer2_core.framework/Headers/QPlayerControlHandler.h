//
//  QPlayerControlHandler.h
//  QPlayerKit
//
//  Created by 王声禄 on 2022/8/2.
//

#import <Foundation/Foundation.h>
#import <qplayer2_core/QIOSCommon.h>
#import <UIKit/UIKit.h>
#import <qplayer2_core/QIPlayerListenerHeader.h>
#import <CoreMedia/CoreMedia.h>
NS_ASSUME_NONNULL_BEGIN
@class QPlayer;
@class QMediaModel;
@class QStreamElement;
@class QMediaItem;
@class QPlayerContext;
@class QMediaItemContext;

/**
 * 播放器控制Handler
 */
@interface QPlayerControlHandler : NSObject{
    @package void *mPlayer;
}

/**
  当前播放状态
*/
@property (nonatomic, assign, readonly) QPlayerState  currentPlayerState;

/**
 当前进度
*/
@property (nonatomic, assign, readonly) long  currentPosition;

/**
 视频时长
*/
@property (nonatomic, assign, readonly) long duration;

/**
 当前下载速度
*/
@property (nonatomic, assign, readonly) long downloadSpeed;

/**
 当前缓冲进度
*/
@property (nonatomic, assign, readonly) long bufferPostion;

/**
 当前FPS
*/
@property (nonatomic, assign, readonly) int fps;
/**
 当前码率
*/
@property (nonatomic, assign, readonly) int biteRate;


/**
 当前速度
*/
@property (nonatomic, assign, readonly) float playerSpeed;

/**
 是否静音
*/
@property (nonatomic, assign, readonly) BOOL isMute;


/**
 当前字幕文本
*/
@property (nonatomic, strong, readonly) NSString *subtitleText;


/**
 当前字幕名称
*/
@property (nonatomic, strong, readonly) NSString *subtitleName;

/**
 当前播放器是否在缓存
*/
@property (nonatomic, assign, readonly) BOOL isBuffering;


/**
 废弃方法
 */
-(instancetype)init NS_UNAVAILABLE;
/**
 废弃方法
 */
-(instancetype)new NS_UNAVAILABLE;

/**
 * 暂停渲染
 * @return true: 调用成功 false: 调用失败
 */
-(BOOL)pauseRender;

/**
 * 在暂停渲染状态下 恢复渲染
 * @return true: 调用成功 false: 调用失败
 */
-(BOOL)resumeRender;

/**
 * 停止当前视频播放
 * @return true: 调用成功 false: 调用失败
 */
-(BOOL)stop;

/*** 播放音视频资源
 * @param pmediaModel 音视频资源
 * @param startPos 起播时间戳 毫秒
 */
-(BOOL)playMediaModel:(QMediaModel*)pmediaModel startPos:(int64_t)startPos NS_SWIFT_NAME(playMediaModel(pmediaModel:startPos:));

/**
 * 播放预加载资源
 * @param mediaItem 预加载实例
 */
-(BOOL)playMediaItem:(QMediaItemContext*)mediaItem NS_SWIFT_NAME(playMediaItem(mediaItem:));

/**
 获取当前是否支持后台播放
 @return true: 支持后台播放 false: 支持后台播放
*/
-(BOOL)getBackgroundPlayEnable;

/**
 设置播放速度
 @param speed 需要设置的倍速
 */
-(BOOL)setSpeed:(float)speed NS_SWIFT_NAME(setSpeed(speed:));

/**
 截图
 @param source true 视频原图  false 经过渲染的视频图
 */
-(BOOL)shootVideo NS_SWIFT_NAME(shootVideo());

/**
 设置上抛的视频数据类型
 @param video_type 
 */
-(BOOL)setVideoDataType:(QVideoType)video_type  NS_SWIFT_NAME(setVideoDataType(video_type:));

/**
 * 设置解码方式
 * @param type 解码方式
 */
-(BOOL)setDecoderType:(QPlayerDecoder)type NS_SWIFT_NAME(setDecoderType(type:));

/*** 设置起播方式
 * @param action 起播方式
 */
-(BOOL)setStartAction:(QPlayerStart)action NS_SWIFT_NAME(setStartAction(action:));

/**
 * 设置seek方式
 * @param mode seek方式
 */
-(BOOL)setSeekMode:(QPlayerSeek)mode NS_SWIFT_NAME(setSeekMode(mode:));

/**
 *设置是否后台播放
 * @param enable yes后台播放，no后台播放暂停
 */
-(void)setBackgroundPlayEnable:(BOOL)enable NS_SWIFT_NAME(setBackgroundPlayEnable(enable:));

/**
 * 切换视频当前进度
 * @param position 切换到哪个时间点 单位：毫秒
 */
-(BOOL)seek:(int64_t)position NS_SWIFT_NAME(seek(position:));

/**
 * 设置切换内置扬声器时是否继续播放
 * @param enable true 恢复播放 false 不恢复播放
 */
-(BOOL)shouldContinuePlayAfterSwitchInSpeaker:(BOOL) enable NS_SWIFT_NAME(shouldContinuePlayAfterSwitchInSpeaker(enable:));

/**
 * 设置静音状态
 * @param isMute true 静音播放 false 非静音播放。默认为非静音播放
 */
-(BOOL)setMute:(BOOL)isMute NS_SWIFT_NAME(setMute(isMute:));


/**
 * 设置日志等级
 * @param level 日志等级
 */
-(BOOL)setLogLevel:(QLogLevel)level NS_SWIFT_NAME(setLogLevel(logLevel:));



/**
  切换清晰度
  @param userType 切换清晰度的url流的userType
  @param urlType 切换清晰度的url流的 urlType
  @param quality 要切到哪路清晰度
  @param immediately true 立即切换 用于直播流，false 无缝切换，切换过程是一个异步过程，用于点播流
  @return true 调用成功， false 调用失败
*/
-(BOOL)switchQuality:(NSString *)userType urlType:(QPlayerURLType)urlType quality:(NSInteger)quality immediately:(BOOL)immediately NS_SWIFT_NAME(switchQuality(userType:urlType:quality:immediately:));
/**
 获取指定 userType urlType 流正在切换的清晰度（非immediately方式）
  @param userType 切换清晰度的url流的userType
  @param urlType 切换清晰度的url流的 urlType
  @return true 调用成功， false 调用失败
*/
-(int)getSwitchingQuality:(NSString *)userType urlType:(QPlayerURLType)urlType NS_SWIFT_NAME(getSwitchingQuality(userType:urlType:));
/**
 获取指定 userType urlType 的清晰度
  @param userType 切换清晰度的url流的userType
  @param urlType 切换清晰度的url流的 urlType
  @return true 调用成功， false 调用失败
*/
-(int)getCurrentQuality:(NSString *)userType urlType:(QPlayerURLType)urlType NS_SWIFT_NAME(getCurrentQuality(userType:urlType:));

/**
 * 下一次鉴权强制通过网络鉴权
 * @return true 调用成功， false 调用失败
 */
-(BOOL)forceAuthenticationFromNetwork;
/**
 * 设置sei回调是否开启
 * @param enable yes 开启,  no 关闭
 * @return true 调用成功， false 调用失败
 */
-(BOOL)setSEIEnable:(BOOL)enable NS_SWIFT_NAME(setSEIEnable(enable:));


/**
 * 设置字幕是否开启
 * @param enable yes 开启,  no 关闭
 * @return true 调用成功， false 调用失败
 */
-(BOOL)setSubtitleEnable:(BOOL)enable NS_SWIFT_NAME(setSubtitleEnable(enable:));

/**
 * 设置字幕
 * @param name 切换后的字幕名称
 * @return true 调用成功， false 调用失败
 */
-(BOOL)setSubtitle:(NSString *)name NS_SWIFT_NAME(setSubtitle(name:));

/**
 * 回复播放器所需的 AudioSessionCategory
 * @return true 调用成功， false 调用失败
 */
-(BOOL)resumeAudioSessionCategory NS_SWIFT_NAME(resumeAudioSessionCategory());

/**
 * 添加视频状态监听
 * @param listener 视频状态监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerStateListener:(id<QIPlayerStateChangeListener>)listener NS_SWIFT_NAME(addPlayerStateListener(listener:));
/**
 * 删除视频状态监听
 * @param listener 视频状态监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerStateListener:(id<QIPlayerStateChangeListener>)listener NS_SWIFT_NAME(removePlayerStateListener(listener:));
/**
 * 移除所有视频状态监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerStateListener;

/**
 * 添加视频解码类型监听
 * @param listener 视频解码类型监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerVideoDecodeTypeListener:(id<QIPlayerVideoDecodeListener>)listener NS_SWIFT_NAME(addPlayerVideoDecodeTypeListener(listener:));
/**
 * 删除视频解码类型监听
 * @param listener 视频解码类型监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayeVideoDecodeTypeListener:(id<QIPlayerVideoDecodeListener>)listener NS_SWIFT_NAME(removePlayeVideoDecodeTypeListener(listener:));
/**
 * 删除所有视频解码类型监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerVideoDecodeTypeListener;


/**
 * 添加播放器媒体资源网络情况监听
 * @param listener 播放器媒体资源网络情况监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerMediaNetworkListener:(id<QIPlayerMediaNetworkListener>)listener NS_SWIFT_NAME(addPlayerMediaNetworkListener(listener:));
/**
 * 删除播放器媒体资源网络情况监听
 * @param listener 播放器媒体资源网络情况监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerMediaNetworkListener:(id<QIPlayerMediaNetworkListener>)listener NS_SWIFT_NAME(removePlayerMediaNetworkListener(listener:));

/**
 * 删除所有播放器媒体资源网络情况监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerMediaNetworkListener;

/**
 * 添加播放器进度改变监听
 * @param listener 播放器进度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerProgressChangeListener:(id<QIPlayerProgressListener>)listener NS_SWIFT_NAME(addPlayerProgressChangeListener(listener:));

/**
 * 删除播放器进度改变监听
 * @param listener 播放器进度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerProgressChangeListener:(id<QIPlayerProgressListener>)listener NS_SWIFT_NAME(removePlayerProgressChangeListener(listener:));

/**
 * 删除所有播放器进度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerProgressChangeListener;

/**
 * 添加播放器Buffering状态改变监听
 * @param listener 播放器Buffering状态改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerBufferingChangeListener:(id<QIPlayerBufferingListener>)listener NS_SWIFT_NAME(addPlayerBufferingChangeListener(listener:));

/**
 * 删除播放器Buffering状态改变监听
 * @param listener 播放器Buffering状态改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerBufferingChangeListener:(id<QIPlayerBufferingListener>)listener NS_SWIFT_NAME(removePlayerBufferingChangeListener(listener:));

/**
 * 删除所有播放器Buffering状态改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerBufferingChangeListener;


/**
 * 添加播放器FPS改变监听
 * @param listener 播放器FPS改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerFPSChangeListener:(id<QIPlayerFPSListener>)listener NS_SWIFT_NAME(addPlayerFPSChangeListener(listener:));

/**
 * 删除播放器FPS改变监听
 * @param listener 播放器FPS改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerFPSChangeListener:(id<QIPlayerFPSListener>)listener NS_SWIFT_NAME(removePlayerFPSChangeListener(listener:));

/**
 * 删除所有播放器FPS改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerFPSChangeListener;

/**
 * 添加播放器码率改变监听
 * @param listener 播放器码率改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerBiteRateChangeListener:(id<QIPlayerBiteRateListener>)listener NS_SWIFT_NAME(addPlayerBiteRateChangeListener(listener:));

/**
 * 删除播放器码率改变监听
 * @param listener 播放器码率改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerBiteRateChangeListener:(id<QIPlayerBiteRateListener>)listener NS_SWIFT_NAME(removePlayerBiteRateChangeListener(listener:));

/**
 * 删除所有播放器码率改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerBiteRateChangeListener;

/**
 * 添加播放器下载速度改变监听
 * @param listener 播放器下载速度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerDownloadChangeListener:(id<QIPlayerDownloadListener>)listener NS_SWIFT_NAME(addPlayerDownloadChangeListener(listener:));

/**
 * 删除播放器下载速度改变监听
 * @param listener 播放器下载速度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerDownloadChangeListener:(id<QIPlayerDownloadListener>)listener NS_SWIFT_NAME(removePlayerDownloadChangeListener(listener:));

/**
 * 删除所有播放器下载速度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerDownloadChangeListener;

/**
 * 添加Command状态权限监听
 * @param listener Command状态权限监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerCommandNotAllowListener:(id<QIPlayerCommandNotAllowListener>)listener NS_SWIFT_NAME(addPlayerCommandNotAllowListener(listener:));

/**
 * 删除Command状态权限监听
 * @param listener Command状态权限监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerCommandNotAllowListener:(id<QIPlayerCommandNotAllowListener>)listener NS_SWIFT_NAME(removePlayerCommandNotAllowListener(listener:));

/**
 * 删除所有Command状态权限监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerCommandNotAllowListener;


/**
 * 添加播放器清晰度监听
 * @param listener 播放器清晰度监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerQualityListener:(id<QIPlayerQualityListener>)listener NS_SWIFT_NAME(addPlayerQualityListener(listener:));

/**
 * 删除播放器清晰度监听
 * @param listener 播放器清晰度监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerQualityListener:(id<QIPlayerQualityListener>)listener NS_SWIFT_NAME(removePlayerQualityListener(listener:));

/**
 * 删除所有播放器清晰度监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerQualityListener;

/**
 * 添加速度改变监听
 * @param listener 速度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerSpeedChangeListener:(id<QIPlayerSpeedListener>)listener NS_SWIFT_NAME(addPlayerSpeedChangeListener(listener:));

/**
 * 删除速度改变监听
 * @param listener 速度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayeSpeedChangeListener:(id<QIPlayerSpeedListener>)listener NS_SWIFT_NAME(removePlayeSpeedChangeListener(listener:));

/**
 * 删除所有速度改变监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerSpeedChangeListener;

/**
 * 添加播放器鉴权监听
 * @param listener 播放器鉴权监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerAuthenticationListener:(id<QIPlayerAuthenticationListener>)listener NS_SWIFT_NAME(addPlayerAuthenticationListener(listener:));

/**
 * 删除播放器鉴权监听
 * @param listener 播放器鉴权监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerAuthenticationListener:(id<QIPlayerAuthenticationListener>)listener NS_SWIFT_NAME(removePlayerAuthenticationListener(listener:));

/**
 * 删除所有播放器鉴权监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerAuthenticationListener;

/**
 * 添加播放器媒体资源format监听
 * @param listener 播放器媒体资源format监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerFormatListener:(id<QIPlayerFormatListener>)listener NS_SWIFT_NAME(addPlayerFormatListener(listener:));

/**
 * 删除播放器媒体资源format监听
 * @param listener 播放器媒体资源format监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerFormatListener:(id<QIPlayerFormatListener>)listener NS_SWIFT_NAME(removePlayerFormatListener(listener:));

/**
 * 删除所有播放器媒体资源format监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerFormatListener;

/**
 * 添加播放器SEI 数据监听
 * @param listener 播放器SEI 数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerSEIDataListener:(id<QIPlayerSEIDataListener>)listener NS_SWIFT_NAME(addPlayerSEIDataListener(listener:));

/**
 * 删除播放器SEI 数据监听
 * @param listener 播放器SEI 数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerSEIDataListener:(id<QIPlayerSEIDataListener>)listener NS_SWIFT_NAME(removePlayerSEIDataListener(listener:));

/**
 * 删除所有播放器SEI 数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerSEIDataListener;


/**
 * 添加播放器截图监听
 * @param listener 播放器截图监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerShootVideoListener:(id<QIPlayerShootVideoListener>)listener NS_SWIFT_NAME(addPlayerShootVideoListener(listener:));

/**
 * 删除播放器截图监听
 * @param listener 播放器截图监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerShootVideoListener:(id<QIPlayerShootVideoListener>)listener NS_SWIFT_NAME(removePlayerShootVideoListener(listener:));

/**
 * 删除所有播放器截图监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerShootVideoListener;

/**
 * 添加播放器静音播放监听
 * @param listener 播放器静音播放监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerAudioListener:(id<QIPlayerAudioListener>)listener NS_SWIFT_NAME(addPlayerAudioListener(listener:));

/**
 * 删除播放器静音播放监听
 * @param listener 播放器静音播放监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerAudioListener:(id<QIPlayerAudioListener>)listener NS_SWIFT_NAME(removePlayerAudioListener(listener:));

/**
 * 删除所有播放器静音播放监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerAudioListener;


/**
 * 添加推流端视频长宽变化监听
 * @param listener 推流端视频长宽变化监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerVideoFrameSizeChangeListener:(id<QIPlayerVideoFrameSizeChangeListener>)listener NS_SWIFT_NAME(addPlayerVideoFrameSizeChangeListener(listener:));

/**
 * 删除推流端视频长宽变化监听
 * @param listener 推流端视频长宽变化监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerVideoFrameSizeChangeListener:(id<QIPlayerVideoFrameSizeChangeListener>)listener NS_SWIFT_NAME(removePlayerVideoFrameSizeChangeListener(listener:));

/**
 * 删除所有推流端视频长宽变化监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerVideoFrameSizeChangeListener;

/**
 * 添加seek监听
 * @param listener seek 监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerSeekListener:(id<QIPlayerSeekListener>)listener NS_SWIFT_NAME(addPlayerSeekListener(listener:));

/**
 * 删除seek监听
 * @param listener seek监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerSeekListener:(id<QIPlayerSeekListener>)listener NS_SWIFT_NAME(removePlayerSeekListener(listener:));

/**
 * 删除所有seek监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerSeekListener;


/**
 * 添加字幕监听
 * @param listener 字幕 监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerSubtitleListener:(id<QIPlayerSubtitleListener>)listener NS_SWIFT_NAME(addSubtitleListener(listener:));

/**
 * 删除字幕监听
 * @param listener 字幕监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerSubtitleListener:(id<QIPlayerSubtitleListener>)listener NS_SWIFT_NAME(removeSubtitleListener(listener:));

/**
 * 删除所有字幕监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerSubtitleListener;

/**
 * 添加音频数据监听
 * @param listener 音频数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerAudioDataListener:(id<QIPlayerAudioDataListener>)listener NS_SWIFT_NAME(addPlayerAudioDataListener(listener:));

/**
 * 删除音频数据监听
 * @param listener 音频数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerAudioDataListener:(id<QIPlayerAudioDataListener>)listener NS_SWIFT_NAME(removePlayerAudioDataListener(listener:));

/**
 * 删除所有音频数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerAudioDataListener;

/**
 * 添加视频数据监听
 * @param listener 视频数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)addPlayerVideoDataListener:(id<QIPlayerVideoDataListener>)listener NS_SWIFT_NAME(addPlayerVideoDataListener(listener:));

/**
 * 删除视频数据监听
 * @param listener 视频数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removePlayerVideoDataListener:(id<QIPlayerVideoDataListener>)listener NS_SWIFT_NAME(removePlayerVideoDataListener(listener:));

/**
 * 删除所有视频数据监听
 * @return true 调用成功， false 调用失败
 */
-(BOOL)removeAllPlayerVideooDataListener;

/**
 * 释放播放器资源
 */
-(void)playerRelease;
@end


NS_ASSUME_NONNULL_END
