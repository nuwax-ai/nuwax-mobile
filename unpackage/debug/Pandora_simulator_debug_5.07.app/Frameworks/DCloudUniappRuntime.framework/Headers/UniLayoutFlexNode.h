//
//  FlexNode.h
//  UniCore
//
//  Created by X on 2023/2/15.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

FOUNDATION_EXPORT const NSString* UniLayoutBuildString;

typedef NS_ENUM(NSInteger, UniCSSBoxSizing){
    UniCSSBoxSizingBorderBox,
    UniCSSBoxSizingContentBox
};

typedef NS_ENUM(NSInteger, UniCSSFlexAlign){
    UniCSSFlexAlignAuto,
    UniCSSFlexAlignFlexStart,
    UniCSSFlexAlignCenter,
    UniCSSFlexAlignFlexEnd,
    UniCSSFlexAlignStretch,
    UniCSSFlexAlignBaseline,
    UniCSSFlexAlignSpaceBetween,
    UniCSSFlexAlignSpaceAround,
    UniCSSFlexAlignSpaceEvenly
};

typedef NS_ENUM(NSInteger, UniCSSFlexDirection){
    UniCSSFlexDirectionRow,
    UniCSSFlexDirectionRowReverse,
    UniCSSFlexDirectionColumn,
    UniCSSFlexDirectionColumnReverse,
    UniCSSFlexDirectionInvalid
};

typedef NS_ENUM(NSInteger, UniCSSDirection){
    UniCSSDirectionInherit,
    UniCSSDirectionLTR,
    UniCSSDirectionRTL
};

typedef NS_ENUM(NSInteger, UniCSSFlexJustify){
    UniCSSFlexJustifyFlexStart = UniCSSFlexAlignFlexStart,
    UniCSSFlexJustifyCenter = UniCSSFlexAlignCenter,
    UniCSSFlexJustifyFlexEnd = UniCSSFlexAlignFlexEnd,
    UniCSSFlexJustifySpaceBetween = UniCSSFlexAlignSpaceBetween,
    UniCSSFlexJustifySpaceAround = UniCSSFlexAlignSpaceAround,
    UniCSSFlexJustifySpaceEvenly = UniCSSFlexAlignSpaceEvenly,
} ;

typedef NS_ENUM(NSInteger,UniCSSFlexOverflow){
    UniCSSFlexOverflowVisible,
    UniCSSFlexOverflowHidden,
    UniCSSFlexOverflowScroll
} ;

typedef NS_ENUM(NSInteger,UniCSSPositionType){
    UniCSSPositionTypeRelative,
    UniCSSPositionTypeAbsolute,
    UniCSSPositionTypeFixed,
    UniCSSPositionTypeSticky
} ;

typedef NS_ENUM(NSInteger, UniCSSFlexWrap){
    UniCSSFlexWrapNoWrap,
    UniCSSFlexWrapWrap,
    UniCSSFlexWrapWrapReverse,
    UniCSSFlexWrapInvalid
} ;

typedef NS_ENUM(NSInteger, UniCssDisplayType){
    UniCssDisplayTypeFlex,
    UniCssDisplayTypeNone
} ;

typedef NS_ENUM(NSInteger, UniCssFlexEdge){
    UniCssFlexEdgeLeft,
    UniCssFlexEdgeTop,
    UniCssFlexEdgeRight,
    UniCssFlexEdgeBottom,
    UniCssFlexEdgeStart,
    UniCssFlexEdgeEnd,
    UniCssFlexEdgeHorizontal,
    UniCssFlexEdgeVertical,
    UniCssFlexEdgeAll,
    UniCssFlexEdgeNone = -1
};

typedef NS_ENUM(NSInteger, UniCSSBorderStyle){
    UniCSSBorderStyleNone,
    UniCSSBorderStyleBorder
} ;

