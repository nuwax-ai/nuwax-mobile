//
//  Path2D.h
//  DCloudUniappRuntime
//
//  Created by X on 2024/6/13.
//

#import <Foundation/Foundation.h>
#import <JavaScriptCore/JavaScriptCore.h>
NS_ASSUME_NONNULL_BEGIN

@protocol Path2DJSExport <JSExport>
-(id)init;
JSExportAs(arcTo,
           -(void)arcTo:(float)x1 _:(float)y1 _:(float)x2 _:(float)y2 _:(float)radius
);
JSExportAs(arc,
           -(void)arc:(float)x _:(float)y _:(float)radius _:(float)startAngle _:(float)endAngle _:(float)anticlockwise
);
JSExportAs(bezierCurveTo,
           -(void)bezierCurveTo:(float)cp1x _:(float)cp1y _:(float)cp2x _:(float)cp2y _:(float)x _:(float)y
);
JSExportAs(rect,
           -(void)rect:(float)x _:(float)y _:(float)width _:(float)height
);

JSExportAs(lineTo,
           -(void)lineTo:(float)x _:(float)y
);

JSExportAs(moveTo,
           -(void)moveTo:(float)x _:(float)y
);

JSExportAs(quadraticCurveTo,
           -(void)quadraticCurveTo:(float)cpx _:(float)cpy _:(float)x _:(float)y
);
JSExportAs(ellipse,
           - (void)ellipse:(float)x _:(float)y _:(float)radiusX _:(float)radiusY _:(float)rotation _:(float)startAngle _:(float)endAngle _:(bool)counterclockwise
);
-(void)closePath;
@end

@interface Path2D : NSObject<Path2DJSExport>

@end

NS_ASSUME_NONNULL_END
