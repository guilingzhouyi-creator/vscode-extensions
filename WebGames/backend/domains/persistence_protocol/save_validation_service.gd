# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/save_validation_service.gd
# 架构定位: Domain Service / State Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 依据 persistence.json 校验规则执行缺失字段回退、类型强转与未知域治理。 支持迁移后校验与领域级恢复保障（Inv-SV-2/7/11）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## SaveValidationService：Domain Service / State Orchestrator
class_name SaveValidationService extends RefCounted

## 验证工作区字典：依据 persistence.json 规则进行数据清洗与校验
## 返回 { "is_valid": bool, "issues": Array[Dictionary], "sanitized": Dictionary }
static func validate_domains(working_payload: Dictionary) -> Dictionary:
	var missing_policy := GameConfig.get_string("infrastructure.persistence", "validation_rules/missing_field", "use_default")
	var type_policy := GameConfig.get_string("infrastructure.persistence", "validation_rules/type_mismatch", "coerce_or_drop")
	var unknown_policy := GameConfig.get_string("infrastructure.persistence", "validation_rules/unknown_domain", "warn_and_skip")

	var sanitized: Dictionary = working_payload.duplicate(true)
	var issues: Array[Dictionary] = []

	var known_domains: Dictionary = _get_known_domains()

	# 1. 扫描未知域
	var keys_to_remove: Array[String] = []
	for domain_key in sanitized.keys():
		var domain_name := String(domain_key)
		if not known_domains.has(domain_name):
			issues.append({
				"type": "UNKNOWN_DOMAIN",
				"domain": domain_name,
				"policy": unknown_policy
			})
			if unknown_policy == "warn_and_skip":
				EventBusCore.get_instance().emit_log("warn", TemplateFormatter.format("SaveValidationService: save contains unknown domain [{domain}], skipped per policy.", {"domain": domain_name}))
				keys_to_remove.append(domain_name)

	for removal_key in keys_to_remove:
		sanitized.erase(removal_key)

	# 2. 扫描已知且启用的域结构
	for domain_id in known_domains.keys():
		_validate_known_domain_section(sanitized, domain_id, missing_policy, type_policy, issues)

	var is_valid: bool = true
	for validation_issue in issues:
		if validation_issue.get("type", "") == "TYPE_MISMATCH_FATAL":
			is_valid = false
			break

	return {
		"is_valid": is_valid,
		"issues": issues,
		"sanitized": sanitized
	}

## 字段级安全转换：支持 int/float/str/bool 互相容错
static func coerce_value(source_value: Variant, expected_type: int) -> Variant:
	if typeof(source_value) == expected_type:
		return source_value
	match expected_type:
		TYPE_INT:
			if source_value is float:
				return int(source_value)
			if source_value is String and (source_value as String).is_valid_int():
				return (source_value as String).to_int()
			if source_value is bool:
				return 1 if source_value else 0
		TYPE_FLOAT:
			if source_value is int:
				return float(source_value)
			if source_value is String and (source_value as String).is_valid_float():
				return (source_value as String).to_float()
		TYPE_STRING:
			return str(source_value)
		TYPE_BOOL:
			if source_value is int or source_value is float:
				return source_value != 0
			if source_value is String:
				return source_value == "true" or source_value == "1"
	return null

static func _validate_known_domain_section(
	sanitized: Dictionary,
	domain_id: Variant,
	missing_policy: String,
	type_policy: String,
	issues: Array
) -> void:
	if not sanitized.has(domain_id):
		if missing_policy == "use_default":
			sanitized[domain_id] = {}
			issues.append({
				"type": "MISSING_DOMAIN",
				"domain": domain_id,
				"policy": missing_policy
			})
		return

	var domain_section: Variant = sanitized[domain_id]
	if not domain_section is Dictionary:
		if type_policy == "coerce_or_drop":
			issues.append({
				"type": "TYPE_MISMATCH",
				"domain": domain_id,
				"expected": "Dictionary",
				"actual": typeof(domain_section),
				"action": "dropped"
			})
			sanitized[domain_id] = {}
		else:
			issues.append({
				"type": "TYPE_MISMATCH_FATAL",
				"domain": domain_id
			})

## 获取所有已知数据域集合（来自 domains.json，仅登记实际持久化域 save.enabled，
## 避免为非持久化域注入空节污染存档 / 误判未知域，评审收敛 L3）
static func _get_known_domains() -> Dictionary:
	var map: Dictionary = {}
	var all_entries: Array = GameConfig.get_array("infrastructure.domains", "domains", [])
	var empty_save_config: Dictionary = {}
	for entry in all_entries:
		var known_domain_id := String(entry.get("id", ""))
		if known_domain_id.is_empty():
			continue
		var save_config: Dictionary = entry.get("save", empty_save_config)
		if not bool(save_config.get("enabled", false)):
			continue
		map[known_domain_id] = true
	return map
