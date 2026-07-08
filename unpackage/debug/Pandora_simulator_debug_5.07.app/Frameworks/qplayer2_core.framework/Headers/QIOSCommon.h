//
//  QIOSCommon.h
//  qplayer2-core
//
//  Created by 孙慕 on 2022/5/23.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
/**
 枚举和数据模型
 */


/**
播放器状态枚举
 */
typedef NS_ENUM(NSInteger, QPlayerState){
    QPLAYER_STATE_NONE = 0,                //初始状态
    QPLAYER_STATE_INIT = 1,                //播放器开始创建各种对象 没有对应的state 创建完对象就上报这个状态
    QPLAYER_STATE_PREPARE = 2,             //开始拉视频数据解码变换等，重新换地址后，都走这个状态
    QPLAYER_STATE_PLAYING = 4,             //播放中
    QPLAYER_STATE_PAUSED_RENDER = 6,       //用户暂停
    QPLAYER_STATE_COMPLETED = 7,           //播放完成
    QPLAYER_STATE_SEEKING = 8,             //SEEK
    QPLAYER_STATE_STOPPED = 9,             //停止当前播放的视频
    QPLAYER_STATE_ERROR = 10,              //播放出错（是否需要分 可恢复 和 不可恢复 ）
    QPLAYER_STATE_END = 11,                //播放器释放各种对象完成
    QPLAYER_STATE_MEDIA_ITEM_PREPARE = 12, //开始拉视频数据解码变换等，重新换地址后，都走这个状态 针对Media Item的play 方式
    QPLAYER_STATE_RELEASE = 13,            //播放器结束，且释放各类资源
};

/*
 视频URL类型
 */
typedef NS_ENUM(NSInteger, QPlayerURLType){
    QURL_TYPE_QAUDIO_AND_VIDEO = 0,        //音频和视频
    QURL_TYPE_QAUDIO,                      //仅音频
    QURL_TYPE_QVIDEO,                      //仅视频
    QURL_TYPE_NONE,                        //无
};

/**
 视频类型
 */
typedef NS_ENUM(NSInteger, QPlayerRenderType){
    QPLAYER_RENDER_TYPE_PLANE = 0,                          //普通视频
    QPLAYER_RENDER_TYPE_PANORAMA_EQUIRECT_ANGULAR = 1,      //ANGULAR类 VR视频
};

/**
 视频比例
 */
typedef NS_ENUM(NSInteger, QPlayerRenderRatio) {
    QPLAYER_RATIO_SETTING_AUTO = 1,         //自动
    QPLAYER_RATIO_SETTING_STRETCH,          //拉伸
    QPLAYER_RATIO_SETTING_FULL_SCREEN,      //铺满
    QPLAYER_RATIO_SETTING_16_9,             //16:9
    QPLAYER_RATIO_SETTING_4_3,              //4:3
};
/**
 * 播放器的解码方式
 */
typedef NS_ENUM(NSInteger, QPlayerDecoderType) {
    QPLAYER_DECODER_TYPE_NONE = 0,          //无
    QPLAYER_DECODER_TYPE_SOFTWARE = 1,          //软解
    QPLAYER_DECODER_TYPE_HARDWARE = 21,          //硬解
};
/**
 * 优先选择哪种解码方式
 */
typedef NS_ENUM(NSInteger, QPlayerDecoder) {
    QPLAYER_DECODER_SETTING_AUTO = 0,            //自动选择
    QPLAYER_DECODER_SETTING_HARDWARE_PRIORITY,   //硬解优先
    QPLAYER_DECODER_SETTING_SOFT_PRIORITY,       //软解优先
};

/**
 seek方式
 */
typedef NS_ENUM(NSInteger, QPlayerSeek) {
    QPLAYER_SEEK_SETTING_NORMAL = 0,        //关键帧seek，每次seek 都seek到离目标位置向前的最近的一个关键帧，耗时少
    QPLAYER_SEEK_SETTING_ACCURATE,          //精准seek，耗时比关键帧seek多，且耗时和视频的gop间隔的大小成正比
};

/**
 起播方式
 */
