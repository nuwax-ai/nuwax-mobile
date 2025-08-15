import { CONVERSATION_CONNECTION_URL } from '../constants/common.constants';
import { ACCESS_TOKEN } from '../constants/home.constants';
import { API_BASE_URL } from '../constants/config';
// import * as TextEncoding from "text-encoding-shim";

// 微信小程序：request
export default function request<T = any>(options: any) {
    const { url, ...rest } = options;
    return uni.request<T>({
        header: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + uni.getStorageSync(ACCESS_TOKEN),
        },
        url: API_BASE_URL + url,
        method: options.method || 'POST',
        ...rest,
      }).then(res => res.data);
  }

// 微信小程序：sse
export const weappEventSource = ({
    data,
    onmessage,
    onerror
  }: {
    data: any;
    onmessage: (txt: string) => void;
    onerror: (e: any) => void;
  }) => {
    const token = uni.getStorageSync(ACCESS_TOKEN) ?? '';
  
    const task = uni.request({
      url: CONVERSATION_CONNECTION_URL,
      method: 'POST',
      data,
      enableChunked: true,
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'application/json, text/plain, */* ',
      },
    });
    task.onChunkReceived(res => {
      const uint8Array = new Uint8Array(res.data);
      // const str1 = new TextEncoding.TextDecoder("utf-8").decode(uint8Array)
      const str = new TextDecoder('utf-8').decode(uint8Array);
      const dataStr = str.split("data:").slice(1)[0];
      onmessage(dataStr);
    });
    task.catch(onerror);
    return task; // 调用方可通过 task.abort() 手动断开
  }