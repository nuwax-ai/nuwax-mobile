
//
//  DCUniAdLoadingParam.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/25.
//

/// 聚合广告位ID，NSString
extern NSString *const DCUniAdLoadingParamMediationRitID;

/// ADN平台ID，平台生成的唯一ID，NSString
extern NSString *const DCUniAdLoadingParamMediaID;

/// ADN平台广告位ID，NSString
extern NSString *const DCUniAdLoadingParamSlotId;

#pragma mark - 开屏广告

/// 自定义底部视图，UIView
extern NSString *const DCUniAdLoadingParamSPCustomBottomView;

/// 自定义底部视图尺寸，NSValue/CGSize
extern NSString *const DCUniAdLoadingParamSPCustomBottomViewSize;

/// 开屏超时时间，NSNumber/NSInteger
extern NSString *const DCUniAdLoadingParamSPTolerateTimeout;

#pragma mark - 激励视频
/// 激励视频用户标识，NSString
extern NSString *const DCUniAdLoadingParamRVUserID;
/// 激励视频扩展信息，NSString，JSON格式
extern NSString *const DCUniAdLoadingParamRVExtra;

#pragma mark - 信息流广告

/// 加载广告数量，NSNumber
extern NSString *const DCUniAdLoadingParamNALoadAdCount;

/// 模版类型(仅海外广告支持)，NSNumber
extern NSString *const DCUniAdLoadingParamNATemplateType;

/// 是否加载模版广告，NSNumber 1 模版; 2 自渲染;
extern NSString *const DCUniAdLoadingParamExpressAdType;


#pragma mark - 插屏广告
/// 广告类型(全屏、插屏、优选)，NSNumber
extern NSString *const DCUniAdLoadingParamInterstitialType;

#pragma mark - 自定义补充

/// 自定义Adapter扩展参数， NSString，JSON格式
extern NSString *const DCUniAdLoadingParamCustomJson;


#pragma mark - 加载回调参数，即adapter开发者通过`- ***Ad:didLoadWithExt/Fail*** ext:`中NSDictionary回调的数据

/// 【可选】AND广告ECPM，NSNumber，单位分
extern NSString *const DCUniAdMediaAdLoadingExtECPM;

/// 【可选】AND广告唯一标识，NSString
extern NSString *const DCUniAdMediaAdLoadingExtAdID;
