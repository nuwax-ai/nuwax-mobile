//
//  UIViewController+UniExtend.h
//  libPDRCore
//
//  Created by XHY on 2019/12/27.
//  Copyright © 2019 DCloud. All rights reserved.
//
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface UIViewController (UniExtend)

// 获取当前显示的 UIViewController
+ (UIViewController *)dc_findCurrentShowingViewController;

@end


@interface UIApplication (UniExtend)
/// 获取状态栏样式
+ (UIStatusBarStyle)dc_getStatusBarStyle;
/// 获取 keyWindow
+ (UIWindow *)dc_getKeyWindow;
@end


@interface UIDevice (UniExtend)
+ (void)dc_setOrientation:(UIInterfaceOrientation)orientation;

@end

NS_ASSUME_NONNULL_END
