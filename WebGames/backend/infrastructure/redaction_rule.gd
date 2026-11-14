# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/redaction_rule.gd
# 架构定位: Log Collector & Stream Processor
# 依赖与触发: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/log.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 依据 log.json redaction 段配置对结构化日志 context 执行构造期脱敏， 支持 mask、drop、hash 三种安全模式，杜绝凭证落盘（Inv-LS-2 安全红线）。
# 退出语义与设计依据: 业务域第一性原理 / 统一结构化日志规范
# ==============================================================================

## RedactionRule：Log Collector & Stream Processor
class_name RedactionRule extends RefCounted

const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const CryptoIntegrityLib = preload("res://backend/infrastructure/pure/crypto_integrity_lib.gd")
const StatisticsMathLib = preload("res://backend/infrastructure/pure/statistics_math_lib.gd")

const MODE_MASK: String = LogConstants.REDACT_MODE_MASK
const MODE_DROP: String = LogConstants.REDACT_MODE_DROP
const MODE_HASH: String = LogConstants.REDACT_MODE_HASH
const MODE_SALTED_HASH: String = LogConstants.REDACT_MODE_SALTED_HASH

# ==============================================================================
# 一、脱敏规则条目实体
# ==============================================================================

## 单条脱敏规则：字段正则 + 脱敏模式（mask/drop/hash/salted_hash）与掩码参数
class RuleEntry extends RefCounted:
	var regex: RegEx = null
	var mask_mode: String = MODE_MASK # mask | drop | hash | salted_hash
	var mask_prefix_len: int = LogConstants.DEFAULT_MASK_PREFIX_LEN
	var mask_suffix_len: int = LogConstants.DEFAULT_MASK_SUFFIX_LEN
	var replace_with: String = LogConstants.DEFAULT_MASK_REPLACEMENT
	var salt: String = ""

# ==============================================================================
# 二、规则加载与配置
# ==============================================================================

static var _rules: Array[RuleEntry] = []
static var _enabled: bool = true
static var _default_mode: String = MODE_MASK
static var _cached_version: int = -2

## 测试复位：清空规则并恢复默认配置（避免跨用例状态残留）
static func reset_state() -> void:
	_rules.clear()
	_enabled = true
	_default_mode = MODE_MASK
	_cached_version = -2

## 规则新鲜度守卫：热重载版本变化时按 log.json redaction 段重建规则集
static func _ensure_loaded() -> void:
	var current_version := GameConfig.config_reload_version()
	if _cached_version == current_version:
		return
	_cached_version = current_version
	_rules.clear()

	var redaction_config := GameConfig.get_dict(LogConstants.CFG_LOG_TABLE, LogConstants.CFG_PATH_REDACTION, {})
	if redaction_config.is_empty():
		_enabled = true
		_default_mode = MODE_MASK
		_init_default_rules()
		return

	_enabled = bool(redaction_config.get("enabled", true))
	_default_mode = str(redaction_config.get("default_mode", MODE_MASK))
	var rules_array: Variant = redaction_config.get("rules", [])
	if rules_array is Array:
		for item in rules_array:
			if not (item is Dictionary):
				continue
			var entry := _build_rule_entry(item)
			if entry != null:
				_rules.append(entry)

## 内置默认脱敏规则（配置段缺失时安全回退：令牌/指纹掩码、口令丢弃、账号哈希）
static func _init_default_rules() -> void:
	var defaults: Array[Dictionary] = [
		{"field_pattern": "token|session_token|access_token|refresh_token|auth_token|nested_token|authorization|api_key|apikey|private_key|signing_key|client_secret", "mask_mode": MODE_MASK, "mask_prefix_len": LogConstants.DEFAULT_MASK_PREFIX_LEN, "mask_suffix_len": LogConstants.DEFAULT_MASK_SUFFIX_LEN, "replace_with": LogConstants.DEFAULT_MASK_REPLACEMENT},
		{"field_pattern": "fingerprint|device_fingerprint|email|ip_address", "mask_mode": MODE_MASK, "mask_prefix_len": LogConstants.DEFAULT_MASK_PREFIX_LEN, "mask_suffix_len": 0, "replace_with": LogConstants.DEFAULT_MASK_REPLACEMENT},
		{"field_pattern": "password|passwd|password_hash|secret|seal_key|hmac_secret|aes_key|master_secret|cookie", "mask_mode": MODE_DROP},
		{"field_pattern": "account_id", "mask_mode": MODE_HASH}
	]
	for item in defaults:
		var entry := _build_rule_entry(item)
		if entry != null:
			_rules.append(entry)

