//
//  ImageData.h
//  DCloudUniCanvas
//
//  Created by X on 2023/7/23.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface ImageData : NSObject
@property(nonatomic, readonly)float width;
@property(nonatomic, readonly)float height;
-(id)initWithWidth:(float)width withHeight:(float)height withData:(uint8_t*)data;
-(uint8_t*)getData;
-(int)getDataLength;
@end

NS_ASSUME_NONNULL_END
