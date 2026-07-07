//
//  QMediaModel.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/11/3.
//

#import <Foundation/Foundation.h>
#import <qplayer2_core/QIOSCommon.h>
NS_ASSUME_NONNULL_BEGIN
/**
 * 添加 steramElement
*/
@interface QStreamElement : NSObject
/**
 @brief userType 用户自定义Type
 */
@property (strong, nonatomic) NSString *userType;
/**
 @brief urlType 媒体的资源属性 只包含视频/只包含音频/同时有视频音频
 */
@property (assign, nonatomic) QPlayerURLType urlType;
/**
 @brief url 视频地址
 */
@property (strong, nonatomic) NSString *url;
/**
 @brief quality 清晰度
 */
@property (assign, nonatomic) int quality;
/**
 @brief isSelected 是否起播时播放该流
 */
@property (assign, nonatomic) BOOL isSelected;
/**
 @brief backupUrl 备用地址
 */
@property (copy, nonatomic) NSString *backupUrl;
/**
 @brief referer http/https 协议的地址 支持该属性
 */
@property (copy, nonatomic) NSString *referer;
/**
 @brief renderType 视频的渲染类型
 */
@property (assign, nonatomic) QPlayerRenderType renderType;
/**
 @brief 七牛私有HLS解密密钥
 */
@property (copy, nonatomic) NSString *hlsDrmKey;


/**
 @brief ffmpeg aes-ctr 解密密钥
 */
@property (copy, nonatomic) NSString *mp4DrmKey;

/**
 @brief 七牛私有mp4 com 解密密钥
 */
@property (copy, nonatomic) NSString *mp4QNDrmComKey;

/**
 @brief 七牛私有mp4 file 解密密钥
 */
@property (copy, nonatomic) NSString *mp4QNDrmFileKey;
@end

@interface QSubtitleElement : NSObject

/**
 @brief 自定义字幕名称
 */
@property (copy, nonatomic) NSString *name;
/**
 @brief 字幕地址
 */
@property (copy, nonatomic) NSString *url;
/**
 @brief 是否起播加载该URL字幕
 */
@property (assign, nonatomic) BOOL isSelected;

@end

/**
 * 播放资源
 */
@interface QMediaModel : NSObject
/**
 @brief streamElements 媒体资源包含的流
 */
@property (strong, nonatomic,readonly) NSArray <QStreamElement*> *streamElements;
/**
 @brief QSubtitleElements 字幕资源包含的流
 */
@property (strong, nonatomic,readonly) NSArray <QSubtitleElement*> *subtitleElements;
/**
 @brief isLive true 直播 false 点播
 */
@property (assign, nonatomic,readonly) BOOL isLive;

-(instancetype)init NS_UNAVAILABLE;


@end

NS_ASSUME_NONNULL_END
