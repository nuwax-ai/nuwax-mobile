//
//  CanvasRenderingContext2DBridge.h
//  DCloudUniappRuntime
//
//  Created by X on 2024/6/3.
//

#import <Foundation/Foundation.h>
#import <DCloudUniCanvas/GCanvasModule.h>
#import <DCloudUniCanvas/Path2D.h>
NS_ASSUME_NONNULL_BEGIN

@interface CanvasRenderingContext2DBridge : NSObject

- (nonnull instancetype)initWithGCanvasModule:(nonnull GCanvasModule *)canvasModule  withComponetId:(NSString*)componetId;
- (int)counter;
- (void)setLineWidth:(float)lineWidth;
- (void)setFont:(NSString*)font;
- (void)setFillStyle:(NSObject*)style;
- (void)setFillStyleStr:(NSString*)style;
- (void)setStrokeStyleStr:(NSString*)style;
- (void)setStrokeStyle:(NSObject*)style;
- (void)setGlobalAlpha:(float)alpha;
- (void)setGlobalCompositeOperation:(int)operation;
- (void)setLineCap:(int)lineCap;
- (void)setLineJoin:(int)lineJoin;
- (void)setLineDashOffset:(float)lineDashOffset;
- (void)setTextAlign:(int)textAlign;
- (void)setMiterLimit:(float)miterLimit;
- (void)setTextBaseline:(int)textBaseline;
- (void)arc:(float)x y:(float)y radius:(float)radius startAngle:(float)startAngle endAngle:(float)endAngle anticlockwise:(BOOL)anticlockwise;
- (void)arcTo:(float)x1 y1:(float)y1 x2:(float)x2 y2:(float)y2 radius:(float)radius;
- (void)ellipse:(float)x y:(float)y radiusX:(float)radiusX radiusY:(float)radiusY rotation:(float)rotation startAngle:(float)startAngle endAngle:(float)endAngle counterclockwise:(bool)counterclockwise;
- (void)beginPath;
- (void)bezierCurveTo:(float)cp1x cp1y:(float)cp1y cp2x:(float)cp2x cp2y:(float)cp2y x:(float)x y:(float)y;
- (void)clearRect:(float)x y:(float)y width:(float)width height:(float)height;
- (void)clip;
- (void)closePath;

- (JSValue*)getImageData:(float)x y:(float)y width:(float)width height:(float)height;
- (void)putImageData:(JSValue*)imageDataValue withX:(float)x withY:(float)y
          withDirtyX:(float)dirtyX withDirtyY:(float)dirtyY
      withDirtyWidth:(float)dirtyWidth withDirtyHeight:(float)dirtyHeight;
- (void)drawImage:(int)imageResource sx:(float)sx sy:(float)sy sWidth:(float)sWidth sHeight:(float)sHeight dx:(float)dx dy:(float)dy dWidth:(float)dWidth dHeight:(float)dHeight;
- (void)fill:(int)rule;
- (void)fill:(Path2D*)path rule:(int)rule;
- (void)fillRect:(float)x :(float)y width:(float)width height:(float)height;
- (void)fillText:(NSString * _Nonnull)text x:(float)x y:(float)y maxWidth:(float)maxWidth;
- (void)lineTo:(float)x y:(float)y;
- (float)measureText:(NSString * _Nonnull)text;

- (void)moveTo:(float)x y:(float)y;
- (void)quadraticCurveTo:(float)cpx cpy:(float)cpy x:(float)x y:(float)y;
- (void)rect:(float)x y:(float)y width:(float)width height:(float)height;
- (void)restore;
- (void)reset;
- (void)rotate:(float)rotate;
- (void)save;
- (void)scale:(float)x y:(float)y;
- (void)setLineDash:(NSArray<NSNumber *> * _Nonnull)segments;
- (void)stroke:(Path2D*)path;
- (void)stroke;
- (void)strokeRect:(float)x y:(float)y width:(float)width height:(float)height;
- (void)strokeText:(NSString * _Nonnull)text x:(float)x y:(float)y maxWidth:(float)maxWidth;
- (void)transform:(float)scaleX skewY:(float)skewY skewX:(float)skewX scaleY:(float)scaleY translateX:(float)translateX translateY:(float)translateY;
- (void)setTransform:(float)scaleX skewY:(float)skewY skewX:(float)skewX scaleY:(float)scaleY translateX:(float)translateX translateY:(float)translateY;
- (void)resetTransform;
- (void)translate:(float)translateX translateY:(float)translateY;
- (void)flush;
- (void)flushToBuffer;

- (NSString*)toDataURL:(NSString*)type encoderOptions:(float)encoderOption;
- (void)destory;
@end

NS_ASSUME_NONNULL_END
