//
//  QIPlayerSEIDataListener.h
//  qplayer2-core
//
//  Created by 王声禄 on 2022/8/12.
//

#ifndef QIPlayerSEIDataListener_h
#define QIPlayerSEIDataListener_h

@class QPlayerContext;
/**
 SEI 数据监听
 */
@protocol QIPlayerSEIDataListener <NSObject>

/**
 SEI 数据回调，且回调时机为SEI数据所在帧的时间
 @param context 当前的播放器
 @param data SEI 数据
*/
@optional
-(void)onSEIData:(QPlayerContext *)context data:(NSData *)data;
@end
#endif /* QIPlayerSEIDataListener_h */
