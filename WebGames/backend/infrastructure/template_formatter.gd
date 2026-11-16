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

class CompiledTemplate:
	extends RefCounted
	var template_text: String = ""
	var literals: Array[String] = []
	var keys: Array[String] = []
	var lower_keys: Array[String] = []
	var upper_keys: Array[String] = []
	var tokens: Array[String] = []
	var unique_keys: Array[String] = []
	var unique_indices: PackedInt32Array = PackedInt32Array()
	var slot_count: int = 0
	var has_percent: bool = false

## 占位符正则：匹配 {字母/数字/下划线} 命名插槽（静态编译一次，全局复用零重建开销）
const MAX_COMPILED_CACHE_SIZE: int = 512
static var _placeholder_regex: RegEx = RegEx.create_from_string(r"\{([a-zA-Z0-9_]+)\}")
static var _compiled_template_cache: Dictionary = {}

static func _cache_compiled_template(template_text: String, regex_matches: Array) -> CompiledTemplate:
	if _compiled_template_cache.size() >= MAX_COMPILED_CACHE_SIZE:
		_compiled_template_cache.clear()
	var compiled_entry := CompiledTemplate.new()
	compiled_entry.template_text = template_text
	compiled_entry.has_percent = "%" in template_text
	var cursor_offset: int = 0
	for match_entry in regex_matches:
		var regex_match := match_entry as RegExMatch
		var match_start: int = regex_match.get_start(0)
		var match_end: int = regex_match.get_end(0)
		compiled_entry.literals.append(template_text.substr(cursor_offset, match_start - cursor_offset))
		var key_name: String = regex_match.get_string(1)
		compiled_entry.keys.append(key_name)
		compiled_entry.lower_keys.append(key_name.to_lower())
		compiled_entry.upper_keys.append(key_name.to_upper())
		compiled_entry.tokens.append(template_text.substr(match_start, match_end - match_start))
		cursor_offset = match_end
	compiled_entry.literals.append(template_text.substr(cursor_offset))
	compiled_entry.slot_count = compiled_entry.keys.size()
	compiled_entry.unique_indices.resize(compiled_entry.slot_count)
	for slot_index in range(compiled_entry.slot_count):
		var slot_key: String = compiled_entry.keys[slot_index]
		var found_index: int = compiled_entry.unique_keys.find(slot_key)
		if found_index < 0:
			found_index = compiled_entry.unique_keys.size()
			compiled_entry.unique_keys.append(slot_key)
		compiled_entry.unique_indices[slot_index] = found_index
	_compiled_template_cache[template_text] = compiled_entry
	return compiled_entry

## 编译并缓存模板结构（供高频文案渲染直接持用 Typed CompiledTemplate 引用）
static func compile_cached(template_text: String) -> CompiledTemplate:
	var cached: Variant = _compiled_template_cache.get(template_text, null)
	if cached != null:
		return cached as CompiledTemplate
	if template_text.is_empty() or not template_text.contains("{"):
		return _cache_compiled_template(template_text, [])
	return _cache_compiled_template(template_text, _placeholder_regex.search_all(template_text))

static func _resolve_cached_slot_text(
	parameters: Dictionary,
	exact_key: String,
	lower_key: String,
	upper_key: String,
	raw_token: String,
	should_keep_unmatched: bool,
	fallback_marker: String
) -> String:
	if parameters.has(exact_key):
		return str(parameters[exact_key])
	if parameters.has(lower_key):
		return str(parameters[lower_key])
	if parameters.has(upper_key):
		return str(parameters[upper_key])
	if not should_keep_unmatched and not fallback_marker.is_empty():
		return fallback_marker
	return raw_token