typedef NS_ENUM(NSInteger, QPlayerStart){
    QPLAYER_START_SETTING_PLAYING = 0,      //起播播放
    QPLAYER_START_SETTING_PAUSE,            //起播暂停在首帧
};

/**
 色盲模式
 */
typedef NS_ENUM(NSInteger, QPlayerBlind) {
    QPLAYER_BLIND_SETTING_NONE=0,           //无
    QPLAYER_BLIND_SETTING_RED,              //红色盲
    QPLAYER_BLIND_SETTING_GREEN,            //绿色盲
    QPLAYER_BLIND_SETTING_BLUE,             //蓝色盲
};

/**
 日志等级
 */
typedef NS_ENUM(NSInteger, QLogLevel){
    LOG_QUIT = 0,
    LOG_ERROR = 1,
    LOG_WARNING = 2,
    LOG_DEBUG = 3,
    LOG_INFO = 4,
    LOG_VERBOSE = 5
};
typedef NS_ENUM(NSInteger, QPlayerMirror){
    //无
    QPLAYER_MIRROR_NONE = 0,
    //横向镜像
    QPLAYER_MIRROR_X = 1,
    //垂直镜像
    QPLAYER_MIRROR_Y = 2,
    //横向和垂直都镜像
    QPLAYER_MIRROR_X_Y = 3
};
/**
 预加载Item的状态
 */
typedef NS_ENUM(NSInteger, QMediaItemState) {
    QMEDIAITEM_STATE_NONE = 100,            //初始状态
    QMEDIAITEM_STATE_PREPARE,
    QMEDIAITEM_STATE_LOADING,
    QMEDIAITEM_STATE_PAUSED,
    QMEDIAITEM_STATE_STOPED,
    QMEDIAITEM_STATE_ERROR,
    QMEDIAITEM_STATE_PREPARE_USE,
    QMEDIAITEM_STATE_USED,
    QMEDIAITEM_STATE_DISCARD,
};

/**
 预加载Item的事件通知ID
 */
typedef NS_ENUM(NSInteger, QMediaItemNotify) {
    /************** moudle input stream *******************/
    QMEDIAITEMNOTIFY_INPUT_STREAM_OPEN = 40002,
    QMEDIAITEMINPUT_STREAM_IO_ERROR = 40005,
    QMEDIAITEMINPUT_STREAM_OPEN_ERROR = 40006,
    /************** event loop *******************/
    QMEDIAITEMNOTIFY_EVENT_LOOP_COMMOND_NOT_ALLOW = 90000,
};

/**
 错误类型
 */
typedef NS_ENUM(NSInteger, QPlayerOpenError) {
    QPLAYER_OPEN_ERROR_UNKOWN = 10000,
    QPLAYER_OPEN_ERROR_NONE = 0,
    QPLAYER_OPEN_ERROR_IOERROR = -5,
    QPLAYER_OPEN_ERROR_INTERRUPT = -1414092869,
    QPLAYER_OPEN_ERROR_URL_INVALID = -875574520,
    QPLAYER_OPEN_ERROR_FORMAT_INVALID = -1094995529
};

/**
 鉴权不通过错误码
 */
typedef NS_ENUM(NSInteger, QPlayerAuthenticationErrorType) {
    QPLAYER_AUTHENTICATION_ERROR_TYPE_AET_NONE,             //鉴权出错
    QPLAYER_AUTHENTICATION_ERROR_TYPE_AET_NO_BASE_AUTH,     //缺少基础功能权限
    QPLAYER_AUTHENTICATION_ERROR_TYPE_AET_NO_VR_AUTH,       //缺少VR功能权限
    QPLAYER_AUTHENTICATION_ERROR_TYPE_AET_NO_BLIND_AUTH,    //缺少色盲功能权限
    QPLAYER_AUTHENTICATION_ERROR_TYPE_AET_NO_SEI_AUTH,      //缺少SEI功能权限
    QPLAYER_AUTHENTICATION_ERROR_TYPE_AET_NO_SRT_AUTH,      //缺少SRT功能权限
    QPLAYER_AUTHENTICATION_ERROR_TYPE_AET_NO_APM_AUTH       //缺少APM功能权限
};












NS_ASSUME_NONNULL_END
