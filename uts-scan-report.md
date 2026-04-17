# UTS 违规项扫描报告

生成时间：2024-04-17

## 扫描结果汇总

### 已修复的违规（之前处理过）

以下违规模式已在之前的修复中处理：

1. ✅ **v-if 中的 ?.length** - 所有模板中的 `v-if="array?.length"` 已修复为 `v-if="hasLen(array)"`
2. ✅ **script 中的 ?.length** - 所有 `if (array?.length)` 已修复为 `if (hasLen(array))`
3. ✅ **onLoad 行内对象类型** - 已提取为 `type OnLoadOptions = { ... }`
4. ✅ **ref<> 中的行内对象** - 已使用类型别名（如 `AgentListMap`、`Position` 等）

### 剩余违规项（需要修复）

#### 1. 非布尔表达式在 v-if 条件位置 (UTS110111120)

**文件：`components/chat-upload-image/chat-upload-image.uvue:33`**
```vue
v-if="file?.type?.includes('image/')"
```
修复：`v-if="file?.type != null && file?.type.includes('image/')"`

**文件：`components/button-wrapper/button-wrapper.uvue:13`**
```vue
v-if="item?.icon"
```
修复：`v-if="item?.icon != null && item.icon.length > 0"`

**文件：`components/menu-dropdown/menu-dropdown.uvue:11`**
```vue
v-if="item?.icon"
```
修复：`v-if="item?.icon != null && item.icon.length > 0"`

#### 2. Script 中的 !variable 取反（需要检查类型）

以下文件中存在 `if (!variable)` 模式，需要确认 `variable` 是否为布尔类型：

- `hooks/useAuthInterceptor.uts:84` - `if (!loggedIn)` - 需要检查 `loggedIn` 类型
- `utils/common.uts:142` - `if (!targetTime)` - 需要检查 `targetTime` 类型
- `utils/i18n.uts:344` - `if (!targetLang)` - 需要检查 `targetLang` 类型
- `utils/fileLogger.uts` 多处 - `if (!fs)` - 需要检查 `fs` 类型
- `subpackages/pages/chat-conversation-component/layers/AgentDetailService.uts` - 多处

这些需要人工检查，确保变量类型正确。

---

## 建议

1. **立即修复**：3 个 template 文件中的 `v-if` 违规
2. **人工检查**：script 中的 `!variable` 模式，确认类型是否正确
3. **继续编译验证**：修复后触发 Android 编译，看是否还有其他错误

---

## Ripgrep 扫描命令

用于重新扫描的命令集：

```bash
# Template 中的 ?. 和 ||
rg 'v-if="[^"]*"' --type-add 'vue:*.uvue' -t vue -n | grep -E '(\?|\|\|)' | grep -v uni_modules

# Script 中的 !variable
rg 'if\s*\(!\s*[a-zA-Z_]\w*\s*\)' --type-add 'uts:*.uts' -t uts -n

# onLoad 行内类型
find pages subpackages -name "*.uvue" | xargs grep -n "onLoad.*options.*{"

# 索引签名
rg '\[key:\s*string\]' --type-add 'uts:*.uts' -t uts -n
```
