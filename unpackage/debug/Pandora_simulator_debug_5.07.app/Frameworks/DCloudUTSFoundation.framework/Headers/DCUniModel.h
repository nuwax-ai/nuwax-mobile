//
//  DCUniModel.h
//  DCUniModel <https://github.com/ibireme/DCUniModel>
//
//  Created by ibireme on 15/5/10.
//  Copyright (c) 2015 ibireme.
//
//  This source code is licensed under the MIT-style license found in the
//  LICENSE file in the root directory of this source tree.
//

#import <Foundation/Foundation.h>

#if __has_include(<DCUniModel/DCUniModel.h>)
FOUNDATION_EXPORT double DCUniModelVersionNumber;
FOUNDATION_EXPORT const unsigned char DCUniModelVersionString[];
#import <DCUniModel/NSObject+DCUniModel.h>
#import <DCUniModel/DCUniClassInfo.h>
#else
#import <DCloudUTSFoundation/NSObject+DCUniModel.h>
#import <DCloudUTSFoundation/DCUniClassInfo.h>
#endif
