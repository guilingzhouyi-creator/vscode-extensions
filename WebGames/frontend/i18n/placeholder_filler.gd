# ==============================================================================
# 模块归属: 前端国际化渲染层 (Frontend · i18n Placeholder Formatting)
# 文件路径: res://frontend/i18n/placeholder_filler.gd
# 架构定位: Pure Template Placeholder Formatter
# 依赖与触发: 上游: UITextResolver, KCurrencyBar | 下游: GameConfig
# 职责说明: 将业务数据按精确键名与类型守卫格式化后填充至 i18n 模板的 {param} 占位符，不含语言转换与布局逻辑。
# 退出语义与设计依据: 精确键匹配防误命中与 int64/有限浮点数边界防御契约
# ==============================================================================

## PlaceholderFiller：i18n 模板占位符替换与数值安全格式化工具
class_name PlaceholderFiller
extends RefCounted

static var _placeholder_regex: RegEx = RegEx.create_from_string(r"\{([a-zA-Z0-9_]+)\}")

## 填充主入口: fill(template, placeholder_payload) → 最终文本
## template: "金币: {amount}"  placeholder_payload: {"amount": 5000} → "金币: 5000"
static func fill(template: String, placeholder_payload: Dictionary) -> String:
	if template.is_empty():
		return ""
	if placeholder_payload.is_empty():
		return template

	var matches := _placeholder_regex.search_all(template)
	if matches.is_empty():
		return template

	var rendered_text := template
	for regex_match in matches:
		var placeholder_key := regex_match.get_string(1)
		var is_value_found: bool = false
		var raw_value: Variant = null

		if placeholder_payload.has(placeholder_key):
			is_value_found = true
			raw_value = placeholder_payload[placeholder_key]
		elif placeholder_payload.has(placeholder_key.to_lower()):
			is_value_found = true
			raw_value = placeholder_payload[placeholder_key.to_lower()]
		elif placeholder_payload.has(placeholder_key.to_upper()):
			is_value_found = true
			raw_value = placeholder_payload[placeholder_key.to_upper()]

		if is_value_found:
			var token := "{" + placeholder_key + "}"
			rendered_text = rendered_text.replace(token, _format_value(placeholder_key, raw_value))

	return rendered_text

## 批量填充: 同一模板 + 多组数据 → 多条文本
static func fill_batch(template: String, payload_entries: Array) -> Array:
	var rendered_entries: Array = []
	for entry_payload in payload_entries:
		rendered_entries.append(fill(template, entry_payload))
	return rendered_entries

## 数值格式化: 依据「精确键名 + 受控后缀 + 值类型守卫」推断格式化策略
## ── 精度与防误命中契约 ─────────────────────────────────────────────
## 采用精确键匹配与受控后缀（*_amount/*_percent 等显式约定），避免子串匹配误加工
## 展示文本或无关字段；前置值类型守卫确保非数值类型原样输出，不重复加工已格式化文本。
static func _format_value(placeholder_key: String, raw_value: Variant) -> String:
	# 值类型守卫：仅数值类型参与格式化；展示型取值（String/Bool/容器等）原样透传
	if not (raw_value is int or raw_value is float):
		return str(raw_value)

	var key_lower := placeholder_key.to_lower()
	# int64 原生路径：int 不经 float 回转（>2^53 会丢失精度），仅 float 走有限性防御
	var is_integer := raw_value is int
	var numeric_value := _to_finite_float(raw_value)

	# 金额类: 千分位（精确键 amount/gold/copper + 受控后缀 *_amount/*_gold/*_copper）
	if key_lower in ["amount", "gold", "copper"] \
			or key_lower.ends_with("_amount") \
			or key_lower.ends_with("_gold") \
			or key_lower.ends_with("_copper"):
		return format_thousands(raw_value if is_integer else int(numeric_value))

	# 百分比类: 精确键 percent + 受控后缀 *_percent（不再对 rate 子串误命中）
	if key_lower == "percent" or key_lower.ends_with("_percent"):
		if numeric_value <= 1.0:
			return str(int(numeric_value * 100.0)) + "%"
		return str(int(numeric_value)) + "%"

	# HP/MP 等数值对: 精确键 cur/max/current/maximum
	if key_lower in ["cur", "max", "current", "maximum"]:
		return str(raw_value) if is_integer else str(int(numeric_value))

	# 时长类: 精确键 duration/time/seconds + 受控后缀 *_duration/*_time/*_seconds
	if key_lower in ["duration", "time", "seconds"] \
			or key_lower.ends_with("_duration") \
			or key_lower.ends_with("_time") \
			or key_lower.ends_with("_seconds"):
		return _format_duration(numeric_value)

	# 默认: 数值原样转字符串（count/level/total/value 等计数与标尺类不额外加工）
	return str(raw_value)

