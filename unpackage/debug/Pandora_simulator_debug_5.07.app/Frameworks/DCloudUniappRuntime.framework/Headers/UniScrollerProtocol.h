//
//  UniScrollerProtocol.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/18.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@class DCUniComponent;

@protocol UniScrollerProtocol <NSObject>

/**
 * @abstract add sticky component
 */
- (void)addStickyComponent:(DCUniComponent *)sticky;

/**
 * @abstract remove sticky component
 */
- (void)removeStickyComponent:(DCUniComponent *)sticky;

/**
 * @abstract adjust sticky components
 */
- (void)adjustSticky;

/**
 * @abstract add scroll listener
 */
- (void)addScrollToListener:(DCUniComponent *)target;

/**
 * @abstract remove scroll listener
 */
- (void)removeScrollToListener:(DCUniComponent *)target;

- (void)scrollToComponent:(DCUniComponent *)component withOffset:(CGFloat)offset animated:(BOOL)animated;

- (BOOL)isNeedLoadMore;

- (void)loadMore;

- (CGPoint)contentOffset;

- (void)setContentOffset:(CGPoint)contentOffset;
- (void)setContentOffset:(CGPoint)contentOffset animated:(BOOL)animated;

- (CGSize)contentSize;

- (void)setContentSize:(CGSize)size;

- (UIEdgeInsets)contentInset;

- (void)setContentInset:(UIEdgeInsets)contentInset;

- (void)resetLoadmore;

- (void)addScrollDelegate:(id<UIScrollViewDelegate>)delegate;
- (void)removeScrollDelegate:(id<UIScrollViewDelegate>)delegate;

- (UniScrollDirection)scrollDirection;

@optional

- (NSString*)refreshType;
- (BOOL)requestGestureShouldStopPropagation:(UIGestureRecognizer *)gestureRecognizer shouldReceiveTouch:(UITouch *)touch;
/**
 * @abstract adjust for RTL
 */
- (void)adjustForRTL;

@end

NS_ASSUME_NONNULL_END