## 规则条目工厂：编译正则并构造规则实例（单点装配，提取自循环外）
static func _build_rule_entry(item: Dictionary) -> RuleEntry:
	var pattern := str(item.get("field_pattern", ""))
	if pattern.is_empty():
		return null
	var compiled_regex := RegEx.new()
	if compiled_regex.compile("(?i)^(" + pattern + ")$") != OK:
		return null
	var entry := RuleEntry.new()
	entry.regex = compiled_regex
	entry.mask_mode = str(item.get("mask_mode", MODE_MASK))
	entry.mask_prefix_len = int(item.get("mask_prefix_len", LogConstants.DEFAULT_MASK_PREFIX_LEN))
	entry.mask_suffix_len = int(item.get("mask_suffix_len", LogConstants.DEFAULT_MASK_SUFFIX_LEN))
	entry.replace_with = str(item.get("replace_with", LogConstants.DEFAULT_MASK_REPLACEMENT))
	entry.salt = str(item.get("salt", ""))
	return entry

# ==============================================================================
# 三、脱敏处理算法
# ==============================================================================

## 对 context 字典执行深层脱敏处理，返回 {"dict": masked_dict, "redacted_keys": Array[String]}
static func apply(dict: Dictionary) -> Dictionary:
	_ensure_loaded()
	if not _enabled or dict.is_empty():
		return {
			"dict": dict.duplicate(true),
			"redacted_keys": []
		}

	var redacted_keys: Array[String] = []
	var result_dict := _redact_dict(dict, redacted_keys)
	return {
		"dict": result_dict,
		"redacted_keys": redacted_keys
	}

## 对 context 与消息正文执行构造期脱敏并直接装配至 StructuredLogRecord（Inv-LS-2 安全红线）
static func apply_to_record(record: StructuredLogRecord, raw_context: Dictionary) -> void:
	if record == null:
		return
	var redacted := apply(raw_context)
	record.context = redacted.get("dict", {})
	record.redacted_keys.clear()
	var raw_redacted_keys: Variant = redacted.get("redacted_keys", [])
	if raw_redacted_keys is Array:
		for redacted_key in (raw_redacted_keys as Array):
			record.redacted_keys.append(str(redacted_key))
	if _enabled and not record.message.is_empty():
		var scrubbed_message := StatisticsMathLib.scrub_inline_secrets(record.message)
		if scrubbed_message != record.message:
			record.message = scrubbed_message
			if not (LogConstants.KEY_MESSAGE in record.redacted_keys):
				record.redacted_keys.append(LogConstants.KEY_MESSAGE)

static func _find_matching_rule(key_str: String) -> RuleEntry:
	for rule in _rules:
		if rule.regex != null and rule.regex.search(key_str) != null:
			return rule
	return null

## 递归脱敏字典：先匹配键名规则（防敏感键以嵌套字典/数组形态逃逸）；未命中时继续下钻容器或执行内联凭据二次清洗
static func _redact_dict(source: Dictionary, out_redacted_keys: Array[String]) -> Dictionary:
	var target: Dictionary = {}
	for entry_key in source.keys():
		var key_str := str(entry_key)
		var entry_value: Variant = source[entry_key]
		var matched_rule := _find_matching_rule(key_str)
		if matched_rule != null:
			if not (key_str in out_redacted_keys):
				out_redacted_keys.append(key_str)
			match matched_rule.mask_mode:
				MODE_DROP:
					pass
				MODE_HASH:
					target[entry_key] = CryptoIntegrityLib.sha256_hex(str(entry_value))
				MODE_SALTED_HASH:
					target[entry_key] = CryptoIntegrityLib.salted_hash_hex(str(entry_value), matched_rule.salt)
				MODE_MASK:
					target[entry_key] = StatisticsMathLib.mask_string(str(entry_value), matched_rule.mask_prefix_len, matched_rule.mask_suffix_len, matched_rule.replace_with)
				_:
					target[entry_key] = matched_rule.replace_with
			continue

		if entry_value is Dictionary:
			target[entry_key] = _redact_dict(entry_value, out_redacted_keys)
		elif entry_value is Array:
			target[entry_key] = _redact_array(entry_value, out_redacted_keys, key_str)
		elif entry_value is String:
			var cleaned := StatisticsMathLib.scrub_inline_secrets(entry_value)
			if cleaned != entry_value and not (key_str in out_redacted_keys):
				out_redacted_keys.append(key_str)
			target[entry_key] = cleaned
		else:
			target[entry_key] = entry_value
	return target

## 递归脱敏数组：逐项下钻字典/数组，其余字符串按需清洗并记录所属键审计痕迹
static func _redact_array(source: Array, out_redacted_keys: Array[String], parent_key: String = "") -> Array:
	var target: Array = []
	for item in source:
		if item is Dictionary:
			target.append(_redact_dict(item, out_redacted_keys))
		elif item is Array:
			target.append(_redact_array(item, out_redacted_keys, parent_key))
		elif item is String:
			var cleaned := StatisticsMathLib.scrub_inline_secrets(item)
			if cleaned != item and not parent_key.is_empty() and not (parent_key in out_redacted_keys):
				out_redacted_keys.append(parent_key)
			target.append(cleaned)
		else:
			target.append(item)
	return target
