//
//  DCUniComponent.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/12.
//

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <DCloudUniappRuntime/UniTypeDef.h>
#import <DCloudUniappRuntime/UniRoundedRect.h>

typedef enum : NSUInteger {
    UniDisplayTypeNone,
    UniDisplayTypeBlock
} UniDisplayType;


NS_ASSUME_NONNULL_BEGIN

@interface DCUniComponent : NSObject

///--------------------------------------------
#pragma mark - Component Hierarchy Management
///--------------------------------------------

- (instancetype)initWithRef:(NSString *)ref type:(NSString *)type styles:(NSDictionary *)styles attributes:(NSDictionary *)attributes events:(NSArray *)events;

/// root container
@property(nonatomic, weak, readonly) UIView *rootView;

/**
 *  @abstract The component's identifier string.
 */
@property (nonatomic, readonly, strong) NSString *ref;

/**
 *  @abstract The component's type string.
 */
@property (nonatomic, readonly, copy) NSString *type;

@property (nonatomic, assign) UniComponentType componentType;

/// 标示当前是否已经绘制过 border
@property (nonatomic, assign) BOOL hasDrawBorder;

@property (nonatomic, readonly, strong) NSDictionary<NSString *,id> *styles;

@property (nonatomic, readonly, strong) NSDictionary *pseudoClassStyles;

@property (nonatomic, readonly, strong) NSDictionary<NSString *,id> *attributes;

@property (nonatomic, readonly, strong) NSArray *events;

@property (nonatomic, readonly, strong, nonnull) NSArray<DCUniComponent *> *subcomponents;

@property (nonatomic, readonly, weak, nullable) DCUniComponent *supercomponent;

///--------------------------------------------
#pragma mark - Layout
///--------------------------------------------

@property(nonatomic, readonly, assign) CGFloat pixelScaleFactor;

@property(nonatomic, readonly, assign) CGFloat viewportWidth;

@property(nonatomic, assign) CGRect calculatedFrame;

@property(nonatomic, assign) BOOL isViewFrameSyncWithCalculated;

- (void)setNeedsLayout;

- (BOOL)needsLayout;

- (nullable CGSize (^)(CGSize constrainedSize))measureBlock;

- (void)layoutDidFinish;

- (void)updateLayoutStyles:(NSDictionary*)styles;


///--------------------------------------------
#pragma mark - View Management
///--------------------------------------------

@property(nonatomic, readonly, strong) UIView *view;

@property(nonatomic, readonly, strong) CALayer *layer;

- (void)_bindView:(UIView *)view;

- (void)_startLoadView;

- (void)_checkViewDisplay;

- (void)_clearView;

- (void)_loadViewAfter:(BOOL)buildViewHierarchyLazily;

- (UIView *)loadView;

- (BOOL)isViewLoaded;

- (void)viewWillLoad;

- (void)viewDidLoad;

- (void)viewWillUnload;

- (void)viewDidUnload;

- (void)insertSubview:(DCUniComponent *)subcomponent atIndex:(NSInteger)index;

- (void)remove;

- (void)willRemoveSubview:(DCUniComponent *)component;

- (void)removeFromSuperview;

- (void)moveToSuperview:(DCUniComponent *)newSupercomponent atIndex:(NSUInteger)index;


///--------------------------------------------
#pragma mark - Events
///--------------------------------------------

- (void)hoverTouchEnd;

/**
 * @abstract Called when adding an event to the component
 *
 * @param eventName The added event's name
 * @discussion It can be overrided to handle specific event adding. The method is called on the main thread.
 **/
- (void)addEvent:(NSString *)eventName;

/**
 * @abstract Called when removing an event from the component
 *
 * @param eventName The removed event's name
 * @discussion It can be overrided to handle specific event removing. The method is called on the main thread.
 **/
- (void)removeEvent:(NSString *)eventName;

/**
 * @abstract Fire an event to the component in Javascript.
 *
 * @param eventName The name of the event to fire
 * @param params The parameters to fire with
 **/
- (void)fireEvent:(NSString *)eventName params:(nullable NSDictionary<NSString *,id> *)params;

- (BOOL)invalidateDefaultTapGesture;
- (BOOL)invalidateDefaultLongpressGesture;
- (BOOL)invalidateDefaultTouchGesture;

///--------------------------------------------
#pragma mark - Updating
///--------------------------------------------

/**
 * @abstract Called when component's style are updated
 *
 * @param styles The updated style dictionary
 * @discussion It can be overrided to handle specific style updating. The method is called on the main thread.
 **/
- (void)updateStyles:(NSDictionary<NSString *,id> *)styles;

- (void)updateHoverClassStyles:(NSDictionary<NSString *,id> *)styles;

/**
 * @abstract Called when component's attributes are updated
 *
 * @param attributes The updated attributes dictionary
 * @discussion It can be overrided to handle specific attribute updating. The method is called on the main thread.
 **/
- (void)updateAttributes:(NSDictionary<NSString*, id> *)attributes;

- (id __nullable)getAttr:(NSString *)attribute;

///--------------------------------------------
#pragma mark - Display
///--------------------------------------------

@property (nonatomic, assign) UniDisplayType displayType;

@property (atomic, assign) BOOL isCompositingChild;

/**
 * @abstract Marks the view as needing display. The method should be called on the main thread.
 * @discussion You can use this method to notify the system that your component's contents need to be redrawn. This method makes a note of the request and returns immediately. The component is not actually redrawn until the next drawing cycle, at which point all invalidated components are updated.
 *
 */
- (void)setNeedsDisplay;

- (BOOL)needsDrawRect;

- (void)didFinishDrawingLayer:(BOOL)success;

- (UIImage * __nullable)drawRect:(CGRect)rect;

typedef UIImage * _Nonnull(^UniDisplayBlock)(CGRect bounds, BOOL(^isCancelled)(void));
typedef void(^UniDisplayCompletionBlock)(CALayer *layer, BOOL finished);

@end


@interface UIView (UniComponent)

@property (nonatomic, weak) DCUniComponent *uni_component;

@property (nonatomic, weak) NSString *uni_ref;

@property (nonatomic, assign) BOOL uni_needUpdateZindex;

@end

@interface CALayer (UniComponent)

@property (nonatomic, weak) DCUniComponent *uni_component;

@end


NS_ASSUME_NONNULL_END
