# uni_modules 清理记录

## 背景
本次清理目标是收缩 `uni_modules` 目录体积，优先删除未使用模块、文档文件、演示壳文件和测试遗留文件，不涉及业务功能逻辑调整，也不主动修改仍在运行链路中的核心组件代码。

## 本次已删除内容
### 1. 整体删除的未使用模块
- `uni_modules/uni-table`
- `uni_modules/uni-datetime-picker`
- `uni_modules/uni-config-center`

### 2. 删除的文档类文件
- 各模块下的 `README.md` / `readme.md`
- 各模块下的 `CHANGELOG.md` / `changelog.md`
- `uni_modules/uni-ai-x/license.md`

### 3. 删除的 demo / 测试遗留文件
- `lime-*` 模块中仅用于演示的外层 demo 壳文件，例如 `components/lime-*/lime-*.(vue|uvue)`
- `uni_modules/lime-color/common/test.uts`
- `uni_modules/lime-checkbox/components/l-checkbox/l-checkbox_old.uvue`

## 保留原则
- 保留业务直接使用的模块与组件。
- 保留被依赖链间接使用的模块，例如 `lime-cascader` 依赖的一组 `lime-*` 基础模块。
- 保留运行时资源文件，例如字体、图标映射、GIF、富文本高亮资源。
- 保留平台兼容相关文件，避免影响 H5、微信小程序和 App 多端行为。

## 验证结果
- 已对删除目标做残留引用检索。
- 当前未发现新增悬空引用。
- 当前未发现新增 linter 报错。

## 后续建议
- 如需继续瘦身，优先继续盘点 `static/`、`docs/`、`unpackage/` 等目录中的可清理文件。
- 不建议继续直接删除 `uni_modules` 中的运行时代码或资源，除非先完成更细的依赖与平台验证。
