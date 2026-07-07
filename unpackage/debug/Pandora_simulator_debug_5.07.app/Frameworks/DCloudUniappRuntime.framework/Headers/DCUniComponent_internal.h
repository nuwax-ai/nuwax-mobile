//
//  DCUniComponent_internal.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/13.
//

#import <DCloudUniappRuntime/DCUniComponent.h>
#import <DCloudUniappRuntime/UniTypeDef.h>
#import <DCloudUniappRuntime/UniBoxShadow.h>
#import <DCloudUniappRuntime/UniConvert.h>
#import <DCloudUniappRuntime/UniTransition.h>
#import <DCloudUniappRuntime/UniScrollerProtocol.h>
#import <DCloudUniappRuntime/UniTransform.h>
#import <DCloudUniappRuntime/UniThreadSafeCounter.h>
#import <DCloudUniappRuntime/UniRoundedRect.h>

NS_ASSUME_NONNULL_BEGIN

@class UniTouchGestureRecognizer;
@class DCTapStateGestureRecognizer;

@interface DCUniComponent ()
{
@package

    NSString *_type;
    NSMutableArray *_subcomponents;
    
    /**
     *  View
     */
    UIColor *_backgroundColor;
    NSString *_backgroundImage;
    NSString *_clipRadius;
    UniClipType _clipToBounds;
    UIView *_view;
    CGFloat _opacity;
    UniVisibility  _visibility;
    UniBoxShadow *_originalBoxShadow;
    UniBoxShadow *_lastBoxShadow;
    UniBoxShadow *_boxShadow;
    CGFloat _zIndex;
    
    
    /**
     * accessibility support
     */
    NSString * _roles; //accessibility
    NSString * _ariaLabel; //accessibilityLabel
    NSString * _ariaHidden; // accessibilityElementsHidden
    NSString * _accessible; // accessible
    NSString * _accessibilityHintContent; // hint for the action
    NSString * _groupAccessibilityChildren; // voice-over navigation order
    NSString * _testId;// just for auto-test
    
    BOOL _userInteractionEnabled;
    BOOL _eventPenetrationEnabled;
    BOOL _accessibilityMagicTapEvent;
    
    /**
     *  PseudoClass
     */
    NSMutableDictionary *_pseudoClassStyles;
    NSMutableDictionary *_updatedPseudoClassStyles;
    BOOL _isListenPseudoTouch;
    
    /**
     *  Events
     */
    UITapGestureRecognizer *_tapGesture;
    UILongPressGestureRecognizer *_longPressGesture;
    
    BOOL _customEvent;
    NSString *_stopPropagationName;
    UniTouchGestureRecognizer* _touchGesture;
    DCTapStateGestureRecognizer* _dc_tapStateGesture;
    BOOL _dc_isListenTapState;
    BOOL _dc_listenTapStateStopPropagation;
    
    /**
     *  Display
     */
    CALayer *_layer;
    BOOL _useCompositing;
    
    UniThreadSafeCounter *_displayCounter;
    
    UIColor *_borderTopColor;
    UIColor *_borderRightColor;
    UIColor *_borderLeftColor;
    UIColor *_borderBottomColor;
    
    CGFloat _borderTopWidth;
    CGFloat _borderRightWidth;
    CGFloat _borderLeftWidth;
    CGFloat _borderBottomWidth;
    
    CGFloat _borderTopLeftRadius;
    CGFloat _borderTopRightRadius;
    CGFloat _borderBottomLeftRadius;
    CGFloat _borderBottomRightRadius;

    BOOL _borderTopLeftRadiusIsPercent;
    BOOL _borderTopRightRadiusIsPercent;
    BOOL _borderBottomLeftRadiusIsPercent;
    BOOL _borderBottomRightRadiusIsPercent;

    UniBorderStyle _borderTopStyle;
    UniBorderStyle _borderRightStyle;
    UniBorderStyle _borderBottomStyle;
    UniBorderStyle _borderLeftStyle;
    
    NSInteger _lastBorderRecords; // Records last border drawing
    
    BOOL _isViewTreeIgnored; // Component is added to super, but it is not added to views.
    BOOL _isFixed;
    BOOL _async;
    
    UniTransform *_transform;
    
    
    NSMutableDictionary<NSString *, NSArray *> *_eventParameters;
}

/* _transform may be modified in mutiple threads. DO NOT use "_transform = XXX" directly.
 Ivar access in ObjC is compiled to code with additional release or retain. So use Ivar in mutiple
 thread may lead to crash. Use an ATOMIC property is well enough. */
@property (atomic, strong) UniTransform * _Nullable transform;

/**
 DO NOT use "_backgroundColor" directly. The same reason as '_transform'.
 */
@property (atomic, strong) UIColor * _Nullable backgroundColor;
@property (atomic, strong) UIColor * _Nullable borderTopColor;
@property (atomic, strong) UIColor * _Nullable borderLeftColor;
@property (atomic, strong) UIColor * _Nullable borderRightColor;
@property (atomic, strong) UIColor * _Nullable borderBottomColor;

