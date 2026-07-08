//
//  UniView.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/19.
//

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface UIView(DCEvent)
@property(nonatomic,strong)NSNumber *dc_InterceptionEvent;
@property (nonatomic, assign) BOOL dc_AnimationEvent;

@end

@interface UniView : UIView
@end

NS_ASSUME_NONNULL_END
