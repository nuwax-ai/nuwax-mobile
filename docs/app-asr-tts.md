# app\-asr\-tts

# App 端 ASR / TTS 对接文档

本文说明 App 如何通过 WebSocket 对接 `nuwax-vox-server` 的实时语音识别（ASR）与语音合成（TTS）。



---

## 1\. 概览

|能力|路径|上行|下行|
|---|---|---|---|
|ASR|`ws(s)://{host}/api/app/asr/ws`|JSON 控制 \+ Binary PCM16|JSON（就绪 / 结果 / 错误）|
|TTS|`ws(s)://{host}/api/app/tts/ws`|JSON 控制（文本分片）|JSON 事件 \+ Binary PCM16|

默认音频参数：

- 格式：PCM16，little\-endian，单声道（mono）

- 采样率：`16000` Hz

- 帧时长：`20` ms

- 单帧字节数：`16000 × 20 / 1000 × 2 = 640` bytes

路径可在配置中覆盖：

```YAML
vox:
  app:
    asr-websocket-path: /api/app/asr/ws
    tts-websocket-path: /api/app/tts/ws
```

---

## 2\. 鉴权

握手阶段必须通过鉴权，否则返回 **HTTP 401**，连接不会建立。

支持两种方式（二选一）：

### 2\.1 Header（推荐）

```HTTP
Authorization: Bearer <access_token>
```

### 2\.2 Query（浏览器 / 部分原生 SDK 不便带 Header 时）

```Plaintext
wss://{host}/api/app/asr/ws?access_token=<access_token>
wss://{host}/api/app/tts/ws?access_token=<access_token>
```

`access_token` 为平台登录后的用户 Token（与 App BFF / agent\-platform 一致）。服务端会在握手时校验用户有效性。

> 注意：Token 出现在 URL 时可能进入代理日志，生产环境优先用 Header。

---

## 3\. 通用约定

### 3\.1 消息类型

- **Text 帧**：UTF\-8 JSON，字段 `type` 区分控制/事件

- **Binary 帧**：原始 PCM16 字节（**不是**设备侧 NA 协议帧；服务端内部会自行封装）

### 3\.2 错误消息（ASR / TTS 共用）

```JSON
{
  "type": "error",
  "code": "ASR_NOT_STARTED",
  "message": "send start before audio"
}
```

常见 `code`：

|code|含义|
|---|---|
|`INVALID_JSON`|文本帧不是合法 JSON|
|`UNKNOWN_TYPE`|未知的 `type`|
|`ASR_NOT_STARTED`|未 `start` 就推音频 / `stop`|
|`ASR_FEED_FAILED`|音频喂入失败|
|`TTS_NOT_STARTED`|未 `start` 就发文本 / flush|

### 3\.3 连接生命周期

- 一个 WebSocket 连接可多次 `start` → 业务 → `stop`/`close` 复用

- 再次 `start` 会关闭上一次会话并开新会话

- 断开连接时服务端会清理会话资源

---

## 4\. ASR 对接

### 4\.1 时序

```Plaintext
App                                              Server
 |── WS Connect + Bearer ───────────────────────►|
 |◄─ 101 Switching Protocols ────────────────────|
 |── {"type":"start", ...} ─────────────────────►|
 |◄─ {"type":"asr_ready"} ───────────────────────|
 |── Binary PCM16 (连续) ───────────────────────►|
 |── ... ───────────────────────────────────────►|
 |── {"type":"stop"} ───────────────────────────►|
 |◄─ {"type":"asr_result", "text":"...", ...} ───|
 |── (可再次 start，或关闭连接) ──────────────────|
```

当前协议为 **一段语音一次最终结果**：推流过程中**不下发中间结果**，仅在 `stop` 后返回完整识别文本。

### 4\.2 客户端 → 服务端

#### `start`

开启一轮识别。

```JSON
{
  "type": "start",
  "sample_rate": 16000,
  "frame_duration_ms": 20
}
```

|字段|类型|必填|说明|
|---|---|---|---|
|`type`|string|是|固定 `start`|
|`sample_rate`|int|否|默认 `16000`|
|`frame_duration_ms`|int|否|默认 `20`|

成功后服务端回复 `asr_ready`。

#### Binary 音频

在收到 `asr_ready` 之后，持续发送 **Binary** 帧：

- 内容：PCM16 LE mono 原始字节

- 建议按 `frame_duration_ms` 切帧发送（默认每帧 640 bytes）

- 也可发更大块；服务端会按帧包装后喂给上游 ASR

- 空 payload 会被忽略