@property (atomic, assign) BOOL lazyCreateView;

@property (atomic, assign) BOOL isRemoved;
@property (atomic, assign) CGFloat opacity;

@property(nonatomic, assign) BOOL isRefresher;

@property(nonatomic, copy, nullable) void (^layoutDidFinishBlock)(void);

@property(nonatomic, assign) CGSize contentMainSize;

@property(nonatomic, assign) BOOL isInitEvents;

/**
 * Transition
 */
//@property (nonatomic, strong, nullable) UniTransition *transition;

///--------------------------------------
#pragma mark - Package Internal Methods
///--------------------------------------

- (void)_layoutDidFinish;

- (void)_willDisplayLayer:(CALayer *_Nullable)layer;

- (id<UniScrollerProtocol>_Nullable)ancestorScroller;

- (BOOL)_insertSubcomponent:(DCUniComponent *_Nullable)subcomponent atIndex:(NSInteger)index;
- (void)_removeFromSupercomponent;
- (void)_removeSubcomponent:(DCUniComponent *)subcomponent;
- (void)_updateAttributes:(NSDictionary<NSString *,id> *_Nonnull)attributes;

- (void)_updateStylesOnComponentThread:(NSDictionary<NSString*,id> *)styles resetStyles:(NSMutableArray *)resetStyles isUpdateStyles:(BOOL)isUpdateStyles;
- (void)_updateStylesOnMainThread:(NSDictionary *)styles resetStyles:(NSMutableArray *)resetStyles;
- (void)_updateStyles:(NSDictionary<NSString *,id> *_Nonnull)styles isUpdateStyles:(BOOL)isUpdate;
- (void)_updatePseudoClassStyles:(NSDictionary<NSString*, id> *)styles isRecovery:(BOOL)isRecovery;
- (void)_updateTransform:(NSDictionary *)styles;

- (void)_handleStyles:(NSDictionary *)styles isUpdateStyles:(BOOL)isUpdateStyles;

- (void)addPseudoTouchEvent;
- (void)removePseudoTouchEvent;

- (void)onClickEvent:(NSDictionary *_Nonnull)data;
- (void)onTouchEvent:(NSString *_Nonnull)name data:(NSDictionary<NSString*, id> *_Nonnull)data gestureRecognizer:(UniTouchGestureRecognizer * _Nullable)gestureRecognizer;

- (void)_performBlockOnComponentThread:(void(^)(void))block NS_SWIFT_NAME(_performBlockOnComponentThread(_:)); 
- (void)_addUITask:(void (^)(void))block;

///--------------------------------------
#pragma mark - Protected Methods
///--------------------------------------

- (BOOL)_needsDrawBorder;

- (void)_drawBorderWithContext:(CGContextRef _Nullable )context size:(CGSize)size;

- (float)_getBorderDefaultHeight;

- (UIEdgeInsets)getBorderInsets;

- (void)_frameDidCalculated:(BOOL)isChanged;

- (UniRoundedRect * _Nonnull)getBorderRectInRect:(CGRect)rect;

- (CGFloat)getBorderTopLeftRadius;

- (CGFloat)getBorderTopRightRadius;

- (CGFloat)getBorderBottomLeftRadius;

- (CGFloat)getBorderBottomRightRadius;

@property(nonatomic, assign) BOOL needOnDraw;

- (void)_drawContentWithContext:(CGContextRef _Nullable)context;

///--------------------------------------
#pragma mark - Private Methods
///--------------------------------------

- (BOOL)_isSizeChanged:(CGSize)size;

- (BOOL)_isCalculatedFrameChanged:(CGRect)frame;

- (CGSize)_getInnerContentMainSize;

- (void)_assignCalculatedFrame:(CGRect)frame;

- (void)_assignInnerContentMainSize:(CGSize)value;

- (void)_initViewPropertyWithStyles:(NSDictionary * _Nonnull)styles;

- (void)_initCompositingAttribute:(NSDictionary * _Nonnull)attributes;

- (void)_transitionUpdateViewProperty:(NSDictionary * _Nonnull)styles;

- (NSDictionary *)_convertEmptyValueToDefault:(NSDictionary *)styles;

- (void)_updateViewStyles:(NSDictionary * _Nonnull)styles;

- (void)_resetStyles:(NSArray * _Nonnull)styles;

- (void)_handleBorders:(NSDictionary * _Nonnull)styles isUpdating:(BOOL)updating;

- (void)_resetNativeBorderRadius;

- (void)setGradientLayer;

- (void)_initEvents;

- (void)_initPseudoEvents:(BOOL)isListenPseudoTouch;

- (void)_adjustForRTL;

- (void)_removeAllEvents;

- (void)_setIsLayoutRTL:(BOOL)isRTL;

- (void)onClick:(UITapGestureRecognizer *)recognizer;

@end

NS_ASSUME_NONNULL_END
