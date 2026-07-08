//
//  UniTransition.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/17.
//

#import <Foundation/Foundation.h>
#import <DCloudUniappRuntime/DCUniComponent.h>

#define kUniTransitionDuration                   @"transitionDuration"
#define kUniTransitionProperty                   @"transitionProperty"
#define kUniTransitionDelay                      @"transitionDelay"
#define kUniTransitionTimingFunction             @"transitionTimingFunction"

typedef NS_OPTIONS(NSUInteger, UniTransitionOptions) {
    UniTransitionOptionsNone             = 1 << 0,
    UniTransitionOptionsWidth            = 1 << 1,
    UniTransitionOptionsHeight           = 1 << 2,
    UniTransitionOptionsRight            = 1 << 3,
    UniTransitionOptionsLeft             = 1 << 4,
    UniTransitionOptionsBottom           = 1 << 5,
    UniTransitionOptionsTop              = 1 << 6,
    UniTransitionOptionsBackgroundColor  = 1 << 7,
    UniTransitionOptionsTransform        = 1 << 8,
    UniTransitionOptionsOpacity          = 1 << 9,
    
    UniTransitionOptionsMargin           = 1 << 10,
    UniTransitionOptionsMarginTop        = 1 << 11,
    UniTransitionOptionsMarginBottom     = 1 << 12,
    UniTransitionOptionsMarginLeft       = 1 << 13,
    UniTransitionOptionsMarginRight      = 1 << 14,
    
    UniTransitionOptionsPadding          = 1 << 15,
    UniTransitionOptionsPaddingLeft      = 1 << 16,
    UniTransitionOptionsPaddingRight     = 1 << 17,
    UniTransitionOptionsPaddingTop       = 1 << 18,
    UniTransitionOptionsPaddingBottom    = 1 << 19,
    
    UniTransitionOptionsBorderColor       = 1 << 20,
    UniTransitionOptionsBorderTopColor    = 1 << 21,
    UniTransitionOptionsBorderBottomColor = 1 << 22,
    UniTransitionOptionsBorderLeftColor   = 1 << 23,
    UniTransitionOptionsBorderRightColor  = 1 << 24
};

NS_ASSUME_NONNULL_BEGIN

@interface UniTransitionInfo : NSObject
@property (nonatomic, strong) id fromValue;
@property (nonatomic, strong) id toValue;
@property (nonatomic, strong) id perValue;
@property (nonatomic, assign) bool isPercent;
@property (nonatomic, strong) NSString *propertyName;
@end

@interface UniTransition : NSObject

@property (nonatomic,strong) NSDictionary<NSString*,id>* fromStyles;
@property (nonatomic,strong) NSDictionary<NSString*,id>* toStyles;
@property (nonatomic,strong) NSMutableArray *propertyArray;
@property (nonatomic,assign) UniTransitionOptions transitionOptions;
- (instancetype) initWithStyles:(NSDictionary *)styles;
- (NSArray<NSString*>*)_handleTransitionWithStyles:(NSDictionary *)styles target:(DCUniComponent *)targetComponent;
- (BOOL)_hasTransitionOptionInStyles:(NSDictionary *)styles;
- (BOOL)_isTransitionTag;
- (id)convertLayoutValueToStyleValue:(NSString*)keyName;
- (void)applyStyle:(NSDictionary<NSString*,id>*)styles;
- (void)_suspendTransitionDisplayLink;
- (void)_handleTransitionDisplayLink;
- (void)_awakeTransitionDisplayLink;
@end

NS_ASSUME_NONNULL_END
