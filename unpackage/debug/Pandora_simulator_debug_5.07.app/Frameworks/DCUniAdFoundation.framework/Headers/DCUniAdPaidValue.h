//
//  DCUniAdPaidValue.h
//  DCUniAdFoundation
//
//  Created by wangzhitong on 2024/11/14.
//

#import <Foundation/Foundation.h>

typedef NS_ENUM(NSInteger, DCUniAdPaidValuePrecision) {
  /// An ad value with unknown precision.
  DCUniAdPaidValuePrecisionUnknown = 0,
  /// An ad value estimated from aggregated data.
  DCUniAdPaidValuePrecisionEstimated = 1,
  /// A publisher-provided ad value, such as manual CPMs in a mediation group.
  DCUniAdPaidValuePrecisionPublisherProvided = 2,
  /// The precise value paid for this ad.
  DCUniAdPaidValuePrecisionPrecise = 3
};

NS_ASSUME_NONNULL_BEGIN

@class DCUniAdPaidValue;
typedef void (^DCUniAdPaidEventHandler)(DCUniAdPaidValue * _Nonnull paidValue);

@interface DCUniAdPaidValue : NSObject

/// The precision of the reported ad value.
@property(nonatomic) DCUniAdPaidValuePrecision precision;

/// The ad's value.
@property(nonatomic, nonnull) NSDecimalNumber *value;

/// The value's currency code.
@property(nonatomic, nonnull) NSString *currencyCode;

@end

NS_ASSUME_NONNULL_END
