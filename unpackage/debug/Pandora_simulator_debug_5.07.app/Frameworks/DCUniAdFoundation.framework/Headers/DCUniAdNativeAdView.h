//
//  DCUniAdNativeAdView.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2025/7/9.
//

#import <UIKit/UIKit.h>
#import "DCUniAdMediatedNativeAdViewCreator.h"
@class DCUniAdNativeAd;
NS_ASSUME_NONNULL_BEGIN

@interface DCUniAdNativeAdView : UIView

/// 广告点击弹出新页面所依赖的ViewController
@property (nonatomic, weak) UIViewController *viewController;

/// 媒体视图，即视频广告的视频图层，非视频广告不存在该视图
@property (nonatomic, strong, readonly, nullable) UIView *mediaView;

/// 广告标题，需要开发者根据广告物料自己指定展示内容
@property (nonatomic, strong, readonly, nullable) UILabel *titleLabel;

/// 广告描述，需要开发者根据广告物料自己指定展示内容
@property (nonatomic, strong, readonly, nullable) UILabel *descLabel;

/// 广告大图，需要开发者根据广告物料自己指定展示内容，系统会自动创建，但内容需开发者自行校验
@property (nonatomic, strong, readonly, nullable) UIImageView *imageView;

/// 广告详情/下载按钮，可能不存在，文案内容需要开发者根据广告物料自己获取
@property (nonatomic, strong, readonly, nullable) UIButton *callToActionBtn;

/// 广告关闭按钮，可能不存在，开发者需自行处理响应事件
@property (nonatomic, strong, nullable) UIButton *dislikeBtn;

/// 广告LOGO视图，可能不存在，需要开发者根据广告物料自己指定展示内容
@property (nonatomic, strong, nullable) UIView *adLogoView;

/// 广告图标，可能不存在，需要开发者根据广告物料自己指定展示内容
@property (nonatomic, strong, nullable) UIImageView *iconImageView;

/// 注册可点击区域，由UniAd透传数据，是否生效由adapter 和 adn 决定
/// @param views 可响应点击操作的视图
- (void)registerClickableViews:(nullable NSArray<UIView *> *)views;

/// 更新媒体视图大小
- (void)reSizeMediaView;


@end

NS_ASSUME_NONNULL_END