## 有限性/类型安全数值转换边界防御：仅接受 int/float/合法 String，
## 非有限（NaN/INF）与非法类型一律回落 0.0，杜绝 int(NAN)/float({}) 异常
static func _to_finite_float(raw_value: Variant) -> float:
	if raw_value is int or raw_value is float:
		var float_value := float(raw_value)
		return float_value if is_finite(float_value) else 0.0
	if raw_value is String:
		var text_value: String = raw_value
		return float(text_value) if text_value.is_valid_float() else 0.0
	return 0.0

static var _unfilled_placeholder_regex: RegEx = null
static var _extract_placeholder_regex: RegEx = null

static func _get_unfilled_regex() -> RegEx:
	if _unfilled_placeholder_regex == null:
		_unfilled_placeholder_regex = RegEx.new()
		_unfilled_placeholder_regex.compile("\\{[a-zA-Z_][a-zA-Z0-9_]*\\}")
	return _unfilled_placeholder_regex

static func _get_extract_regex() -> RegEx:
	if _extract_placeholder_regex == null:
		_extract_placeholder_regex = RegEx.new()
		_extract_placeholder_regex.compile("\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}")
	return _extract_placeholder_regex

## 千分位格式化: 5000 → "5,000"
static func format_thousands(raw_integer: int) -> String:
	var digits_text := str(abs(raw_integer))
	var digit_count: int = digits_text.length()
	if digit_count <= 3:
		return ("-" + digits_text) if raw_integer < 0 else digits_text
	var groups: PackedStringArray = PackedStringArray()
	var end_index: int = digit_count
	while end_index > 0:
		var start_index: int = maxi(0, end_index - 3)
		groups.append(digits_text.substr(start_index, end_index - start_index))
		end_index = start_index
	groups.reverse()
	var formatted := ",".join(groups)
	return ("-" + formatted) if raw_integer < 0 else formatted

## 时长格式化: 125.0 → "2分05秒"
static func _format_duration(seconds: float) -> String:
	var safe_seconds := seconds if is_finite(seconds) else 0.0
	var minutes := int(safe_seconds) / 60
	var remaining_seconds := int(safe_seconds) % 60
	return "%d分%02d秒" % [minutes, remaining_seconds]

## 货币格式化: gold=5, silver=20, copper=500 → "5金20银500铜"
static func format_currency(gold: int, silver: int, copper: int) -> String:
	var parts: Array = []
	if gold > 0:
		parts.append(str(gold) + "金")
	if silver > 0 or gold > 0:
		parts.append(str(silver) + "银")
	parts.append(str(copper) + "铜")
	return "".join(parts)

## 稀有度名称映射（从配置表读取, 不硬编码）
static func format_rarity(rarity_key: String) -> String:
	return GameConfig.get_string("frontend.views", "rarity_labels/" + rarity_key, rarity_key)

## 检测模板中是否有未填充的占位符（验收用）
static func has_unfilled_placeholders(input_text: String) -> bool:
	return _get_unfilled_regex().search(input_text) != null

## 提取模板中所有占位符名称（调试用）
static func extract_placeholders(template: String) -> Array:
	var placeholder_names: Array = []
	for regex_match in _get_extract_regex().search_all(template):
		placeholder_names.append(regex_match.get_string(1))
	return placeholder_names