未 `start` 就发音频 → `error` / `ASR_NOT_STARTED`。

#### `stop`

结束本轮识别并取结果。

```JSON
{
  "type": "stop"
}
```

服务端会 `flush` 上游 ASR，返回 `asr_result`，并关闭本轮 ASR 会话。

### 4\.3 服务端 → 客户端

#### `asr_ready`

```JSON
{
  "type": "asr_ready"
}
```

#### `asr_result`

```JSON
{
  "type": "asr_result",
  "text": "你好，今天天气怎么样",
  "ok": true,
  "duration_ms": 1280
}
```

|字段|类型|说明|
|---|---|---|
|`text`|string|识别文本；失败时可能为空字符串|
|`ok`|boolean|是否成功|
|`duration_ms`|int|可选；有效语音时长（毫秒）|
|`error`|string|仅 `ok=false` 时可能出现|

失败示例：

```JSON
{
  "type": "asr_result",
  "text": "",
  "ok": false,
  "error": "upstream asr failed"
}
```

### 4\.4 App 实现要点

1. 录音使用与 `start` 一致的采样率 / 声道 / 位深（推荐 16kHz mono PCM16）

2. 用户松手或静音结束时再发 `stop`，不要过早截断

3. 同一轮内不要并发多路 `start`；新一轮前应等上轮 `asr_result` 或主动重 `start`

4. TTS 播放期间建议暂停麦克风上行，避免扬声器回灌被识别

### 4\.5 伪代码

```JavaScript
const ws = new WebSocket(`wss://${host}/api/app/asr/ws?access_token=${token}`);
ws.binaryType = "arraybuffer";

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "start",
    sample_rate: 16000,
    frame_duration_ms: 20
  }));
};

ws.onmessage = (ev) => {
  if (typeof ev.data === "string") {
    const msg = JSON.parse(ev.data);
    if (msg.type === "asr_ready") {
      // 开始按 20ms 发送 PCM Binary
      startMic((pcmChunk) => ws.send(pcmChunk));
    } else if (msg.type === "asr_result") {
      stopMic();
      console.log(msg.ok ? msg.text : msg.error);
    } else if (msg.type === "error") {
      console.error(msg.code, msg.message);
    }
  }
};

// 用户结束说话
function finishUtterance() {
  ws.send(JSON.stringify({ type: "stop" }));
}
```

---

## 5\. TTS 对接

### 5\.1 时序

```Plaintext
App                                              Server
 |── WS Connect + Bearer ───────────────────────►|
 |◄─ 101 Switching Protocols ────────────────────|
 |── {"type":"start", ...} ─────────────────────►|
 |◄─ {"type":"tts_ready"} ───────────────────────|
 |── {"type":"text","text":"你好"} ─────────────►|
 |◄─ {"type":"tts_begin"} ───────────────────────|  // 首包音频前
 |◄─ Binary PCM16 ───────────────────────────────|
 |◄─ Binary PCM16 ───────────────────────────────|
 |── {"type":"text","text":"，世界","flush":true}►|
 |◄─ Binary PCM16 ... ───────────────────────────|
 |◄─ {"type":"tts_end"} ─────────────────────────|  // flush 完成
 |── {"type":"close"} ───────────────────────────►|
 |◄─ {"type":"tts_closed"} ──────────────────────|
