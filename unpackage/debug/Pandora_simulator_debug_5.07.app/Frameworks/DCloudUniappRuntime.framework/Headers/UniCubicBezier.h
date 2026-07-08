
#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
@interface UniCubicBezier : NSObject

- (instancetype)initWithP1x:(double)p1x p1y:(double)p1y p2x:(double)p2x p2y:(double)p2y;
- (double)sampleCurveX:(double)t;
- (double)sampleCurveY:(double)t;
- (double)sampleCurveDerivativeX:(double)t;
- (double)sampleCurveDerivativeY:(double)t;
- (double)solveCurveX:(double)x epsilon:(double)epsilon;
- (double)solve:(double)x;
- (double)solveWithEpsilon:(double)x epsilon:(double)epsilon;
- (double)slope:(double)x;
- (double)slopeWithEpsilon:(double)x epsilon:(double)epsilon;
- (double)getX1;
- (double)getY1;
- (double)getX2;
- (double)getY2;
- (double)rangeMin;
- (double)rangeMax;
@end

NS_ASSUME_NONNULL_END
