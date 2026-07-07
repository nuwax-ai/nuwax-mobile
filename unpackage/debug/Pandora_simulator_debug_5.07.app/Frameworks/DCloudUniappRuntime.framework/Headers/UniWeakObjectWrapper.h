//
//  UniWeakObjectWrapper.h
//  UniCore
//
//  Created by DCloud-iOS-XHY on 2023/4/17.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface UniWeakObjectWrapper : NSObject

@property (nonatomic, weak, readonly) id weakObject;

- (id)initWithWeakObject:(id)weakObject;

@end

NS_ASSUME_NONNULL_END
