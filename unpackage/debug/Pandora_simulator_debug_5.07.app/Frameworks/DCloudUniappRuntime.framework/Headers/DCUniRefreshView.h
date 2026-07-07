//
//  DCUniRefreshView.h
//  DCloudUniappRuntime
//
//  Created by DCloud-iOS-XHY on 2023/10/10.
//

#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

typedef void(^DCRefreshingBlock)(void);
typedef void(^DCRefreshrestoreBlock)(void);
typedef void(^DCRefresherpullingBlock)(void);
typedef void(^DCRefresherabortBlock)(void);

typedef NS_ENUM(NSUInteger, DCUniRefreshState) {
    DCUniRefreshStateNormal,
    DCUniRefreshStatePulling,
    DCUniRefreshStateLoading,
    DCUniRefreshStateRefreshing
};

typedef NS_ENUM(NSUInteger, DCUniRefreshStyle) {
    DCUniRefreshStyleWhite,
    DCUniRefreshStyleBlack,
    DCUniRefreshStyleNone   // 隐藏UI但保留功能
};

@protocol DCUniRefreshViewDelegate;


@interface DCUniRefreshView : UIView 
@property(nonatomic, weak) id <DCUniRefreshViewDelegate> delegate;
@property(nonatomic, assign) CGFloat refreshDist;
@property(nonatomic, assign) DCUniRefreshStyle refreshStyle;
@property(nonatomic, strong) UIColor *bgColor;
@property(nonatomic, assign) CGFloat refresherMaxDragDistance;
@property(nonatomic, copy) DCRefresherpullingBlock refresherpullingBlock;
@property(nonatomic, copy) DCRefreshingBlock refreshingBlock;
@property(nonatomic, copy) DCRefreshrestoreBlock refreshrestoreBlock;
@property(nonatomic, copy) DCRefresherabortBlock refresherabortBlock;


+ (instancetype)defaultRefreshView;
- (instancetype)initWithCustomView:(UIView *)view;
- (void)applyToScrollView:(UIScrollView *)scrollView;
- (void)applyToScrollView:(UIScrollView *)scrollView onRefreshing:(DCRefreshingBlock __nullable)refreshingBlock;
- (void)remove:(UIScrollView * __nullable)scrollView;
- (void)refreshScrollViewDidScroll:(UIScrollView *)scrollView;
- (void)refreshScrollViewBeginDragging:(UIScrollView *)scrollView;
- (void)refreshScrollViewDidEndDragging:(UIScrollView *)scrollView;
- (void)beginRefreshing:(UIScrollView*)scrollView;
- (void)endRefreshing:(UIScrollView *)scrollView;
@end

@protocol DCUniRefreshViewDelegate <NSObject>
- (void)refreshViewDidTriggerRefresh:(DCUniRefreshView*)view;
@end

NS_ASSUME_NONNULL_END
