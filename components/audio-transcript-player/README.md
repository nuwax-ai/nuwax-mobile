# audio-transcript-player（音频转写播放器）

会议详情、监控列表等场景共用的「录音播放 + 转写分段同步」组件。

- 播放中按 `startMs` / `endMs` 高亮当前句（暂停后仍高亮）
- 点击分段跳转到对应时间并播放
- 转写列表自动跟随当前句；用户手动滑动后约 3 秒恢复跟随
- 进度条可拖拽；业务时长优先用 `durationMs`

## 示例页面

- 会议 / 监控详情：`/subpackages/pages/terminal/terminal-meeting-detail`
- H5（若已部署）：`{domain}/m/#/subpackages/pages/terminal/terminal-meeting-detail?id=101`

## 基础用法

```uvue
<template>
  <view class="page flex flex-col">
    <audio-transcript-player
      class="flex-1"
      :meeting-id="meetingId"
      :segments="segments"
      :duration-ms="durationMs"
      :has-audio="hasAudio"
      :autoplay="autoplay"
      :show-player="true"
      :show-transcript="true"
      :visible="true"
      @play="onPlay"
      @pause="onPause"
      @seek="onSeek"
      @active-change="onActiveChange"
    />
  </view>
</template>

<script setup lang="uts">
  import { ref } from "vue";
  import { AudioTranscriptSegment } from "@/components/audio-transcript-player/types.uts";

  const meetingId = ref<number>(101);
  const durationMs = ref<number>(31200);
  const hasAudio = ref<boolean>(true);
  const autoplay = ref<boolean>(false);
  const segments = ref<AudioTranscriptSegment[]>([
    new AudioTranscriptSegment(1, "说话人1", "先过一下本周计划。", 0, 5000),
    new AudioTranscriptSegment(2, "说话人2", "接口联调下周一开始。", 5000, 12000),
  ]);

  const onPlay = () => {};
  const onPause = () => {};
  const onSeek = (_ms: number) => {};
  const onActiveChange = (_seq: number) => {};
</script>
```

easycom 已开启时可直接使用标签 `audio-transcript-player`；也可显式导入：

```uts
import AudioTranscriptPlayer from "@/components/audio-transcript-player/audio-transcript-player.uvue";
```

## Props

| Prop | 类型 | 默认 | 说明 |
|------|------|------|------|
| `meetingId` | `number` | `0` | 会议 / 监控记录 id，用于拉临时播放地址 |
| `segments` | `AudioTranscriptSegment[]` | — | 转写分段 |
| `durationMs` | `number` | `0` | 业务时长（进度与 seek 上限） |
| `hasAudio` | `boolean` | `false` | 是否有录音 |
| `autoplay` | `boolean` | `false` | 就绪后自动播放 |
| `showPlayer` | `boolean` | `true` | 是否显示播放条 |
| `showTranscript` | `boolean` | `true` | 是否显示转写列表 |
| `visible` | `boolean` | `true` | 为 false 时暂停自动滚屏（如父级切到其它 Tab） |

## Events

| 事件 | 参数 | 说明 |
|------|------|------|
| `play` | — | 开始播放 |
| `pause` | — | 暂停 |
| `ended` | — | 结束（含业务时长到达） |
| `seek` | `ms: number` | 跳转时间 |
| `active-change` | `seq: number` | 当前高亮分段变化 |

## 对外方法（defineExpose）

通过 `ref` 调用：`play()` / `pause()` / `seekToMs(ms)`。

## 平台说明

音频播放逻辑当前仅在 **App** 端接线（`#ifdef APP`）。H5 / 小程序可展示转写列表，播放能力未接线。
