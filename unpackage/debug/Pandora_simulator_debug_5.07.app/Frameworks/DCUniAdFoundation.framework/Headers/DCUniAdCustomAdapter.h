//
//  DCUniAdCustomAdapter.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/7/25.
//

#import <Foundation/Foundation.h>
#import "DCUniAdPaidValue.h"
@class DCUniAdMediaBidResult;

@protocol DCUniAdCustomAdapter <NSObject>

@optional

/// 实时价格回调，目前仅admob支持
@property(nonatomic, nullable, copy) DCUniAdPaidEventHandler paidEventHandler;

// 回调客户端竞价结果，比价成功时回传成功，比价失败、返回超时或价格低于竞价底价时回传失败
/// @param result bid结果对象
/// @warning 1.adn广告load失败不触发该回调，如需回传adn竞价结果，请在load失败处自行处理
///          2.信息流加载多条会触发多次，返回每条比价结果
- (void)didReceiveBidResult:(DCUniAdMediaBidResult *_Nullable)result;

/// 在适配器被释放前触发
- (void)destory;



@end

