//
//  DCUniAdMediatedNativeAdViewCreator.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2025/7/9.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
NS_ASSUME_NONNULL_BEGIN
/// 媒体Native非模板广告视图构造协议
/// adapter开发者可不配置数据内容，外部开发者在接入时需手动填充DCUniAdMediatedNativeAdData中数据
@protocol DCUniAdMediatedNativeAdViewCreator <NSObject>
/// 视频视图
@property (nonatomic, strong, nullable, readonly) UIView *mediaView;
/// 广告LOGO视图，可能不存在，需要开发者根据广告物料自己指定展示内容
@property (nonatomic, strong, nullable, readonly) UIView *adLogoView;
/// 广告图标，可能不存在，需要开发者根据广告物料自己指定展示内容
@property (nonatomic, strong, nullable) UIImageView *iconImageView;
/// 不喜欢广告按钮
@property (nonatomic, strong, nullable, readonly) UIButton *dislikeBtn;
/// 广告图片视图
@property (nonatomic, strong, nullable, readonly) UIImageView *imageView;

/// 广告标题视图
@property (nonatomic, strong, nullable, readonly) UILabel *titleLabel;

/// 广告描述信息视图
@property (nonatomic, strong, nullable, readonly) UILabel *descLabel;

/// 广告详情/下载按钮，可能不存在，文案内容需要开发者根据广告物料自己获取
@property (nonatomic, strong, readonly, nullable) UIButton *callToActionBtn;

/// 广告容器视图
@property (nonatomic, strong, nullable, readonly) UIView *containerView;

/// 更新媒体视图大小
- (void)reSizeMediaView;

/// 设置根视图 （不设置可能造成点击无反应）
- (void)setRootViewController:(UIViewController *)viewController;

@required
///// 在原生广告视图中注册可点击视图。
- (void)registerContainer:(UIView *)containerView
       withClickableViews:(NSArray<UIView *> *)clickableViews;


@end

NS_ASSUME_NONNULL_END
