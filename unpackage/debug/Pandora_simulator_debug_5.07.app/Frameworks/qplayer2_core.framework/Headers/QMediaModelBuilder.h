//
//  QMediaModelBuilder.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/11/3.
//

#import <Foundation/Foundation.h>
#import <qplayer2_core/QMediaModel.h>
#import <qplayer2_core/QIOSCommon.h>
NS_ASSUME_NONNULL_BEGIN

/**
 * 播放资源构造器
 */
@interface QMediaModelBuilder : NSObject
/***
 * 构造器初始化
 * @param islive 是否是直播
 */
-(instancetype)initWithIsLive:(bool)islive;

//-(instancetype)initWithIsLive:(bool)islive isReconstructTimeLine:(bool)isReconstructTimeLine;

-(instancetype)init NS_UNAVAILABLE;
/***
 * 添加视频资源
 * @param userType 预留字段可以填空
 * @param urlType 媒体的资源属性 只包含视频/只包含音频/同时有视频音频
 * @param url 资源地址
 * @param quality 清晰度
 * @param isSelected 是否起播时播放该流
 * @param backupUrl 备用地址
 * @param referer http/https 协议的地址 支持该属性
 * @param renderType 视频的渲染类型
 * @param mp4DrmKey ffmpeg 公有 mp4 aes-ctr 解密密钥
 */
-(void)addStreamElementWithUserType:(NSString *)userType urlType:(QPlayerURLType)urlType url:(NSString *)url quality:(int)quality isSelected:(BOOL)isSelected backupUrl:(NSString *)backupUrl referer:(NSString *)referer renderType:(QPlayerRenderType)renderType  mp4DrmKey:(NSString *)mp4DrmKey NS_SWIFT_NAME(addStreamElement(userType:urlType:url:quality:isSelected:backupUrl:referer:renderType:mp4DrmKey:));

/***
 * 添加视频资源
 * @param userType 预留字段可以填空
 * @param urlType 媒体的资源属性 只包含视频/只包含音频/同时有视频音频
 * @param url 资源地址
 * @param quality 清晰度
 * @param isSelected 是否起播时播放该流
 * @param backupUrl 备用地址
 * @param referer http/https 协议的地址 支持该属性
 * @param renderType 视频的渲染类型
 * @param mp4QNDrmKey 七牛私有mp4解密密钥
 */
-(void)addStreamElementWithUserType:(NSString *)userType urlType:(QPlayerURLType)urlType url:(NSString *)url quality:(int)quality isSelected:(BOOL)isSelected backupUrl:(NSString *)backupUrl referer:(NSString *)referer renderType:(QPlayerRenderType)renderType  mp4QNDrmComKey:(NSString *)mp4QNDrmComKey mp4QNDrmFileKey:(NSString *)mp4QNDrmFileKey NS_SWIFT_NAME(addStreamElement(userType:urlType:url:quality:isSelected:backupUrl:referer:renderType:mp4QNDrmComKey:mp4QNDrmFileKey:));

/***
 * 添加视频资源
 * @param userType 预留字段可以填空
 * @param urlType 媒体的资源属性 只包含视频/只包含音频/同时有视频音频
 * @param url 资源地址
 * @param quality 清晰度
 * @param isSelected 是否起播时播放该流
 * @param backupUrl 备用地址
 * @param referer http/https 协议的地址 支持该属性
 * @param renderType 视频的渲染类型
 */
-(void)addStreamElementWithUserType:(NSString *)userType urlType:(QPlayerURLType)urlType url:(NSString *)url quality:(int)quality isSelected:(BOOL)isSelected backupUrl:(NSString *)backupUrl referer:(NSString *)referer renderType:(QPlayerRenderType)renderType NS_SWIFT_NAME(addStreamElement(userType:urlType:url:quality:isSelected:backupUrl:referer:renderType:));

/***
 * 添加视频资源
 * @param userType 预留字段可以填空
 * @param urlType 媒体的资源属性 只包含视频/只包含音频/同时有视频音频
 * @param url 资源地址
 * @param quality 清晰度
 * @param isSelected 是否起播时播放该流
 * @param backupUrl 备用地址
 * @param referer http/https 协议的地址 支持该属性
 * @param renderType 视频的渲染类型
 * @param hlsDrmKey 七牛私有HLS解密密钥
 */
-(void)addStreamElementWithUserType:(NSString *)userType urlType:(QPlayerURLType)urlType url:(NSString *)url quality:(int)quality isSelected:(BOOL)isSelected backupUrl:(NSString *)backupUrl referer:(NSString *)referer renderType:(QPlayerRenderType)renderType hlsDrmKey:(NSString *)hlsDrmKey NS_SWIFT_NAME(addStreamElement(userType:urlType:url:quality:isSelected:backupUrl:referer:renderType:hlsDrmKey:));



/***
 * 添加视频资源数组
 * @param streamElements 视频资源数组
 */
-(void)addStreamElements:(NSArray <QStreamElement*> *)streamElements;

/**
 * 添加 subtitleElement
 * @param name srt字幕名称
 * @param url  srt文件地址
 * @param isDefault 是否默认加载此字幕
 */
-(void)addSubtitleElement:(NSString *)name url:(NSString *)url isDefault:(BOOL)isDefault;


/***
 * 添加字幕资源数组
 * @param subtitleElements 字幕资源数组
 */
-(void)addSubtitleElements:(NSArray <QSubtitleElement*> *)subtitleElements;

/**
 * 构建QMediaModel
 * @return 返回构建的QMediaModel
 */
-(QMediaModel *)build;
@end

NS_ASSUME_NONNULL_END