typedef NS_ENUM(NSInteger, UniCSSNodeLevel){
    UniCSSNodeLevelDefalut = 0,
    UniCSSNodeLevelRoot
};

typedef NS_ENUM(NSInteger, UniLengthUnit) {
    UniLengthUnitUndefined,
    UniLengthUnitPXPoint,
    UniLengthUnitRPXPoint,
    UniLengthUnitPercent,
    UniLengthUnitAuto,
    UniLengthUnitFunction
};

@protocol UniLayoutFlexMeasureDelegate
-(CGSize)onSizeMeasureFuncWidth:(float) width mode:(int)widthMode height:(float)height mode:(int)heightMode;
@end

@interface UniLayoutFlexNode : NSObject
- (instancetype)initWithLevel:(UniCSSNodeLevel)level withRootNode:(nullable UniLayoutFlexNode*)rootNode;
- (void)setLevel:(UniCSSNodeLevel)level;
- (void)insertChild:(UniLayoutFlexNode*)child atIndex:(NSUInteger)index;
- (UniLayoutFlexNode*)removeChildNode:(UniLayoutFlexNode*)child atIndex:(NSUInteger)index;
- (UniLayoutFlexNode*)removeChildNode:(UniLayoutFlexNode*)child;
//- (NSUInteger)getChildCount;
//- (NSUInteger)dirtyChildCount;
//- (UniLayoutFlexNode*)getChildAt:(NSUInteger)index;
//- (UniLayoutFlexNode*)getParent;
//- (NSUInteger)indexOf:(UniLayoutFlexNode*)child;

//bool FlexNodeNode(JNIEnv* env, const base::android::JavaParamRef<jobject>& obj);
//void FlexNodeNodeSetHasMeasureFunc(JNIEnv* env,
//                                   const base::android::JavaParamRef<jobject>& obj,
//                                   jboolean hasMeasureFunc);
//void FlexNodeNodeSetHasBaselineFunc(JNIEnv* env,
//                                    const base::android::JavaParamRef<jobject>& obj,

- (void)setMeasureOCDelegate:(nullable id<UniLayoutFlexMeasureDelegate>)delegate;
- (void)uni_reset;
- (void)free;
- (void)calculateLayoutWithWidth:(float)width height:(float)height direction:(UniCSSDirection)direction;
- (void)dirty;
- (bool)isDirty;
- (bool)isDescendantDirty;
- (bool)hasNewLayout;
- (void)markLayoutSeen;
- (UniCSSDirection)getDirection;
- (void)setDirection:(UniCSSDirection)direction;
- (UniCSSBoxSizing)getBoxSizing;
- (void)setBoxSizing:(UniCSSBoxSizing)BoxSizing;
- (UniCSSFlexDirection)getFlexDirection;
- (void)setFlexDirection:(UniCSSFlexDirection)flexDirection;
- (UniCSSFlexJustify)getJustifyContent;
- (void)setJustifyContent:(UniCSSFlexJustify)JustifyContent;
- (UniCSSFlexAlign)getAlignItems;
- (void)setAlignItems:(UniCSSFlexAlign)AlignItems;
- (UniCSSFlexAlign)getAlignSelf;
- (void)setAlignSelf:(UniCSSFlexAlign)AlignSelf;
- (UniCSSFlexAlign)getAlignContent;
- (void)setAlignContent:(UniCSSFlexAlign)AlignContent;
- (UniCSSPositionType)getPositionType;
- (void)setPositionType:(UniCSSPositionType)PositionType;
- (UniCSSFlexWrap)getFlexWrap;
- (void)setFlexWrap:(UniCSSFlexWrap)FlexWrap;
- (UniCSSFlexOverflow)getOverflow;
- (void)setOverflow:(UniCSSFlexOverflow)Overflow;
- (void)setDisplay:(UniCssDisplayType)Display;
- (UniCssDisplayType)getDisplay;
- (float)getFlex;
- (void)setFlex:(float)Flex;

