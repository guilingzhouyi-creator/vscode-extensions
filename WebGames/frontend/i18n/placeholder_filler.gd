# ==============================================================================
# 卡拉尔世界引擎 - 占位符填充器
# 文件路径: res://frontend/i18n/placeholder_filler.gd
# 职责: 将业务数据填充到 i18n 翻译模板的 {param} 占位符中
# 数据流: 翻译模板 + 业务数据字典 → 填充后的最终文本
# 边界: 不做语言转换, 不做布局调整, 不含业务判断
# ==============================================================================
class_name PlaceholderFiller
extends RefCounted

## 填充主入口: fill(template, data) → 最终文本
## template: "金币: {amount}"  data: {"amount": 5000} → "金币: 5000"
static func fill(template: String, data: Dictionary) -> String:
	var result := template
	for key in data.keys():
		var token := "{" + str(key) + "}"
		var value: Variant = data[key]
		result = result.replace(token, _format_value(key, value))
	return result

## 批量填充: 同一模板 + 多组数据 → 多条文本
static func fill_batch(template: String, data_array: Array) -> Array:
	var results: Array = []
	for data in data_array:
		results.append(fill(template, data))
	return results

## 数值格式化: 依据「精确键名 + 受控后缀 + 值类型守卫」推断格式化策略
## ── A/TC-P82-S4-02 精度契约 ─────────────────────────────────────────────
## 收敛前缺陷：以 `key.find("time")` / `find("rate")` 之类的**子串匹配**推断语义，
## 导致两类误命中——①展示文本被二次加工（`time`="刚刚" → "0分00秒"；
## `rate`="3.5000" → "3%"）；②无关键名连带命中（`rate_limit`/`moderate` 含 "rate"、
## `timestamp` 含 "time"）。收敛后改为**精确键匹配 + 受控后缀**（`*_amount`/`*_percent`
## 等显式约定），并前置**值类型守卫**：非 int/float 的取值（String/其它）一律原样
## 输出，从根上杜绝「已格式化文本被再次当数值加工」。
static func _format_value(key: String, value: Variant) -> String:
	# 值类型守卫：仅数值类型参与格式化；展示型取值（String/Bool/容器等）原样透传
	if not (value is int or value is float):
		return str(value)

	var key_lower := key.to_lower()
	# R-25 int64 原生路径：int 不经 float 回转（>2^53 会丢精度），仅 float 走有限性防御
	var is_int := value is int
	var numeric := _to_finite_float(value)

	# 金额类: 千分位（精确键 amount/gold/copper + 受控后缀 *_amount/*_gold/*_copper）
	if key_lower in ["amount", "gold", "copper"] \
			or key_lower.ends_with("_amount") \
			or key_lower.ends_with("_gold") \
			or key_lower.ends_with("_copper"):
		return _format_thousands(value if is_int else int(numeric))

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

## 有限性/类型安全数值转换（R-02 边界防御）：仅接受 int/float/合法 String，
## 非有限（NaN/INF）与非法类型一律回落 0.0，杜绝 int(NAN)/float({}) 异常
static func _to_finite_float(value: Variant) -> float:
	if value is int or value is float:
		var f := float(value)
		return f if is_finite(f) else 0.0
	if value is String:
		var s: String = value
		return float(s) if s.is_valid_float() else 0.0
	return 0.0

## 千分位格式化: 5000 → "5,000"
static func _format_thousands(value: int) -> String:
	var s := str(abs(value))
	var result := ""
	var count := 0
	for i in range(s.length() - 1, -1, -1):
		if count > 0 and count % 3 == 0:
			result = "," + result
		result = s[i] + result
		count += 1
	if value < 0:
		result = "-" + result
	return result

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
	# 检测 {xxx} 模式
	var regex := RegEx.new()
	regex.compile("\\{[a-zA-Z_][a-zA-Z0-9_]*\\}")
	return regex.search(text) != null

## 提取模板中所有占位符名称（调试用）
static func extract_placeholders(template: String) -> Array:
	var regex := RegEx.new()
	regex.compile("\\{([a-zA-Z_][a-zA-Z0-9_]*)\\}")
	var results: Array = []
	for m in regex.search_all(template):
		results.append(m.get_string(1))
	return results
