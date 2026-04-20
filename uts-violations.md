# UTS 违规项扫描报告

生成时间：2026/4/20 17:39:53

## 概览

- **总违规数**: 251
- **涉及文件**: 57
- **检测规则**: 26 种

## 修复优先级

### 高优先级 (编译错误)

- `UTS110111163` (interface 对象字面量): 4 处
- `UTS110111120` (非布尔条件): 27 处
- `UTS110111150` (声明提升): 37 处
- `TYPE_ARROW_DEFAULT` (箭头函数默认参数): 14 处
- `TYPE_SPREAD` (展开运算符): 12 处
- `TYPE_OBJECT_ASSIGN` (Object.assign): 9 处
- `TYPE_REF_OPTIONAL` (ref 可选链): 8 处
- `TYPE_ANY_PROP_ACCESS` (any 属性/下标访问): 22 处
- `TYPE_REF_ANY_METHOD` (ref<any> 方法调用): 6 处
- `TYPE_WATCH_GETTER_BOOL` (watch getter 返回类型): 7 处
- `TYPE_BOOLEAN_NULLABLE_OR` (nullable 布尔 || 模板): 1 处

### 中优先级 (类型不匹配)

- `TYPE_STRING_CTOR` (String() 构造): 46 处
- `TYPE_VALOR_NULLABLE` (valOr nullable 类型): 37 处
- `UTS110111125` (Utility Types): 4 处
- `TYPE_NPM_IMPORT` (非 UTS 兼容 import): 1 处
- `TYPE_MAP_INDEX_TYPED` (下标访问 Any? 传类型参数): 7 处

### 低优先级 (编码规范)

- `UTS110111149` (delete 运算符): 4 处
- `UTS110111158` (throw 非 Error): 5 处

## 按类型统计

- **TYPE_STRING_CTOR** (String() 构造): 46 处
- **TYPE_VALOR_NULLABLE** (valOr nullable 类型): 37 处
- **UTS110111150** (声明提升): 37 处
- **UTS110111120** (非布尔条件): 27 处
- **TYPE_ANY_PROP_ACCESS** (any 属性/下标访问): 22 处
- **TYPE_ARROW_DEFAULT** (箭头函数默认参数): 14 处
- **TYPE_SPREAD** (展开运算符): 12 处
- **TYPE_OBJECT_ASSIGN** (Object.assign): 9 处
- **TYPE_REF_OPTIONAL** (ref 可选链): 8 处
- **TYPE_WATCH_GETTER_BOOL** (watch getter 返回类型): 7 处
- **TYPE_MAP_INDEX_TYPED** (下标访问 Any? 传类型参数): 7 处
- **TYPE_REF_ANY_METHOD** (ref<any> 方法调用): 6 处
- **UTS110111158** (throw 非 Error): 5 处
- **UTS110111149** (delete 运算符): 4 处
- **UTS110111125** (Utility Types): 4 处
- **UTS110111163** (interface 对象字面量): 4 处
- **TYPE_BOOLEAN_NULLABLE_OR** (nullable 布尔 || 模板): 1 处
- **TYPE_NPM_IMPORT** (非 UTS 兼容 import): 1 处

## 按文件统计 (Top 20)

- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts`: 26 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue`: 20 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue`: 20 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue`: 15 处
- `/Users/apple/workspace/nuwax-mobile/servers/useRequest.uts`: 10 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue`: 10 处
- `/Users/apple/workspace/nuwax-mobile/utils/pinyin.uts`: 10 处
- `/Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts`: 9 处
- `/Users/apple/workspace/nuwax-mobile/utils/customActionService.uts`: 9 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/chat-input-phone.uvue`: 7 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-search/agent-search.uvue`: 7 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue`: 7 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-detail/agent-detail.uvue`: 6 处
- `/Users/apple/workspace/nuwax-mobile/utils/streamRequest.uts`: 6 处
- `/Users/apple/workspace/nuwax-mobile/components/voice-recorder-button/voice-recorder-button.uvue`: 5 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/file-tree/file-tree.uvue`: 5 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/utils/customActionService.uts`: 5 处
- `/Users/apple/workspace/nuwax-mobile/pages/index/conversation-list-content/conversation-list-content.uvue`: 4 处
- `/Users/apple/workspace/nuwax-mobile/pages/index/index.uvue`: 4 处
- `/Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/agent-conversation-history/agent-conversation-history.uvue`: 4 处

## 详细违规列表


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:149

- **类型**: `UTS110111163` — interface 对象字面量
- **位置**: 第 149 行，第 1 列

```
const eventData: OpenPreviewEventData = {
```

**说明**: Interface 'OpenPreviewEventData' used as object literal type
**修复**: Change 'interface OpenPreviewEventData' to 'type OpenPreviewEventData'
---


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:179

- **类型**: `UTS110111163` — interface 对象字面量
- **位置**: 第 179 行，第 1 列

```
const eventData: OpenDesktopEventData = {
```

**说明**: Interface 'OpenDesktopEventData' used as object literal type
**修复**: Change 'interface OpenDesktopEventData' to 'type OpenDesktopEventData'
---


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:206

- **类型**: `UTS110111163` — interface 对象字面量
- **位置**: 第 206 行，第 1 列

```
const eventData: RefreshFileListEventData = {
```

**说明**: Interface 'RefreshFileListEventData' used as object literal type
**修复**: Change 'interface RefreshFileListEventData' to 'type RefreshFileListEventData'
---


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:237

- **类型**: `UTS110111163` — interface 对象字面量
- **位置**: 第 237 行，第 1 列

```
const eventData: OpenPageEventData = {
```

**说明**: Interface 'OpenPageEventData' used as object literal type
**修复**: Change 'interface OpenPageEventData' to 'type OpenPageEventData'
---


### /Users/apple/workspace/nuwax-mobile/components/auth-login-popup/auth-login-popup.uvue:101

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 101 行，第 5 列

```
if (!agreeTerms.value) {
```

**说明**: Possible non-boolean negation: !agreeTerms.value
**修复**: Use agreeTerms.value == null or agreeTerms.value != true
---


### /Users/apple/workspace/nuwax-mobile/components/auth-login-popup/auth-login-popup.uvue:101

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 101 行，第 9 列

```
if (!agreeTerms.value) {
```

**说明**: Nullable ref negation: !agreeTerms.value
**修复**: Use agreeTerms.value == null
---


### /Users/apple/workspace/nuwax-mobile/components/pane-tabs/pane-tabs.uvue:233

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 233 行，第 9 列

```
if (!isSwiping.value) return;
```

**说明**: Nullable ref negation: !isSwiping.value
**修复**: Use isSwiping.value == null
---


### /Users/apple/workspace/nuwax-mobile/hooks/usePageResume.uts:76

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 76 行，第 9 列

```
if (!isHidden.value) {
```

**说明**: Nullable ref negation: !isHidden.value
**修复**: Use isHidden.value == null
---


### /Users/apple/workspace/nuwax-mobile/pages/index/agent-list-content/agent-list-content.uvue:103

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 103 行，第 7 列

```
!loading.value && !hasMore.value && recentAgentList.value?.length > 8
```

**说明**: Nullable ref negation: !loading.value
**修复**: Use loading.value == null
---


### /Users/apple/workspace/nuwax-mobile/pages/index/agent-list-content/agent-list-content.uvue:233

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 233 行，第 26 列

```
if (hasMore.value && !loading.value) {
```

**说明**: Nullable ref negation: !loading.value
**修复**: Use loading.value == null
---


### /Users/apple/workspace/nuwax-mobile/pages/index/conversation-list-content/conversation-list-content.uvue:115

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 115 行，第 7 列

```
!loading.value && !hasMore.value && conversationList.value?.length > 8
```

**说明**: Nullable ref negation: !loading.value
**修复**: Use loading.value == null
---


### /Users/apple/workspace/nuwax-mobile/pages/index/conversation-list-content/conversation-list-content.uvue:183

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 183 行，第 26 列

```
if (hasMore.value && !loading.value) {
```

**说明**: Nullable ref negation: !loading.value
**修复**: Use loading.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/chat-input-phone.uvue:986

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 986 行，第 32 列

```
showExtraContainer.value = !showExtraContainer.value;
```

**说明**: Nullable ref negation: !showExtraContainer.value
**修复**: Use showExtraContainer.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/hooks/usePageResume.uts:76

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 76 行，第 9 列

```
if (!isHidden.value) {
```

**说明**: Nullable ref negation: !isHidden.value
**修复**: Use isHidden.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-search/agent-search.uvue:264

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 264 行，第 10 列

```
return !loading.value && !hasMore.value && agentList.value?.length > 8
```

**说明**: Nullable ref negation: !loading.value
**修复**: Use loading.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-search/agent-search.uvue:450

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 450 行，第 26 列

```
if (hasMore.value && !loading.value) {
```

**说明**: Nullable ref negation: !loading.value
**修复**: Use loading.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:712

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 712 行，第 7 列

```
!hasMoreMessages.value ||
```

**说明**: Nullable ref negation: !hasMoreMessages.value
**修复**: Use hasMoreMessages.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:714

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 714 行，第 7 列

```
!messageList.value?.length
```

**说明**: Nullable ref negation: !messageList.value
**修复**: Use messageList.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/agent-conversation-history/agent-conversation-history.uvue:91

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 91 行，第 7 列

```
!loading.value && !hasMore.value && conversationList.value?.length > 0
```

**说明**: Nullable ref negation: !loading.value
**修复**: Use loading.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/agent-conversation-history/agent-conversation-history.uvue:153

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 153 行，第 26 列

```
if (hasMore.value && !loading.value) {
```

**说明**: Nullable ref negation: !loading.value
**修复**: Use loading.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue:256

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 256 行，第 20 列

```
isOpen.value = !isOpen.value
```

**说明**: Nullable ref negation: !isOpen.value
**修复**: Use isOpen.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/ScrollManager.uts:76

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 76 行，第 5 列

```
if (!this.data.needSetLockAutoToLastMsg.value) return;
```

**说明**: Possible non-boolean negation: !this.data.needSetLockAutoToLastMsg.value
**修复**: Use this.data.needSetLockAutoToLastMsg.value == null or this.data.needSetLockAutoToLastMsg.value != true
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:96

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 96 行，第 5 列

```
if (!props.tenantConfigInfo) {
```

**说明**: Possible non-boolean negation: !props.tenantConfigInfo
**修复**: Use props.tenantConfigInfo == null or props.tenantConfigInfo != true
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:170

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 170 行，第 5 列

```
if (!props.tenantConfigInfo) {
```

**说明**: Possible non-boolean negation: !props.tenantConfigInfo
**修复**: Use props.tenantConfigInfo == null or props.tenantConfigInfo != true
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:177

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 177 行，第 5 列

```
if (!agreeTerms.value) {
```

**说明**: Possible non-boolean negation: !agreeTerms.value
**修复**: Use agreeTerms.value == null or agreeTerms.value != true
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:177

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 177 行，第 9 列

```
if (!agreeTerms.value) {
```

**说明**: Nullable ref negation: !agreeTerms.value
**修复**: Use agreeTerms.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:502

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 502 行，第 26 列

```
showPassword.value = !showPassword.value;
```

**说明**: Nullable ref negation: !showPassword.value
**修复**: Use showPassword.value == null
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login-weixin/login-weixin.uvue:60

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 60 行，第 7 列

```
if (!isAgreed.value) {
```

**说明**: Nullable ref negation: !isAgreed.value
**修复**: Use isAgreed.value == null
---


### /Users/apple/workspace/nuwax-mobile/utils/mockApiService.uts:118

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 118 行，第 5 列

```
if (!MockApiService.instance) {
```

**说明**: Possible non-boolean negation: !MockApiService.instance
**修复**: Use MockApiService.instance == null or MockApiService.instance != true
---


### /Users/apple/workspace/nuwax-mobile/utils/mockApiService.uts:153

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 153 行，第 5 列

```
if (!request.audio) {
```

**说明**: Possible non-boolean negation: !request.audio
**修复**: Use request.audio == null or request.audio != true
---


### /Users/apple/workspace/nuwax-mobile/utils/permissionHelper.uts:26

- **类型**: `UTS110111120` — 非布尔条件
- **位置**: 第 26 行，第 5 列

```
if (!PermissionManager.instanceSet) {
```

**说明**: Possible non-boolean negation: !PermissionManager.instanceSet
**修复**: Use PermissionManager.instanceSet == null or PermissionManager.instanceSet != true
---


### /Users/apple/workspace/nuwax-mobile/components/auth-login-popup/auth-login-popup.uvue:71

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 71 行，第 1 列

```
await fetchTenantConfig();
```

**说明**: 'fetchTenantConfig' called before declaration (line 87)
**修复**: Move definition of 'fetchTenantConfig' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/components/voice-recorder-button/voice-recorder-button.uvue:190

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 190 行，第 1 列

```
cancelRecording()
```

**说明**: 'cancelRecording' called before declaration (line 197)
**修复**: Move definition of 'cancelRecording' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/components/voice-recorder-button/voice-recorder-button.uvue:192

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 192 行，第 1 列

```
stopRecording()
```

**说明**: 'stopRecording' called before declaration (line 256)
**修复**: Move definition of 'stopRecording' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/components/voice-recorder-button/voice-recorder-button.uvue:241

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 241 行，第 1 列

```
const result = await uploadAndConvertWithService(audioFile)
```

**说明**: 'uploadAndConvertWithService' called before declaration (line 277)
**修复**: Move definition of 'uploadAndConvertWithService' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/pages/index/agent-list-content/agent-list-content.uvue:189

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 189 行，第 1 列

```
deleteUserUsedAgent(info?.agentId);
```

**说明**: 'deleteUserUsedAgent' called before declaration (line 196)
**修复**: Move definition of 'deleteUserUsedAgent' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/chat-input-phone.uvue:643

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 643 行，第 1 列

```
uploadMultipleFiles(filePaths);
```

**说明**: 'uploadMultipleFiles' called before declaration (line 919)
**修复**: Move definition of 'uploadMultipleFiles' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/chat-input-phone.uvue:826

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 826 行，第 1 列

```
uploadMultipleFiles(filePaths);
```

**说明**: 'uploadMultipleFiles' called before declaration (line 919)
**修复**: Move definition of 'uploadMultipleFiles' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/model-select-modal/model-select-modal.uvue:70

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 70 行，第 1 列

```
handleModelChange(modelOptions.value[0].value);
```

**说明**: 'handleModelChange' called before declaration (line 84)
**修复**: Move definition of 'handleModelChange' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:154

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 154 行，第 1 列

```
handleClose();
```

**说明**: 'handleClose' called before declaration (line 239)
**修复**: Move definition of 'handleClose' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:198

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 198 行，第 1 列

```
fetchSkillsForTab(currentTab.value);
```

**说明**: 'fetchSkillsForTab' called before declaration (line 252)
**修复**: Move definition of 'fetchSkillsForTab' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:204

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 204 行，第 1 列

```
fetchSkillsForTab(currentTab.value);
```

**说明**: 'fetchSkillsForTab' called before declaration (line 252)
**修复**: Move definition of 'fetchSkillsForTab' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:227

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 227 行，第 1 列

```
fetchSkillsForTab(tabs.value[index].value);
```

**说明**: 'fetchSkillsForTab' called before declaration (line 252)
**修复**: Move definition of 'fetchSkillsForTab' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:236

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 236 行，第 1 列

```
fetchSkillsForTab(tabs.value[index].value);
```

**说明**: 'fetchSkillsForTab' called before declaration (line 252)
**修复**: Move definition of 'fetchSkillsForTab' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/file-preview-h5.vue:75

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 75 行，第 1 列

```
data() {
```

**说明**: 'data' called before declaration (line 141)
**修复**: Move definition of 'data' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:694

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 694 行，第 1 列

```
handleScrollToUpper();
```

**说明**: 'handleScrollToUpper' called before declaration (line 710)
**修复**: Move definition of 'handleScrollToUpper' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:1136

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 1136 行，第 1 列

```
handleOpenPagePreview({ uri: fullUri });
```

**说明**: 'handleOpenPagePreview' called before declaration (line 1161)
**修复**: Move definition of 'handleOpenPagePreview' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:1143

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 1143 行，第 1 列

```
handleOpenPagePreview({
```

**说明**: 'handleOpenPagePreview' called before declaration (line 1161)
**修复**: Move definition of 'handleOpenPagePreview' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:103

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 103 行，第 1 列

```
open();
```

**说明**: 'open' called before declaration (line 106)
**修复**: Move definition of 'open' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:108

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 108 行，第 1 列

```
startCountdown();
```

**说明**: 'startCountdown' called before declaration (line 252)
**修复**: Move definition of 'startCountdown' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:110

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 110 行，第 1 列

```
focusInput();
```

**说明**: 'focusInput' called before declaration (line 270)
**修复**: Move definition of 'focusInput' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:115

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 115 行，第 1 列

```
clearCountdown();
```

**说明**: 'clearCountdown' called before declaration (line 262)
**修复**: Move definition of 'clearCountdown' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:168

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 168 行，第 1 列

```
await getClipboardAndPaste();
```

**说明**: 'getClipboardAndPaste' called before declaration (line 173)
**修复**: Move definition of 'getClipboardAndPaste' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:176

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 176 行，第 1 列

```
await processPasteData(res.data);
```

**说明**: 'processPasteData' called before declaration (line 186)
**修复**: Move definition of 'processPasteData' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:257

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 257 行，第 1 列

```
clearCountdown();
```

**说明**: 'clearCountdown' called before declaration (line 262)
**修复**: Move definition of 'clearCountdown' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:186

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 186 行，第 1 列

```
doLogin();
```

**说明**: 'doLogin' called before declaration (line 195)
**修复**: Move definition of 'doLogin' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:191

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 191 行，第 1 列

```
doLogin();
```

**说明**: 'doLogin' called before declaration (line 195)
**修复**: Move definition of 'doLogin' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:217

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 217 行，第 1 列

```
handleClickAliyunCaptcha();
```

**说明**: 'handleClickAliyunCaptcha' called before declaration (line 230)
**修复**: Move definition of 'handleClickAliyunCaptcha' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:222

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 222 行，第 1 列

```
handlerSuccess();
```

**说明**: 'handlerSuccess' called before declaration (line 244)
**修复**: Move definition of 'handlerSuccess' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:226

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 226 行，第 1 列

```
handlerSuccess();
```

**说明**: 'handlerSuccess' called before declaration (line 244)
**修复**: Move definition of 'handlerSuccess' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:238

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 238 行，第 1 列

```
handlerSuccess(captchaVerifyParam);
```

**说明**: 'handlerSuccess' called before declaration (line 244)
**修复**: Move definition of 'handlerSuccess' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:247

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 247 行，第 1 列

```
handleNext(captchaVerifyParam);
```

**说明**: 'handleNext' called before declaration (line 306)
**修复**: Move definition of 'handleNext' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:250

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 250 行，第 1 列

```
handleLogin(captchaVerifyParam);
```

**说明**: 'handleLogin' called before declaration (line 254)
**修复**: Move definition of 'handleLogin' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:256

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 256 行，第 1 列

```
handleLoginByEmail(captchaVerifyParam);
```

**说明**: 'handleLoginByEmail' called before declaration (line 401)
**修复**: Move definition of 'handleLoginByEmail' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:258

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 258 行，第 1 列

```
handleLoginByPhone(captchaVerifyParam);
```

**说明**: 'handleLoginByPhone' called before declaration (line 370)
**修复**: Move definition of 'handleLoginByPhone' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:394

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 394 行，第 1 列

```
handleLoginSuccess(result);
```

**说明**: 'handleLoginSuccess' called before declaration (line 456)
**修复**: Move definition of 'handleLoginSuccess' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/login.uvue:93

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 93 行，第 1 列

```
handleLoginSuccess(result);
```

**说明**: 'handleLoginSuccess' called before declaration (line 97)
**修复**: Move definition of 'handleLoginSuccess' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login-weixin/login-weixin.uvue:95

- **类型**: `UTS110111150` — 声明提升
- **位置**: 第 95 行，第 1 列

```
handleLoginSuccess(code, data, message);
```

**说明**: 'handleLoginSuccess' called before declaration (line 101)
**修复**: Move definition of 'handleLoginSuccess' before its first usage
---


### /Users/apple/workspace/nuwax-mobile/pages/index/conversation-list-content/conversation-list-content.uvue:120

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 120 行，第 1 列

```
const fetchConversationList = async (isLoadMore: boolean = false) => {
```

**说明**: Arrow function default parameter 'isLoadMore' not supported in UTS
**修复**: Use nullable param + internal default: (isLoadMore: T | null) => { const _isLoadMore = isLoadMore != null ? isLoadMore : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-search/agent-search.uvue:304

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 304 行，第 1 列

```
const fetchAgentList = async (pageNum: number = 1, keyword: string = searchKeyword.value) => {
```

**说明**: Arrow function default parameter 'pageNum' not supported in UTS
**修复**: Use nullable param + internal default: (pageNum: T | null) => { const _pageNum = pageNum != null ? pageNum : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-search/agent-search.uvue:337

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 337 行，第 1 列

```
const fetchUserUsedAgentList = async (pageNum: number = 1, keyword: string = searchKeyword.value) => {
```

**说明**: Arrow function default parameter 'pageNum' not supported in UTS
**修复**: Use nullable param + internal default: (pageNum: T | null) => { const _pageNum = pageNum != null ? pageNum : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-search/agent-search.uvue:364

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 364 行，第 1 列

```
const fetchList = async (pageNum: number = 1, keyword: string = searchKeyword.value) => {
```

**说明**: Arrow function default parameter 'pageNum' not supported in UTS
**修复**: Use nullable param + internal default: (pageNum: T | null) => { const _pageNum = pageNum != null ? pageNum : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:1047

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 1047 行，第 1 列

```
const handleCreateTempChat = async (captchaVerifyParam: string = "") => {
```

**说明**: Arrow function default parameter 'captchaVerifyParam' not supported in UTS
**修复**: Use nullable param + internal default: (captchaVerifyParam: T | null) => { const _captchaVerifyParam = captchaVerifyParam != null ? captchaVerifyParam : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/agent-conversation-history/agent-conversation-history.uvue:96

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 96 行，第 1 列

```
const fetchConversationList = async (isLoadMore: boolean = false) => {
```

**说明**: Arrow function default parameter 'isLoadMore' not supported in UTS
**修复**: Use nullable param + internal default: (isLoadMore: T | null) => { const _isLoadMore = isLoadMore != null ? isLoadMore : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:244

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 244 行，第 1 列

```
const handlerSuccess = (captchaVerifyParam: string = "") => {
```

**说明**: Arrow function default parameter 'captchaVerifyParam' not supported in UTS
**修复**: Use nullable param + internal default: (captchaVerifyParam: T | null) => { const _captchaVerifyParam = captchaVerifyParam != null ? captchaVerifyParam : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:254

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 254 行，第 1 列

```
const handleLogin = (captchaVerifyParam: string = "") => {
```

**说明**: Arrow function default parameter 'captchaVerifyParam' not supported in UTS
**修复**: Use nullable param + internal default: (captchaVerifyParam: T | null) => { const _captchaVerifyParam = captchaVerifyParam != null ? captchaVerifyParam : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:306

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 306 行，第 1 列

```
const handleNext = async (captchaVerifyParam: string = "") => {
```

**说明**: Arrow function default parameter 'captchaVerifyParam' not supported in UTS
**修复**: Use nullable param + internal default: (captchaVerifyParam: T | null) => { const _captchaVerifyParam = captchaVerifyParam != null ? captchaVerifyParam : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:370

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 370 行，第 1 列

```
const handleLoginByPhone = async (captchaVerifyParam: string = "") => {
```

**说明**: Arrow function default parameter 'captchaVerifyParam' not supported in UTS
**修复**: Use nullable param + internal default: (captchaVerifyParam: T | null) => { const _captchaVerifyParam = captchaVerifyParam != null ? captchaVerifyParam : default; }
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/login-form/login-form.uvue:401

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 401 行，第 1 列

```
const handleLoginByEmail = async (captchaVerifyParam: string = "") => {
```

**说明**: Arrow function default parameter 'captchaVerifyParam' not supported in UTS
**修复**: Use nullable param + internal default: (captchaVerifyParam: T | null) => { const _captchaVerifyParam = captchaVerifyParam != null ? captchaVerifyParam : default; }
---


### /Users/apple/workspace/nuwax-mobile/utils/markdown.uts:9

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 9 行，第 1 列

```
return (text: string, startPos: number = 0) => {
```

**说明**: Arrow function default parameter 'startPos' not supported in UTS
**修复**: Use nullable param + internal default: (startPos: T | null) => { const _startPos = startPos != null ? startPos : default; }
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:9357

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 9357 行，第 1 列

```
const getAllPinyin = (char, surname = "off") => {
```

**说明**: Arrow function default parameter 'surname' not supported in UTS
**修复**: Use nullable param + internal default: (surname: T | null) => { const _surname = surname != null ? surname : default; }
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:9371

- **类型**: `TYPE_ARROW_DEFAULT` — 箭头函数默认参数
- **位置**: 第 9371 行，第 1 列

```
const getMultiplePinyin = (word, surname = "off") => {
```

**说明**: Arrow function default parameter 'surname' not supported in UTS
**修复**: Use nullable param + internal default: (surname: T | null) => { const _surname = surname != null ? surname : default; }
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:61

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 61 行，第 1 列

```
this.config = { ...this.config, ...config };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:403

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 403 行，第 1 列

```
this.config = { ...this.config, ...config };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:410

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 410 行，第 1 列

```
return { ...this.config };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:262

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 262 行，第 1 列

```
listDataByTab.value = { ...listDataByTab.value, [tab]: [] };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:287

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 287 行，第 1 列

```
listDataByTab.value = { ...listDataByTab.value, [tab]: newList };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:291

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 291 行，第 1 列

```
listDataByTab.value = { ...listDataByTab.value, [tab]: [] };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:306

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 306 行，第 1 列

```
listDataByTab.value = { ...listDataByTab.value, [tab]: res.data };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:308

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 308 行，第 1 列

```
listDataByTab.value = { ...listDataByTab.value, [tab]: [] };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:314

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 314 行，第 1 列

```
listDataByTab.value = { ...listDataByTab.value, [tab]: [] };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/file-tree/file-tree.uvue:233

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 233 行，第 1 列

```
buttonStartPos.value = { ...buttonPosition.value };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:203

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 203 行，第 1 列

```
return { ...adaptedMessage, text, id };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:298

- **类型**: `TYPE_SPREAD` — 展开运算符
- **位置**: 第 298 行，第 1 列

```
return { ...adaptedMessage, text, id };
```

**说明**: Object spread operator not supported in UTS
**修复**: Modify properties directly or create new object with explicit properties
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue:195

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 195 行，第 1 列

```
Object.assign(formSourceData, newVal)
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue:196

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 196 行，第 1 列

```
Object.assign(formData, newVal)
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:9148

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 9148 行，第 1 列

```
result.push(Object.assign(Object.assign({}, pattern), { index: i - pattern.length + 1 }));
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:9164

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 9164 行，第 1 列

```
result.push(Object.assign(Object.assign({}, pattern), { index: i - pattern.length + 1 }));
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:9697

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 9697 行，第 1 列

```
options = Object.assign(Object.assign({}, DEFAULT_OPTIONS$2), safeOptions);
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:9847

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 9847 行，第 1 列

```
const completeOptions = Object.assign(Object.assign({}, DefaultMatchOptions), safeOptions);
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:10087

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 10087 行，第 1 列

```
const completeOptions = Object.assign(Object.assign({}, DefaultHtmlOptions), safeOptions);
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:10257

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 10257 行，第 1 列

```
options = Object.assign(Object.assign({}, DefaultConvertOptions), safeOptions);
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:10427

- **类型**: `TYPE_OBJECT_ASSIGN` — Object.assign
- **位置**: 第 10427 行，第 1 列

```
options = Object.assign(Object.assign({}, DEFAULT_OPTIONS), safeOptions);
```

**说明**: Object.assign() not supported with typed objects in UTS
**修复**: Assign properties manually: target.prop = source.prop
---


### /Users/apple/workspace/nuwax-mobile/components/drawer-popup/drawer-popup.uvue:232

- **类型**: `TYPE_REF_OPTIONAL` — ref 可选链
- **位置**: 第 232 行，第 1 列

```
popupRef.value?.close();
```

**说明**: Optional chaining on ref: popupRef.value?.method()
**修复**: Use explicit null check + typed ref: if (ref.value != null) ref.value.method()
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:346

- **类型**: `TYPE_REF_OPTIONAL` — ref 可选链
- **位置**: 第 346 行，第 1 列

```
drawerPopupRef.value?.open();
```

**说明**: Optional chaining on ref: drawerPopupRef.value?.method()
**修复**: Use explicit null check + typed ref: if (ref.value != null) ref.value.method()
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:348

- **类型**: `TYPE_REF_OPTIONAL` — ref 可选链
- **位置**: 第 348 行，第 1 列

```
drawerPopupRef.value?.close();
```

**说明**: Optional chaining on ref: drawerPopupRef.value?.method()
**修复**: Use explicit null check + typed ref: if (ref.value != null) ref.value.method()
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-detail/agent-detail.uvue:48

- **类型**: `TYPE_REF_OPTIONAL` — ref 可选链
- **位置**: 第 48 行，第 1 列

```
title: strOr(componentRef?.getAgentInfo()?.name, ''),
```

**说明**: Optional chaining on ref: componentRef?.method()
**修复**: Use explicit null check + typed ref: if (ref.value != null) ref.value.method()
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-detail/agent-detail.uvue:58

- **类型**: `TYPE_REF_OPTIONAL` — ref 可选链
- **位置**: 第 58 行，第 1 列

```
title: strOr(componentRef?.getAgentInfo()?.name, ''),
```

**说明**: Optional chaining on ref: componentRef?.method()
**修复**: Use explicit null check + typed ref: if (ref.value != null) ref.value.method()
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:1373

- **类型**: `TYPE_REF_OPTIONAL` — ref 可选链
- **位置**: 第 1373 行，第 1 列

```
fileTreeRef.value?.open();
```

**说明**: Optional chaining on ref: fileTreeRef.value?.method()
**修复**: Use explicit null check + typed ref: if (ref.value != null) ref.value.method()
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/file-tree/file-tree.uvue:339

- **类型**: `TYPE_REF_OPTIONAL` — ref 可选链
- **位置**: 第 339 行，第 1 列

```
popupFileTreeRef.value?.open();
```

**说明**: Optional chaining on ref: popupFileTreeRef.value?.method()
**修复**: Use explicit null check + typed ref: if (ref.value != null) ref.value.method()
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/file-tree/file-tree.uvue:344

- **类型**: `TYPE_REF_OPTIONAL` — ref 可选链
- **位置**: 第 344 行，第 1 列

```
popupFileTreeRef.value?.close();
```

**说明**: Optional chaining on ref: popupFileTreeRef.value?.method()
**修复**: Use explicit null check + typed ref: if (ref.value != null) ref.value.method()
---


### /Users/apple/workspace/nuwax-mobile/components/voice-recorder-button/voice-recorder-button.uvue:215

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 215 行，第 1 列

```
let duration = valOr(res.duration, 0)
```

**说明**: Property access on 'any' parameter: res.duration
**修复**: Cast to UTSJSONObject first: const obj = res as UTSJSONObject; then use obj["duration"]
---


### /Users/apple/workspace/nuwax-mobile/components/voice-recorder-button/voice-recorder-button.uvue:302

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 302 行，第 1 列

```
text: error.message,
```

**说明**: Property access on 'any' parameter: error.message
**修复**: Cast to UTSJSONObject first: const obj = error as UTSJSONObject; then use obj["message"]
---


### /Users/apple/workspace/nuwax-mobile/pages/index/index.uvue:130

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 130 行，第 1 列

```
jumpToAgentDetailPage(item.agentId, item.id, null, null);
```

**说明**: Property access on 'any' parameter: item.agentId
**修复**: Cast to UTSJSONObject first: const obj = item as UTSJSONObject; then use obj["agentId"]
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:374

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 374 行，第 1 列

```
let message = strOr(error.message, t("Mobile.AudioUploader.uploadFailed"));
```

**说明**: Property access on 'any' parameter: error.message
**修复**: Cast to UTSJSONObject first: const obj = error as UTSJSONObject; then use obj["message"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:232

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 232 行，第 1 列

```
const index = e.detail?.current ?? 0;
```

**说明**: Property access on 'any' parameter: e.detail
**修复**: Cast to UTSJSONObject first: const obj = e as UTSJSONObject; then use obj["detail"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/markdown-msg/markdown-msg.uvue:34

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 34 行，第 1 列

```
const { href } = event.detail
```

**说明**: Property access on 'any' parameter: event.detail
**修复**: Cast to UTSJSONObject first: const obj = event as UTSJSONObject; then use obj["detail"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:672

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 672 行，第 1 列

```
item.text = item.text.replace(/data="(\{.*?\})"/g, (_, json) => {
```

**说明**: Property access on 'any' parameter: item.text
**修复**: Cast to UTSJSONObject first: const obj = item as UTSJSONObject; then use obj["text"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:1109

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 1109 行，第 1 列

```
const input = valOr(data.result?.input, null);
```

**说明**: Property access on 'any' parameter: data.result
**修复**: Cast to UTSJSONObject first: const obj = data as UTSJSONObject; then use obj["result"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:1255

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 1255 行，第 1 列

```
updateMessageComponent(eventData.messageId, eventData.data);
```

**说明**: Property access on 'any' parameter: eventData.messageId
**修复**: Cast to UTSJSONObject first: const obj = eventData as UTSJSONObject; then use obj["messageId"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:1303

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 1303 行，第 1 列

```
if (conversationId.value === Number(event.conversationId)) {
```

**说明**: Property access on 'any' parameter: event.conversationId
**修复**: Cast to UTSJSONObject first: const obj = event as UTSJSONObject; then use obj["conversationId"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/file-tree/file-tree.uvue:225

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 225 行，第 1 列

```
const touch = e.touches?.[0];
```

**说明**: Property access on 'any' parameter: e.touches
**修复**: Cast to UTSJSONObject first: const obj = e as UTSJSONObject; then use obj["touches"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/file-tree/file-tree.uvue:241

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 241 行，第 1 列

```
const touch = e.touches?.[0];
```

**说明**: Property access on 'any' parameter: e.touches
**修复**: Cast to UTSJSONObject first: const obj = e as UTSJSONObject; then use obj["touches"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue:295

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 295 行，第 1 列

```
cascaderMultipleValue.value = currentList.map((item: any) => strOr(item.value, ''))
```

**说明**: Property access on 'any' parameter: item.value
**修复**: Cast to UTSJSONObject first: const obj = item as UTSJSONObject; then use obj["value"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:111

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 111 行，第 1 列

```
if (typeof payload === "string") return payload.trim();
```

**说明**: Property access on 'any' parameter: payload.trim
**修复**: Cast to UTSJSONObject first: const obj = payload as UTSJSONObject; then use obj["trim"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:120

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 120 行，第 1 列

```
let value = strOr(event.detail.value, "");
```

**说明**: Property access on 'any' parameter: event.detail
**修复**: Cast to UTSJSONObject first: const obj = event as UTSJSONObject; then use obj["detail"]
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/webview/webview.uvue:114

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 114 行，第 1 列

```
const messages = e.detail.data;
```

**说明**: Property access on 'any' parameter: e.detail
**修复**: Cast to UTSJSONObject first: const obj = e as UTSJSONObject; then use obj["detail"]
---


### /Users/apple/workspace/nuwax-mobile/utils/chatService.uts:101

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 101 行，第 1 列

```
const errorValue = error != null && error.message != null ? error.message : error
```

**说明**: Property access on 'any' parameter: error.message
**修复**: Cast to UTSJSONObject first: const obj = error as UTSJSONObject; then use obj["message"]
---


### /Users/apple/workspace/nuwax-mobile/utils/common.uts:23

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 23 行，第 1 列

```
if (typeof value === "string" && value.length > 0) {
```

**说明**: Property access on 'any' parameter: value.length
**修复**: Cast to UTSJSONObject first: const obj = value as UTSJSONObject; then use obj["length"]
---


### /Users/apple/workspace/nuwax-mobile/utils/mockApiService.uts:409

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 409 行，第 1 列

```
message: error.message || 'API调用失败'
```

**说明**: Property access on 'any' parameter: error.message
**修复**: Cast to UTSJSONObject first: const obj = error as UTSJSONObject; then use obj["message"]
---


### /Users/apple/workspace/nuwax-mobile/utils/streamRequest.uts:50

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 50 行，第 1 列

```
if (error != null && error.message != null) {
```

**说明**: Property access on 'any' parameter: error.message
**修复**: Cast to UTSJSONObject first: const obj = error as UTSJSONObject; then use obj["message"]
---


### /Users/apple/workspace/nuwax-mobile/utils/streamRequest.uts:51

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 51 行，第 1 列

```
return String(error.message);
```

**说明**: Property access on 'any' parameter: error.message
**修复**: Cast to UTSJSONObject first: const obj = error as UTSJSONObject; then use obj["message"]
---


### /Users/apple/workspace/nuwax-mobile/utils/streamRequest.uts:153

- **类型**: `TYPE_ANY_PROP_ACCESS` — any 属性/下标访问
- **位置**: 第 153 行，第 1 列

```
if (data != null && data.completed === true) {
```

**说明**: Property access on 'any' parameter: data.completed
**修复**: Cast to UTSJSONObject first: const obj = data as UTSJSONObject; then use obj["completed"]
---


### /Users/apple/workspace/nuwax-mobile/hooks/useAuthInterceptor.uts:178

- **类型**: `TYPE_REF_ANY_METHOD` — ref<any> 方法调用
- **位置**: 第 178 行，第 1 列

```
loginPopupRef.value.open();
```

**说明**: Method call on ref<any>: loginPopupRef.value.open()
**修复**: Use typed ref: ref<SomeComponentInstance | null> instead of ref<any | null>
---


### /Users/apple/workspace/nuwax-mobile/pages/index/index.uvue:120

- **类型**: `TYPE_REF_ANY_METHOD` — ref<any> 方法调用
- **位置**: 第 120 行，第 1 列

```
agentListContentRef.value.loadData();
```

**说明**: Method call on ref<any>: agentListContentRef.value.loadData()
**修复**: Use typed ref: ref<SomeComponentInstance | null> instead of ref<any | null>
---


### /Users/apple/workspace/nuwax-mobile/pages/index/index.uvue:123

- **类型**: `TYPE_REF_ANY_METHOD` — ref<any> 方法调用
- **位置**: 第 123 行，第 1 列

```
conversationListContentRef.value.loadData();
```

**说明**: Method call on ref<any>: conversationListContentRef.value.loadData()
**修复**: Use typed ref: ref<SomeComponentInstance | null> instead of ref<any | null>
---


### /Users/apple/workspace/nuwax-mobile/pages/index/index.uvue:296

- **类型**: `TYPE_REF_ANY_METHOD` — ref<any> 方法调用
- **位置**: 第 296 行，第 1 列

```
headerMenuRef.value.closeDropdown();
```

**说明**: Method call on ref<any>: headerMenuRef.value.closeDropdown()
**修复**: Use typed ref: ref<SomeComponentInstance | null> instead of ref<any | null>
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/login/components/captcha-verify/captcha-verify.uvue:286

- **类型**: `TYPE_REF_ANY_METHOD` — ref<any> 方法调用
- **位置**: 第 286 行，第 1 列

```
captchaInputRef.value.focus();
```

**说明**: Method call on ref<any>: captchaInputRef.value.focus()
**修复**: Use typed ref: ref<SomeComponentInstance | null> instead of ref<any | null>
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/temporary-session/temporary-session.uvue:111

- **类型**: `TYPE_REF_ANY_METHOD` — ref<any> 方法调用
- **位置**: 第 111 行，第 1 列

```
loginPopupRef.value.open();
```

**说明**: Method call on ref<any>: loginPopupRef.value.open()
**修复**: Use typed ref: ref<SomeComponentInstance | null> instead of ref<any | null>
---


### /Users/apple/workspace/nuwax-mobile/components/aliyun-captcha/aliyun-captcha.uvue:115

- **类型**: `TYPE_WATCH_GETTER_BOOL` — watch getter 返回类型
- **位置**: 第 115 行，第 1 列

```
watch(() => props.config, (newVal) => {
```

**说明**: watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"
**修复**: Use computed wrapper: watch(computed(() => props.xxx), ...)
---


### /Users/apple/workspace/nuwax-mobile/components/aliyun-captcha-h5/aliyun-captcha-h5.uvue:115

- **类型**: `TYPE_WATCH_GETTER_BOOL` — watch getter 返回类型
- **位置**: 第 115 行，第 1 列

```
watch(() => props.config, (newVal) => {
```

**说明**: watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"
**修复**: Use computed wrapper: watch(computed(() => props.xxx), ...)
---


### /Users/apple/workspace/nuwax-mobile/components/segmented-control/segmented-control.uvue:44

- **类型**: `TYPE_WATCH_GETTER_BOOL` — watch getter 返回类型
- **位置**: 第 44 行，第 1 列

```
watch(() => props.modelValue, (newValue) => {
```

**说明**: watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"
**修复**: Use computed wrapper: watch(computed(() => props.xxx), ...)
---


### /Users/apple/workspace/nuwax-mobile/pages/index/header-menu/header-menu.uvue:77

- **类型**: `TYPE_WATCH_GETTER_BOOL` — watch getter 返回类型
- **位置**: 第 77 行，第 1 列

```
watch(
  () => props.userInfo,
```

**说明**: watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"
**修复**: Use computed wrapper: watch(computed(() => props.xxx), ...)
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/model-select-modal/model-select-modal.uvue:89

- **类型**: `TYPE_WATCH_GETTER_BOOL` — watch getter 返回类型
- **位置**: 第 89 行，第 1 列

```
watch(() => props.visible, (newVal) => {
```

**说明**: watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"
**修复**: Use computed wrapper: watch(computed(() => props.xxx), ...)
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/skill-select-modal/skill-select-modal.uvue:338

- **类型**: `TYPE_WATCH_GETTER_BOOL` — watch getter 返回类型
- **位置**: 第 338 行，第 1 列

```
watch(
  () => props.visible,
```

**说明**: watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"
**修复**: Use computed wrapper: watch(computed(() => props.xxx), ...)
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue:179

- **类型**: `TYPE_WATCH_GETTER_BOOL` — watch getter 返回类型
- **位置**: 第 179 行，第 1 列

```
watch(() => props.userFillVariables, (newVal) => {
```

**说明**: watch(() => props.xxx) may cause "Return type mismatch: expected Function, actual Boolean"
**修复**: Use computed wrapper: watch(computed(() => props.xxx), ...)
---


### /Users/apple/workspace/nuwax-mobile/components/radio-list-drawer/radio-list-drawer.uvue:54

- **类型**: `TYPE_BOOLEAN_NULLABLE_OR` — nullable 布尔 || 模板
- **位置**: 第 54 行，第 1 列

```
:disabled="readonly == true || item.disabled == true"
```

**说明**: Nullable boolean || in template: true || item
**修复**: Use == true: true == true || item == true
---


### /Users/apple/workspace/nuwax-mobile/hooks/useAuthInterceptor.uts:52

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 52 行，第 1 列

```
return mpToken != null && String(mpToken).length > 0;
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/agentDev.uts:165

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 165 行，第 1 列

```
code: String(res.statusCode),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:202

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 202 行，第 1 列

```
code: String(res.statusCode),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:36

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 36 行，第 1 列

```
currentLang = String(strOr(currentLang, DEFAULT_LANG)).toLowerCase();
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:41

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 41 行，第 1 列

```
const hasAccessToken = accessToken != null && String(accessToken).length > 0;
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:123

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 123 行，第 1 列

```
if (currentUrl != null && String(currentUrl).length > 0) {
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:126

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 126 行，第 1 列

```
String(globalThis.appConfig.redirectUrl).length > 0
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:208

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 208 行，第 1 列

```
strOr(response.statusText, String(response.status)),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:225

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 225 行，第 1 列

```
error instanceof Error ? error : new Error(String(error));
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:241

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 241 行，第 1 列

```
error instanceof Error ? error : new Error(String(error));
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:256

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 256 行，第 1 列

```
error instanceof Error ? error : new Error(String(error));
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:984

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 984 行，第 1 列

```
const hasAgentId = params.id != null && String(params.id).length > 0;
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:988

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 988 行，第 1 列

```
const hasPayload = payload != null && String(payload).length > 0;
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/more-info/more-info.uvue:76

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 76 行，第 1 列

```
const first = String(name).trim().charAt(0);
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:113

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 113 行，第 1 列

```
const direct = String(strOr(payload?.text, strOr(payload?.content, ""))).trim();
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:116

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 116 行，第 1 列

```
const delta = String(strOr(payload?.delta?.content, "")).trim();
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:133

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 133 行，第 1 列

```
const normalized = String(strOr(eventType as string, ""))
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:355

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 355 行，第 1 列

```
String(strOr(responseData?.outputText, strOr(responseData?.output_text, ""))),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:630

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 630 行，第 1 列

```
const rawChunk = String(strOr(chunk, "")).trim();
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:811

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 811 行，第 1 列

```
error: String(strOr((error as any)?.message, String(error))),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:868

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 868 行，第 1 列

```
error: String(strOr((error as any)?.message, String(error))),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:926

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 926 行，第 1 列

```
String(this.data.conversationId.value),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:1039

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 1039 行，第 1 列

```
const personalSandboxId = String(agentInfo.sandboxId);
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:1078

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 1078 行，第 1 列

```
const sharedSandboxId = String(conversationInfo.sandboxServerId);
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/utils/customActionService.uts:143

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 143 行，第 1 列

```
const idStr = String(conversationId)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/utils/customActionService.uts:173

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 173 行，第 1 列

```
const idStr = String(conversationId)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/utils/customActionService.uts:200

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 200 行，第 1 列

```
const idStr = String(conversationId)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/utils/customActionService.uts:231

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 231 行，第 1 列

```
.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/subpackages/utils/customActionService.uts:265

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 265 行，第 1 列

```
.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/chatService.uts:44

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 44 行，第 1 列

```
const hasToken = token != null && String(token).length > 0
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/chatService.uts:103

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 103 行，第 1 列

```
error: String(errorValue),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/chatService.uts:126

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 126 行，第 1 列

```
error: String(catchError),
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/common.uts:133

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 133 行，第 1 列

```
params[key] = String(optionValue);
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:143

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 143 行，第 1 列

```
const idStr = String(conversationId)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:173

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 173 行，第 1 列

```
const idStr = String(conversationId)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:200

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 200 行，第 1 列

```
const idStr = String(conversationId)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:231

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 231 行，第 1 列

```
.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/customActionService.uts:265

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 265 行，第 1 列

```
.map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/fileLogger.uts:22

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 22 行，第 1 列

```
return String(payload);
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/fileLogger.uts:68

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 68 行，第 1 列

```
const userDataPath = String(envObj?.USER_DATA_PATH ?? "").trim();
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/streamRequest.uts:51

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 51 行，第 1 列

```
return String(error.message);
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/streamRequest.uts:53

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 53 行，第 1 列

```
return String(error);
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/system.uts:26

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 26 行，第 1 列

```
const MM = String(date.getMonth() + 1).padStart(2, "0");
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/system.uts:27

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 27 行，第 1 列

```
const DD = String(date.getDate()).padStart(2, "0");
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/system.uts:28

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 28 行，第 1 列

```
const HH = String(date.getHours()).padStart(2, "0");
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/utils/system.uts:29

- **类型**: `TYPE_STRING_CTOR` — String() 构造
- **位置**: 第 29 行，第 1 列

```
const mm = String(date.getMinutes()).padStart(2, "0");
```

**说明**: String() constructor not supported in UTS for type conversion
**修复**: Use template literal: `${expr}`
---


### /Users/apple/workspace/nuwax-mobile/components/app-icon/app-icon.uvue:77

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 77 行，第 1 列

```
const parsed = parseInt(strOr(valOr(sizeValue, "16") as string, "16"));
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/components/pane-tabs/pane-tabs.uvue:139

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 139 行，第 1 列

```
const screenWidth = (valOr(systemInfo.windowWidth, 375) as number);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/pages/index/conversation-list-content/conversation-list-content.uvue:139

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 139 行，第 1 列

```
const newList = (valOr(data, [])) as ConversationInfo[];
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/chat-input-phone.uvue:576

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 576 行，第 1 列

```
valOr(files.value?.reduce(
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/chat-input-phone.uvue:586

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 586 行，第 1 列

```
valOr(files.value?.reduce(
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/chat-input-phone.uvue:880

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 880 行，第 1 列

```
size: valOr(data?.size, 0),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/components/chat-input-phone/chat-input-phone.uvue:1205

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 1205 行，第 1 列

```
files.value = valOr(files.value?.filter((file) => file.uid !== uid), []);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-detail/agent-detail.uvue:18

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 18 行，第 1 列

```
const componentRef = valOr(proxy?.$refs?.chatConversationComponentRef, proxy?.chatConversationComponentRef)
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-detail/agent-detail.uvue:28

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 28 行，第 1 列

```
const componentRef = valOr(proxy?.$refs?.chatConversationComponentRef, proxy?.chatConversationComponentRef)
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-detail/agent-detail.uvue:46

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 46 行，第 1 列

```
const componentRef = valOr(proxy?.$refs?.chatConversationComponentRef, proxy?.chatConversationComponentRef)
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-detail/agent-detail.uvue:56

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 56 行，第 1 列

```
const componentRef = valOr(proxy?.$refs?.chatConversationComponentRef, proxy?.chatConversationComponentRef)
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-search/agent-search.uvue:391

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 391 行，第 1 列

```
const nameMatch = valOr(item.name?.toLowerCase().includes(lowerKeyword), false)
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/agent-search/agent-search.uvue:392

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 392 行，第 1 列

```
const descMatch = valOr(item.description?.toLowerCase().includes(lowerKeyword), false)
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/category-agent-list/category-agent-list.uvue:115

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 115 行，第 1 列

```
categoryItems.value = valOr(data.categoryItems?.[categoryKey.value], []);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:242

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 242 行，第 1 列

```
:expand-page-area="valOr(agentInfo?.expandPageArea, ExpandPageAreaEnum.No)"
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:244

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 244 行，第 1 列

```
:manual-components="valOr(agentInfo?.manualComponents, [])"
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:754

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 754 行，第 1 列

```
variableParams: valOr(newConversationSetRef.value?.variableParams, null),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:844

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 844 行，第 1 列

```
files: valOr(agentDetailInputPhoneRef.value?.files, []),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:846

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 846 行，第 1 列

```
valOr(agentDetailInputPhoneRef.value?.selectedComponents, []),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:971

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 971 行，第 1 列

```
eventBindConfig.value = valOr(res.data?.agent?.eventBindConfig, null);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/chat-conversation-component.uvue:1109

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 1109 行，第 1 列

```
const input = valOr(data.result?.input, null);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/agent-conversation-history/agent-conversation-history.uvue:109

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 109 行，第 1 列

```
const newList = (valOr(data, [])) as ConversationInfo[];
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue:264

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 264 行，第 1 列

```
formData[currentName.value] = valOr(selectedOptions?.map(item => item.value), [])
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/components/new-conversation-set/new-conversation-set.uvue:286

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 286 行，第 1 列

```
options.value = valOr(item.selectConfig?.options, [])
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:176

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 176 行，第 1 列

```
valOr(responseData?.agent?.manualComponents, []);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:182

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 182 行，第 1 列

```
const _variables = valOr(responseData?.agent?.variables, []);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:185

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 185 行，第 1 列

```
this.data.userFillVariables.value = valOr(responseData?.variables, {});
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:187

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 187 行，第 1 列

```
const _messageList = valOr(responseData?.messageList, []);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:189

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 189 行，第 1 列

```
const len = valOr(_messageList?.filter((item) => !!item.id).length, 0);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:238

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 238 行，第 1 列

```
valOr(responseData?.agent?.guidQuestionDtos?.slice(0, 5), []);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:270

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 270 行，第 1 列

```
const currentIndex = valOr(firstMessage?.index, 0);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:414

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 414 行，第 1 列

```
...valOr(currentMessage?.processingList, []),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:812

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 812 行，第 1 列

```
len: valOr(normalizedChunk?.length, 0),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:1022

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 1022 行，第 1 列

```
valOr(this.data.agentId.value, valOr(this.data.agentInfo.value?.agentId, 0)),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:1140

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 1140 行，第 1 列

```
valOr(this.data.agentId.value, valOr(this.data.agentInfo.value?.agentId, 0)),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:1619

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 1619 行，第 1 列

```
const _variables = valOr(responseData?.variables, []);
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/subpackages/utils/fileTree.uts:124

- **类型**: `TYPE_VALOR_NULLABLE` — valOr nullable 类型
- **位置**: 第 124 行，第 1 列

```
: valOr(file.contents?.length, FILE_CONSTANTS.FALLBACK_SIZE),
```

**说明**: valOr() with nullable typed value may cause type mismatch
**修复**: Use explicit ternary: value != null ? value : defaultValue
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:60

- **类型**: `UTS110111125` — Utility Types
- **位置**: 第 60 行，第 1 列

```
constructor(config: Partial<UploadConfig> = {}) {
```

**说明**: Utility type 'Partial' not supported in UTS
**修复**: Manually define equivalent type with type keyword
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:402

- **类型**: `UTS110111125` — Utility Types
- **位置**: 第 402 行，第 1 列

```
updateConfig(config: Partial<UploadConfig>): void {
```

**说明**: Utility type 'Partial' not supported in UTS
**修复**: Manually define equivalent type with type keyword
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:418

- **类型**: `UTS110111125` — Utility Types
- **位置**: 第 418 行，第 1 列

```
config?: Partial<UploadConfig>,
```

**说明**: Utility type 'Partial' not supported in UTS
**修复**: Manually define equivalent type with type keyword
---


### /Users/apple/workspace/nuwax-mobile/utils/i18n-third-party.uts:41

- **类型**: `UTS110111125` — Utility Types
- **位置**: 第 41 行，第 1 列

```
overrides: Partial<UniLoadMoreContentText> = {},
```

**说明**: Utility type 'Partial' not supported in UTS
**修复**: Manually define equivalent type with type keyword
---


### /Users/apple/workspace/nuwax-mobile/subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts:57

- **类型**: `TYPE_NPM_IMPORT` — 非 UTS 兼容 import
- **位置**: 第 57 行，第 1 列

```
import { v4 as uuidv4 } from "uuid";
```

**说明**: Non-UTS-compatible npm import: 'uuid'
**修复**: Wrap in #ifdef WEB conditional compilation or find UTS-compatible alternative
---


### /Users/apple/workspace/nuwax-mobile/components/app-icon/app-icon.uvue:84

- **类型**: `TYPE_MAP_INDEX_TYPED` — 下标访问 Any? 传类型参数
- **位置**: 第 84 行，第 1 列

```
return strOr(iconColorMap[iconName.value] as string | null, "#333");
```

**说明**: strOr(iconColorMap[...]) — indexed access returns Any?, expected String?
**修复**: Cast result: strOr(iconColorMap[iconName.value] as string | null, ...)
---


### /Users/apple/workspace/nuwax-mobile/components/app-icon/app-icon.uvue:89

- **类型**: `TYPE_MAP_INDEX_TYPED` — 下标访问 Any? 传类型参数
- **位置**: 第 89 行，第 1 列

```
const mapped = strOr(iconTypeMap[raw] as string | null, "");
```

**说明**: strOr(iconTypeMap[...]) — indexed access returns Any?, expected String?
**修复**: Cast result: strOr(iconTypeMap[raw] as string | null, ...)
---


### /Users/apple/workspace/nuwax-mobile/constants/i18n.local.constants.uts:163

- **类型**: `TYPE_MAP_INDEX_TYPED` — 下标访问 Any? 传类型参数
- **位置**: 第 163 行，第 1 列

```
strOr(I18N_FALLBACK_BUNDLES[defaultBundleKey]?.[key], ""),
```

**说明**: strOr(I18N_FALLBACK_BUNDLES[...]) — indexed access returns Any?, expected String?
**修复**: Cast result: strOr(I18N_FALLBACK_BUNDLES[defaultBundleKey] as string | null, ...)
---


### /Users/apple/workspace/nuwax-mobile/constants/i18n.local.constants.uts:168

- **类型**: `TYPE_MAP_INDEX_TYPED` — 下标访问 Any? 传类型参数
- **位置**: 第 168 行，第 1 列

```
return strOr(I18N_LITERAL_LOOKUP[value], value);
```

**说明**: strOr(I18N_LITERAL_LOOKUP[...]) — indexed access returns Any?, expected String?
**修复**: Cast result: strOr(I18N_LITERAL_LOOKUP[value] as string | null, ...)
---


### /Users/apple/workspace/nuwax-mobile/constants/i18n.local.constants.uts:172

- **类型**: `TYPE_MAP_INDEX_TYPED` — 下标访问 Any? 传类型参数
- **位置**: 第 172 行，第 1 列

```
return strOr(zhFallback[key], key);
```

**说明**: strOr(zhFallback[...]) — indexed access returns Any?, expected String?
**修复**: Cast result: strOr(zhFallback[key] as string | null, ...)
---


### /Users/apple/workspace/nuwax-mobile/subpackages/utils/historyMessageAdapter.uts:64

- **类型**: `TYPE_MAP_INDEX_TYPED` — 下标访问 Any? 传类型参数
- **位置**: 第 64 行，第 1 列

```
const attrString = strOr(match[1], strOr(match[2], ''))
```

**说明**: strOr(match[...]) — indexed access returns Any?, expected String?
**修复**: Cast result: strOr(match[1] as string | null, ...)
---


### /Users/apple/workspace/nuwax-mobile/utils/historyMessageAdapter.uts:64

- **类型**: `TYPE_MAP_INDEX_TYPED` — 下标访问 Any? 传类型参数
- **位置**: 第 64 行，第 1 列

```
const attrString = strOr(match[1], strOr(match[2], ''))
```

**说明**: strOr(match[...]) — indexed access returns Any?, expected String?
**修复**: Cast result: strOr(match[1] as string | null, ...)
---


### /Users/apple/workspace/nuwax-mobile/constants/i18n-locales/en-us.uts:114

- **类型**: `UTS110111149` — delete 运算符
- **位置**: 第 114 行，第 1 列

```
"Are you sure you want to delete this agent?",
```

**说明**: delete operator not supported in UTS
**修复**: Set property to null instead: obj.prop = null
---


### /Users/apple/workspace/nuwax-mobile/constants/i18n-locales/en-us.uts:139

- **类型**: `UTS110111149` — delete 运算符
- **位置**: 第 139 行，第 1 列

```
"You already have {count} files. Please delete some and reselect",
```

**说明**: delete operator not supported in UTS
**修复**: Set property to null instead: obj.prop = null
---


### /Users/apple/workspace/nuwax-mobile/constants/i18n-locales/en-us.uts:142

- **类型**: `UTS110111149` — delete 运算符
- **位置**: 第 142 行，第 1 列

```
"You already have {count} images. Please delete some and reselect",
```

**说明**: delete operator not supported in UTS
**修复**: Set property to null instead: obj.prop = null
---


### /Users/apple/workspace/nuwax-mobile/utils/pinyin.uts:9524

- **类型**: `UTS110111149` — delete 运算符
- **位置**: 第 9524 行，第 1 列

```
pre.delete = true;
```

**说明**: delete operator not supported in UTS
**修复**: Set property to null instead: obj.prop = null
---


### /Users/apple/workspace/nuwax-mobile/servers/audioUploader.uts:137

- **类型**: `UTS110111158` — throw 非 Error
- **位置**: 第 137 行，第 1 列

```
throw this.formatError(error);
```

**说明**: Only Error instances can be thrown in UTS
**修复**: Use throw new Error("message") instead
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:243

- **类型**: `UTS110111158` — throw 非 Error
- **位置**: 第 243 行，第 1 列

```
throw normalizedError; // 停止自动重试
```

**说明**: Only Error instances can be thrown in UTS
**修复**: Use throw new Error("message") instead
---


### /Users/apple/workspace/nuwax-mobile/servers/useRequest.uts:258

- **类型**: `UTS110111158` — throw 非 Error
- **位置**: 第 258 行，第 1 列

```
throw normalized;
```

**说明**: Only Error instances can be thrown in UTS
**修复**: Use throw new Error("message") instead
---


### /Users/apple/workspace/nuwax-mobile/utils/mockApiService.uts:460

- **类型**: `UTS110111158` — throw 非 Error
- **位置**: 第 460 行，第 1 列

```
throw error
```

**说明**: Only Error instances can be thrown in UTS
**修复**: Use throw new Error("message") instead
---


### /Users/apple/workspace/nuwax-mobile/utils/streamRequest.uts:230

- **类型**: `UTS110111158` — throw 非 Error
- **位置**: 第 230 行，第 1 列

```
throw error; // 重新抛出非中止错误
```

**说明**: Only Error instances can be thrown in UTS
**修复**: Use throw new Error("message") instead
---