static func _format_from_cache(
	compiled_entry: CompiledTemplate,
	parameters: Dictionary,
	should_keep_unmatched: bool,
	fallback_marker: String
) -> String:
	var key_count: int = compiled_entry.slot_count
	if key_count == 0:
		return compiled_entry.template_text
	var placeholder_keys := compiled_entry.keys
	var literal_segments := compiled_entry.literals
	var lower_keys := compiled_entry.lower_keys
	var upper_keys := compiled_entry.upper_keys
	var raw_tokens := compiled_entry.tokens
	if key_count == 1:
		var replacement_text := _resolve_cached_slot_text(
			parameters, placeholder_keys[0], lower_keys[0], upper_keys[0], raw_tokens[0], should_keep_unmatched, fallback_marker
		)
		return literal_segments[0] + replacement_text + literal_segments[1]
	if key_count == 2:
		var first_text := _resolve_cached_slot_text(
			parameters, placeholder_keys[0], lower_keys[0], upper_keys[0], raw_tokens[0], should_keep_unmatched, fallback_marker
		)
		var second_text := _resolve_cached_slot_text(
			parameters, placeholder_keys[1], lower_keys[1], upper_keys[1], raw_tokens[1], should_keep_unmatched, fallback_marker
		)
		return literal_segments[0] + first_text + literal_segments[1] + second_text + literal_segments[2]
	var output_parts := PackedStringArray()
	output_parts.resize(key_count * 2 + 1)
	output_parts[0] = literal_segments[0]
	for slot_index in range(key_count):
		output_parts[slot_index * 2 + 1] = _resolve_cached_slot_text(
			parameters, placeholder_keys[slot_index], lower_keys[slot_index], upper_keys[slot_index],
			raw_tokens[slot_index], should_keep_unmatched, fallback_marker
		)
		output_parts[slot_index * 2 + 2] = literal_segments[slot_index + 1]
	return "".join(output_parts)

## 使用预编译模板按位置数组直出结果（零 Dictionary 哈希查找开销）
static func format_compiled_indexed(compiled_entry: CompiledTemplate, positional_values: Array) -> String:
	if compiled_entry == null:
		return ""
	if compiled_entry.template_text.is_empty():
		return ""
	if positional_values.is_empty():
		return compiled_entry.template_text
	var slot_count: int = compiled_entry.slot_count
	if slot_count == 0:
		if compiled_entry.has_percent:
			return compiled_entry.template_text % positional_values
		return compiled_entry.template_text
	var literal_segments := compiled_entry.literals
	var raw_tokens := compiled_entry.tokens
	var unique_indices := compiled_entry.unique_indices
	var argument_count: int = positional_values.size()
	if slot_count == 1:
		var argument_slot: int = unique_indices[0]
		var first_text := str(positional_values[argument_slot]) if argument_slot < argument_count else raw_tokens[0]
		return literal_segments[0] + first_text + literal_segments[1]
	if slot_count == 2:
		var first_slot: int = unique_indices[0]
		var second_slot: int = unique_indices[1]
		var first_text := str(positional_values[first_slot]) if first_slot < argument_count else raw_tokens[0]
		var second_text := str(positional_values[second_slot]) if second_slot < argument_count else raw_tokens[1]
		return literal_segments[0] + first_text + literal_segments[1] + second_text + literal_segments[2]
	var output_parts := PackedStringArray()
	output_parts.resize(slot_count * 2 + 1)
	output_parts[0] = literal_segments[0]
	for slot_index in range(slot_count):
		var mapped_index: int = unique_indices[slot_index]
		output_parts[slot_index * 2 + 1] = str(positional_values[mapped_index]) if mapped_index < argument_count else raw_tokens[slot_index]
		output_parts[slot_index * 2 + 2] = literal_segments[slot_index + 1]
	return "".join(output_parts)

## 按顺序参数数组直接格式化模板，避免中间 Dictionary 参数表构造
static func format_indexed(template_text: String, positional_values: Array) -> String:
	if template_text.is_empty():
		return ""
	if positional_values.is_empty():
		return template_text
	if not template_text.contains("{"):
		if "%" in template_text:
			return template_text % positional_values
		return template_text
	return format_compiled_indexed(compile_cached(template_text), positional_values)

# ==============================================================================
# 二、核心格式化算子 (Pure Functional)
# ==============================================================================

## 统一模板格式化算子：
## - template_text: 待填充模板字符串（如 "角色名长度须在 {min} 至 {max} 字符之间"）
## - parameters: 替换参数字典（键名支持大小写自适应匹配）
## - should_keep_unmatched: 若为 true，未匹配到的占位符保持原样保留；若为 false，则替换为 fallback_marker（若为空则保留原样）
static func format(
	template_text: String,
	parameters: Dictionary = {},
	should_keep_unmatched: bool = true,
	fallback_marker: String = ""
) -> String:
	if template_text.is_empty():
		return ""
	if not template_text.contains("{"):
		return template_text
	if parameters.is_empty() and should_keep_unmatched:
		return template_text
	return _format_from_cache(compile_cached(template_text), parameters, should_keep_unmatched, fallback_marker)

## 检查模板中包含的所有参数名清单
static func extract_param_keys(template_text: String) -> Array[String]:
	if template_text.is_empty() or not template_text.contains("{"):
		return []
	return compile_cached(template_text).unique_keys.duplicate()
