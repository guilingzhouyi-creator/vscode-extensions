# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/redaction_rule.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 依据 log.json redaction 段配置对结构化日志 context 执行构造期脱敏， 支持 mask、drop、hash 三种安全模式，杜绝凭证落盘（Inv-LS-2 安全红线）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name RedactionRule extends RefCounted

# ==============================================================================
# 一、脱敏规则条目实体
# ==============================================================================

## 单条脱敏规则：字段正则 + 脱敏模式（mask/drop/hash）与掩码参数
class RuleEntry extends RefCounted:
	var regex: RegEx = null
	var mask_mode: String = "mask"    # mask | drop | hash
	var mask_prefix_len: int = 4
	var mask_suffix_len: int = 4
	var replace_with: String = "****"

# ==============================================================================
# 二、规则加载与配置
# ==============================================================================

static var _rules: Array[RuleEntry] = []
static var _enabled: bool = true
static var _default_mode: String = "mask"
static var _cached_version: int = -2

## 测试复位：清空规则并恢复默认配置（避免跨用例状态残留）
static func reset_state() -> void:
	_rules.clear()
	_enabled = true
	_default_mode = "mask"
	_cached_version = -2

## 规则新鲜度守卫：热重载版本变化时按 log.json redaction 段重建规则集
static func _ensure_loaded() -> void:
	var current_version := GameConfig.config_reload_version()
	if _cached_version == current_version:
		return
	_cached_version = current_version
	_rules.clear()
	
	var redaction_cfg := GameConfig.get_dict("infrastructure.log", "redaction", {})
	if redaction_cfg.is_empty():
		_enabled = true
		_default_mode = "mask"
		_init_default_rules()
		return
		
	_enabled = bool(redaction_cfg.get("enabled", true))
	_default_mode = str(redaction_cfg.get("default_mode", "mask"))
	var rules_arr = redaction_cfg.get("rules", [])
	if rules_arr is Array:
		for item in rules_arr:
			if not (item is Dictionary):
				continue
			var pattern := str(item.get("field_pattern", ""))
			if pattern.is_empty():
				continue
			var re := RegEx.new()
			if re.compile("(?i)^(" + pattern + ")$") == OK:
				var entry := RuleEntry.new()
				entry.regex = re
				entry.mask_mode = str(item.get("mask_mode", "mask"))
				entry.mask_prefix_len = int(item.get("mask_prefix_len", 4))
				entry.mask_suffix_len = int(item.get("mask_suffix_len", 4))
				entry.replace_with = str(item.get("replace_with", "****"))
				_rules.append(entry)

## 内置默认脱敏规则（配置段缺失时兜底：令牌/指纹掩码、口令丢弃、账号哈希）
static func _init_default_rules() -> void:
	var defaults = [
		{ "field_pattern": "token|session_token", "mask_mode": "mask", "mask_prefix_len": 4, "mask_suffix_len": 4, "replace_with": "****" },
		{ "field_pattern": "fingerprint|device_fingerprint", "mask_mode": "mask", "mask_prefix_len": 4, "mask_suffix_len": 0, "replace_with": "****" },
		{ "field_pattern": "password|password_hash|secret|seal_key", "mask_mode": "drop" },
		{ "field_pattern": "account_id", "mask_mode": "hash" }
	]
	for item in defaults:
		var re := RegEx.new()
		if re.compile("(?i)^(" + item["field_pattern"] + ")$") == OK:
			var entry := RuleEntry.new()
			entry.regex = re
			entry.mask_mode = item["mask_mode"]
			entry.mask_prefix_len = int(item.get("mask_prefix_len", 4))
			entry.mask_suffix_len = int(item.get("mask_suffix_len", 4))
			entry.replace_with = str(item.get("replace_with", "****"))
			_rules.append(entry)

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

## 递归脱敏字典：嵌套字典/数组继续下钻；命中规则按模式处理（drop 整键丢弃 / hash 摘要 / mask 前后缀留）
static func _redact_dict(source: Dictionary, out_redacted_keys: Array[String]) -> Dictionary:
	var target: Dictionary = {}
	for k in source.keys():
		var key_str := str(k)
		var val = source[k]
		
		# 递归处理嵌套字典
		if val is Dictionary:
			target[k] = _redact_dict(val, out_redacted_keys)
			continue
		elif val is Array:
			target[k] = _redact_array(val, out_redacted_keys)
			continue
			
		var matched_rule: RuleEntry = null
		for rule in _rules:
			if rule.regex != null and rule.regex.search(key_str) != null:
				matched_rule = rule
				break
				
		if matched_rule == null:
			target[k] = val
			continue
			
		# 命中脱敏规则
		if not (key_str in out_redacted_keys):
			out_redacted_keys.append(key_str)
			
		match matched_rule.mask_mode:
			"drop":
				# 整键丢弃，不写入 target
				pass
			"hash":
				target[k] = str(val).sha256_text()
			"mask":
				target[k] = _apply_mask(str(val), matched_rule.mask_prefix_len, matched_rule.mask_suffix_len, matched_rule.replace_with)
			_:
				target[k] = matched_rule.replace_with
	return target

## 递归脱敏数组：逐项下钻字典/数组，其余原样保留
static func _redact_array(source: Array, out_redacted_keys: Array[String]) -> Array:
	var target: Array = []
	for item in source:
		if item is Dictionary:
			target.append(_redact_dict(item, out_redacted_keys))
		elif item is Array:
			target.append(_redact_array(item, out_redacted_keys))
		else:
			target.append(item)
	return target

## 掩码应用：保留前 prefix_len 与后 suffix_len 位，中段替换为 replace_with
static func _apply_mask(val_str: String, prefix_len: int, suffix_len: int, replace_with: String) -> String:
	var total_len := val_str.length()
	if total_len <= prefix_len + suffix_len or total_len == 0:
		return replace_with
	var p := val_str.left(prefix_len)
	var s := val_str.right(suffix_len) if suffix_len > 0 else ""
	return p + replace_with + s