- (float)getFlexGrow;
- (void)setFlexGrow:(float)FlexGrow;

- (float)getFlexShrink;
- (void)setFlexShrink:(float)FlexShrink;

- (float)getFlexBasis;
- (void)setFlexBasis:(float)FlexBasis;
-(void)setFlexBasis:(float)FlexBasis unit:(UniLengthUnit)ut;
- (bool)isFlexBasisPercent;
//- (void)setFlexBasisPercent:(float)FlexBasisPercent;

- (float)getContentSizeWidth:(BOOL)round ;
- (float)getContentSizeHeight:(BOOL)round;

- (float)getContentSizeWidth;
- (float)getContentSizeHeight;

- (UniCssDisplayType)getLayoutDisplay;
- (float)getLayoutWidth;
- (float)getLayoutHeight;
- (float)getLayoutMargin:(UniCssFlexEdge)edge;
- (float)getLayoutBorder:(UniCssFlexEdge)edge;
- (float)getLayoutPadding:(UniCssFlexEdge)edge;
- (float)getLayoutLeft;
- (float)getLayoutTop;
- (float)getLayoutRight;
- (float)getLayoutBottom;
- (float)getStyleMargin:(UniCssFlexEdge)edge;
- (float)getStyleBorderWidth:(UniCssFlexEdge)edge;
- (UniCSSBorderStyle)getStyleBorderStyle:(UniCssFlexEdge)edge;
- (float)getStylePadding:(UniCssFlexEdge)edge;


- (void)setStyleHeight:(float)height unit:(UniLengthUnit)ut;
- (void)setStyleWidth:(float)width unit:(UniLengthUnit)ut;
- (void)setStyleMaxWidth:(float)width unit:(UniLengthUnit)ut;
- (void)setStyleMaxHeight:(float)height unit:(UniLengthUnit)ut;
- (void)setStyleMinWidth:(float)width unit:(UniLengthUnit)ut;
- (void)setStyleMinHeight:(float)width unit:(UniLengthUnit)ut;

- (void)setMarginEdge:(UniCssFlexEdge)edge value:(float)value unit:(UniLengthUnit)ut;
- (void)setPaddingEdge:(UniCssFlexEdge)edge value:(float)value unit:(UniLengthUnit)ut;
- (void)setBorderEdge:(UniCssFlexEdge)edge value:(float)value unit:(UniLengthUnit)ut;
- (void)setPositionEdge:(UniCssFlexEdge)edge value:(float)value unit:(UniLengthUnit)ut;
- (void)setBorderEdge:(UniCssFlexEdge)edge style:(UniCSSBorderStyle)value;

- (bool)setStyleHeightFunction:(const char*)height;
- (bool)setStyleWidthFunction:(const char*)width;
- (bool)setMarginEdge:(UniCssFlexEdge)edge funtionValue:(const char*)value;
- (bool)setPaddingEdge:(UniCssFlexEdge)edge funtionValue:(const char*)value;
- (bool)setBorderEdge:(UniCssFlexEdge)edge functionValue:(const char*)value;
- (bool)setPositionEdge:(UniCssFlexEdge)edge funtionValue:(const char*)value;

- (void)setBackgroundColor:(NSString*)color;
- (void)setDebugData:(NSString*)value forKey:(NSString*)key;

- (bool)setSafeAreaEnv:(float)top right:(float)right bottom:(float)bottom left:(float)left;
- (bool)setCssVariable:(int)variable value:(float)value;
/*padding布局[top, right, bottom, left]*/
- (void)setGridViewLayoutWihtPadding:(NSArray<NSNumber*>*)padding crossAxisCount:(int)crossAxisCount mainAxisGap:(float)mainAxisGap crossAxisGap:(float)crossAxisGap;
- (void)setGridItemLayout:(bool)isGridItem;
@end

NS_ASSUME_NONNULL_END