```

支持流式喂文本：LLM 边出字边 `text`，最后 `flush`（或在最后一条 `text` 上带 `"flush": true`）。

### 5\.2 客户端 → 服务端

#### `start`

```JSON
{
  "type": "start",
  "sample_rate": 16000,
  "frame_duration_ms": 20
}
```

与 ASR 相同字段含义。成功后返回 `tts_ready`。

#### `text`

喂入待合成文本。

```JSON
{
  "type": "text",
  "text": "你好，",
  "flush": false
}
```

|字段|类型|必填|说明|
|---|---|---|---|
|`type`|string|是|固定 `text`|
|`text`|string|否|文本分片，默认 `""`|
|`flush`|boolean|否|默认 `false`；`true` 表示本轮合成结束并冲刷尾包|

#### `flush`

等价于 `{"type":"text","text":"","flush":true}`。

```JSON
{
  "type": "flush"
}
```

#### `close`

关闭当前 TTS 流。

```JSON
{
  "type": "close"
}
```

服务端回复 `tts_closed`。之后如需再次合成，重新 `start`。

### 5\.3 服务端 → 客户端

#### `tts_ready`

```JSON
{ "type": "tts_ready" }
```

#### `tts_begin`

本轮首次下发音频前发送一次（每个 flush 周期最多一次）。

```JSON
{ "type": "tts_begin" }
```

#### Binary 音频

- 内容：PCM16 LE mono **原始字节**

- 单帧大小：`sample_rate × frame_duration_ms / 1000 × 2`（默认 640）

- flush 时不足一帧的尾部会 **补零填满一帧** 再下发

App 应按 `start` 约定的采样率播放；可边收边播。

#### `tts_end`

在 `flush=true`（或独立 `flush`）且本轮已开始过音频时发送。

```JSON
{ "type": "tts_end" }
```

若 flush 时没有任何音频产出，则**不会**发 `tts_begin` / `tts_end`。

#### `tts_closed`

```JSON
{ "type": "tts_closed" }
```

### 5\.4 App 实现要点

1. 收到 `tts_begin` 后开始播放队列；收到 `tts_end` 表示本轮音频已传完（播放器仍可能有缓冲）

2. 流式场景：按 LLM token / 标点分片 `text`，句子结束再 `flush`

3. 打断（barge\-in）：停止播放、丢弃缓冲，可选发 `close` 或重 `start` 开新流

4. 播放时关闭/静音麦克风，避免 ASR 误识别

### 5\.5 伪代码

```JavaScript
const ws = new WebSocket(`wss://${host}/api/app/tts/ws?access_token=${token}`);
ws.binaryType = "arraybuffer";

const pcmQueue = [];

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: "start",
    sample_rate: 16000,
    frame_duration_ms: 20
  }));
};

ws.onmessage = (ev) => {
  if (typeof ev.data === "string") {
    const msg = JSON.parse(ev.data);
    if (msg.type === "tts_ready") {
      // LLM 流式回调
      onLlmDelta((delta, isLast) => {
        ws.send(JSON.stringify({
          type: "text",
          text: delta,
          flush: isLast
        }));
      });
    } else if (msg.type === "tts_begin") {
      startPlayback(pcmQueue);
    } else if (msg.type === "tts_end") {
      // 本轮合成结束；等播放器排空即可
    } else if (msg.type === "error") {
      console.error(msg.code, msg.message);
    }
  } else {
    pcmQueue.push(new Uint8Array(ev.data));
  }
};
```

---

## 6\. 推荐联调流程

### ASR 冒烟

1. 登录拿到 `access_token`

2. 连接 `/api/app/asr/ws`

3. `start` → 等 `asr_ready`

4. 推送约 1～3 秒真实人声 PCM（或固定测试 wav 转 PCM16）

5. `stop` → 检查 `asr_result.ok === true` 且 `text` 非空

### TTS 冒烟

1. 连接 `/api/app/tts/ws`

2. `start` → 等 `tts_ready`

3. `{"type":"text","text":"测试一下语音合成","flush":true}`

4. 应依次收到：`tts_begin` → 若干 Binary → `tts_end`

5. 将 Binary 拼接为 raw PCM，用 16kHz mono 播放验证

### 端到端（语音问答）

```Plaintext
按住说话 → ASR start/推流/stop → 拿 text
    → 调业务/LLM 拿回复文本
    → TTS start/text(流式)/flush → 播放 PCM
    → 播放结束再开麦
```

---

## 7\. 与设备协议的差异（避免混用）

|项目|App ASR/TTS WS|设备 `/api/device/ws`|
|---|---|---|
|鉴权|Bearer / `access_token`|Bridge Token 等|
|二进制|**裸 PCM16**|NA 帧（带 header）|
|用途|App 独立识别/播报|设备全双工对话桥|

App **不要**把设备模拟器的 NA Binary 直接打到 ASR/TTS 路径。

---

## 8\. 配置与运维备注

- CORS / Origin：`vox.app.allowed-origins`（默认 `*`）

- WebSocket 文本/二进制缓冲区上限与设备侧一致（约 16KB）；App 侧单帧 PCM 通常远小于该值

- 上游 ASR/TTS 供应商由服务端 `vox.asr` / `vox.tts` 配置，App 无感知

- 握手失败排查：Token 是否过期、是否漏 `Bearer` 前缀、租户 Host 是否与平台一致

---

## 9\. 快速对照表

### ASR

|方向|内容|
|---|---|
|C→S|`start` / Binary PCM / `stop`|
|S→C|`asr_ready` / `asr_result` / `error`|

### TTS

|方向|内容|
|---|---|
|C→S|`start` / `text` / `flush` / `close`|
|S→C|`tts_ready` / `tts_begin` / Binary PCM / `tts_end` / `tts_closed` / `error`|

