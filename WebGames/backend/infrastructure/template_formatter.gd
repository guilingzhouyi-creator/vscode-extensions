# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Text Template Engine)
# 文件路径: res://backend/infrastructure/template_formatter.gd
# 架构定位: High-Performance Pure Formatter
# 依赖与触发: 上游: GameConfig, 全域47业务域, 前端视图 | 下游: 无外部依赖 | 配置: 无 | 信号: 无
# 职责说明: 全域统一命名占位符格式化引擎：基于「{param_name}」结构化占位符，执行单遍正则扫描、大小写键名自适应容错与安全降级替换，杜绝运行时崩溃与 %s/%d 割裂。
# 退出语义与设计依据: 退出码: 纯函数无退出码 | 设计依据: WebGames 统一文案与零硬编码契约
# ==============================================================================

## TemplateFormatter：High-Performance Pure Formatter
class_name TemplateFormatter
extends RefCounted

# ==============================================================================
# 一、状态与静态正则
# ==============================================================================

## 占位符正则：匹配 {字母/数字/下划线} 命名插槽（静态编译一次，全局复用零重建开销）
static var _regex: RegEx = RegEx.create_from_string(r"\{([a-zA-Z0-9_]+)\}")

# ==============================================================================
# 二、核心格式化算子 (Pure Functional)
# ==============================================================================

## 统一模板格式化算子：
## - template_str: 待填充模板字符串（如 "角色名长度须在 {min} 至 {max} 字符之间"）
## - params: 替换参数字典（键名支持大小写自适应匹配）
## - keep_unmatched: 若为 true，未匹配到的占位符保持原样保留；若为 false，则替换为 fallback_marker（若为空则保留原样）
static func format(
	template_str: String,
	params: Dictionary = {},
	keep_unmatched: bool = true,
	fallback_marker: String = ""
) -> String:
	if template_str.is_empty():
		return ""
	if params.is_empty() and keep_unmatched:
		return template_str

	var matches := _regex.search_all(template_str)
	if matches.is_empty():
		return template_str

	var result := template_str
	for m in matches:
		var key := m.get_string(1)
		var val_found: bool = false
		var val_str: String = ""

		if params.has(key):
			val_found = true
			val_str = str(params[key])
		elif params.has(key.to_lower()):
			val_found = true
			val_str = str(params[key.to_lower()])
		elif params.has(key.to_upper()):
			val_found = true
			val_str = str(params[key.to_upper()])

		var placeholder := "{" + key + "}"
		if val_found:
			result = result.replace(placeholder, val_str)
		elif not keep_unmatched:
			var replacement := fallback_marker if not fallback_marker.is_empty() else placeholder
			result = result.replace(placeholder, replacement)

	return result

## 检查模板中包含的所有参数名清单
static func extract_param_keys(template_str: String) -> Array[String]:
	var keys: Array[String] = []
	if template_str.is_empty():
		return keys
	var matches := _regex.search_all(template_str)
	for m in matches:
		var key := m.get_string(1)
		if not keys.has(key):
			keys.append(key)
	return keys

