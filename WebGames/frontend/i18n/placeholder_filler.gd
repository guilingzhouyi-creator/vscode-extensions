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

static var _regex: RegEx = RegEx.create_from_string(r"\{([a-zA-Z0-9_]+)\}")

## 填充主入口: fill(template, data) → 最终文本
## template: "金币: {amount}"  data: {"amount": 5000} → "金币: 5000"
static func fill(template: String, data: Dictionary) -> String:
	if template.is_empty():
		return ""
	if data.is_empty():
		return template

	var matches := _regex.search_all(template)
	if matches.is_empty():
		return template

	var result := template
	for regex_match in matches:
		var key := regex_match.get_string(1)
		var value_found: bool = false
		var raw_value: Variant = null

		if data.has(key):
			value_found = true
			raw_value = data[key]
		elif data.has(key.to_lower()):
			value_found = true
			raw_value = data[key.to_lower()]
		elif data.has(key.to_upper()):
			value_found = true
			raw_value = data[key.to_upper()]

		if value_found:
			var token := "{" + key + "}"
			result = result.replace(token, _format_value(key, raw_value))

	return result

## 批量填充: 同一模板 + 多组数据 → 多条文本
static func fill_batch(template: String, data_array: Array) -> Array:
	var results: Array = []
	for data in data_array:
		results.append(fill(template, data))
	return results

## 数值格式化: 依据「精确键名 + 受控后缀 + 值类型守卫」推断格式化策略
## ── 精度与防误命中契约 ─────────────────────────────────────────────
## 采用精确键匹配与受控后缀（*_amount/*_percent 等显式约定），避免子串匹配误加工
## 展示文本或无关字段；前置值类型守卫确保非数值类型原样输出，不重复加工已格式化文本。
static func _format_value(key: String, value: Variant) -> String:
	# 值类型守卫：仅数值类型参与格式化；展示型取值（String/Bool/容器等）原样透传
	if not (value is int or value is float):
		return str(value)

	var key_lower := key.to_lower()
	# int64 原生路径：int 不经 float 回转（>2^53 会丢失精度），仅 float 走有限性防御
	var is_int := value is int
	var numeric := _to_finite_float(value)

	# 金额类: 千分位（精确键 amount/gold/copper + 受控后缀 *_amount/*_gold/*_copper）
	if key_lower in ["amount", "gold", "copper"] \
			or key_lower.ends_with("_amount") \
			or key_lower.ends_with("_gold") \
			or key_lower.ends_with("_copper"):
		return format_thousands(value if is_int else int(numeric))

	# 百分比类: 精确键 percent + 受控后缀 *_percent（不再对 rate 子串误命中）
	if key_lower == "percent" or key_lower.ends_with("_percent"):
		if numeric <= 1.0:
			return str(int(numeric * 100.0)) + "%"
		return str(int(numeric)) + "%"

	# HP/MP 等数值对: 精确键 cur/max/current/maximum
	if key_lower in ["cur", "max", "current", "maximum"]:
		return str(value) if is_int else str(int(numeric))

	# 时长类: 精确键 duration/time/seconds + 受控后缀 *_duration/*_time/*_seconds
	if key_lower in ["duration", "time", "seconds"] \
			or key_lower.ends_with("_duration") \
			or key_lower.ends_with("_time") \
			or key_lower.ends_with("_seconds"):
		return _format_duration(numeric)

	# 默认: 数值原样转字符串（count/level/total/value 等计数与标尺类不额外加工）
	return str(value)

## 有限性/类型安全数值转换边界防御：仅接受 int/float/合法 String，
## 非有限（NaN/INF）与非法类型一律回落 0.0，杜绝 int(NAN)/float({}) 异常
static func _to_finite_float(value: Variant) -> float:
	if value is int or value is float:
		var float_value := float(value)
		return float_value if is_finite(float_value) else 0.0
	if value is String:
		var text_value: String = value
		return float(text_value) if text_value.is_valid_float() else 0.0
	return 0.0

static var _re_unfilled: RegEx = null
static var _re_extract: RegEx = null

static func _get_unfilled_regex() -> RegEx:
	if _re_unfilled == null:
		_re_unfilled = RegEx.new()
		_re_unfilled.compile("\\{[a-zA-Z_][a-zA-Z0-9_]*\\}")
	return _re_unfilled

static func _get_extract_regex() -> RegEx:
	if _re_extract == null:
		_re_extract = RegEx.new()
		_re_extract.compile("\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}")
	return _re_extract

## 千分位格式化: 5000 → "5,000"
static func format_thousands(value: int) -> String:
	var digits_text := str(abs(value))
	var digit_count: int = digits_text.length()
	if digit_count <= 3:
		return ("-" + digits_text) if value < 0 else digits_text
	var groups: PackedStringArray = PackedStringArray()
	var end_index: int = digit_count
	while end_index > 0:
		var start_index: int = maxi(0, end_index - 3)
		groups.append(digits_text.substr(start_index, end_index - start_index))
		end_index = start_index
	groups.reverse()
	var formatted := ",".join(groups)
	return ("-" + formatted) if value < 0 else formatted

## 时长格式化: 125.0 → "2分05秒"
static func _format_duration(seconds: float) -> String:
	var safe_seconds := seconds if is_finite(seconds) else 0.0
	var mins := int(safe_seconds) / 60
	var secs := int(safe_seconds) % 60
	return "%d分%02d秒" % [mins, secs]

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
static func has_unfilled_placeholders(text: String) -> bool:
	return _get_unfilled_regex().search(text) != null

## 提取模板中所有占位符名称（调试用）
static func extract_placeholders(template: String) -> Array:
	var results: Array = []
	for regex_match in _get_extract_regex().search_all(template):
		results.append(regex_match.get_string(1))
	return results
