// Copyright Nuwax. All rights reserved.
//
// NotificationClearBridge.swift
// nuwax-notification-clear (iOS 混编 Swift 文件)
//
// uni-app x 的 uni-push 模块没有「清除通知」API（旧版 uni-app 的
// uni.removePushMessage 不存在），这里用系统 UserNotifications 框架补齐：
// removeAllDeliveredNotifications() 清掉通知中心（下拉顶部 / 锁屏）里本 App
// 已投递的全部通知。只作用于本 App 自己的通知，系统按 bundle 隔离。
//
// 混编约定（同 nuwax-ios-file-picker / nuwax-esp-provisioning）：本文件 public 类
// 对同目录 index.uts 直接可见，无需 import。

import UserNotifications

public class NotificationClearBridge {
  /// 清空通知中心里本 App 已投递（delivered）的通知。
  /// 不清理 pending（本仓没有定时本地通知的用法）；也不动图标角标 ——
  /// 角标口径是 IM 未读总数（utils/appIconBadge.uts），与通知条数无关。
  public static func clearAll() {
    UNUserNotificationCenter.current().removeAllDeliveredNotifications()
  }
}
