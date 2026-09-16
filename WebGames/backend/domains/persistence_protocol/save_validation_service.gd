# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/save_validation_service.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 依据 persistence.json 校验规则执行缺失字段回退、类型强转与未知域治理。 支持迁移后校验与领域级恢复保障（Inv-SV-2/7/11）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name SaveValidationService extends RefCounted

## 验证工作区字典：依据 persistence.json 规则进行数据清洗与校验
## 返回 { "is_valid": bool, "issues": Array[Dictionary], "sanitized": Dictionary }
static func validate_domains(working_data: Dictionary) -> Dictionary:
	var missing_policy := GameConfig.get_string("infrastructure.persistence", "validation_rules/missing_field", "use_default")
	var type_policy := GameConfig.get_string("infrastructure.persistence", "validation_rules/type_mismatch", "coerce_or_drop")
	var unknown_policy := GameConfig.get_string("infrastructure.persistence", "validation_rules/unknown_domain", "warn_and_skip")

	var sanitized: Dictionary = working_data.duplicate(true)
	var issues: Array[Dictionary] = []

	var known_domains: Dictionary = _get_known_domains()

	# 1. 扫描未知域
	var keys_to_remove: Array[String] = []
	for domain_key in sanitized.keys():
		var d_key := String(domain_key)
		if not known_domains.has(d_key):
			issues.append({
				"type": "UNKNOWN_DOMAIN",
				"domain": d_key,
				"policy": unknown_policy
			})
			if unknown_policy == "warn_and_skip":
				EventBusCore.get_instance().emit_log("warning", "SaveValidationService: 存档含未知数据域 [%s]，按策略跳过" % d_key)
				keys_to_remove.append(d_key)

	for rem_key in keys_to_remove:
		sanitized.erase(rem_key)

	# 2. 扫描已知且启用的域结构
	for d_id in known_domains.keys():
		if not sanitized.has(d_id):
			if missing_policy == "use_default":
				sanitized[d_id] = {}
				issues.append({
					"type": "MISSING_DOMAIN",
					"domain": d_id,
					"policy": missing_policy
				})
			continue

		var val: Variant = sanitized[d_id]
		if not val is Dictionary:
			if type_policy == "coerce_or_drop":
				issues.append({
					"type": "TYPE_MISMATCH",
					"domain": d_id,
					"expected": "Dictionary",
					"actual": typeof(val),
					"action": "dropped"
				})
				sanitized[d_id] = {}
			else:
				issues.append({
					"type": "TYPE_MISMATCH_FATAL",
					"domain": d_id
				})

	var is_valid: bool = true
	for iss in issues:
		if iss.get("type", "") == "TYPE_MISMATCH_FATAL":
			is_valid = false
			break

	return {
		"is_valid": is_valid,
		"issues": issues,
		"sanitized": sanitized
	}

## 字段级安全转换：支持 int/float/str/bool 互相容错
static func coerce_value(val: Variant, expected_type: int) -> Variant:
	if typeof(val) == expected_type:
		return val
	match expected_type:
		TYPE_INT:
			if val is float:
				return int(val)
			if val is String and (val as String).is_valid_int():
				return (val as String).to_int()
			if val is bool:
				return 1 if val else 0
		TYPE_FLOAT:
			if val is int:
				return float(val)
			if val is String and (val as String).is_valid_float():
				return (val as String).to_float()
		TYPE_STRING:
			return str(val)
		TYPE_BOOL:
			if val is int or val is float:
				return val != 0
			if val is String:
				return val == "true" or val == "1"
	return null

## 获取所有已知数据域集合（来自 domains.json，仅登记实际持久化域 save.enabled，
## 避免为非持久化域注入空节污染存档 / 误判未知域，评审收敛 L3）
static func _get_known_domains() -> Dictionary:
	var map: Dictionary = {}
	var all_entries: Array = GameConfig.get_array("infrastructure.domains", "domains", [])
	for entry in all_entries:
		var id := String(entry.get("id", ""))
		if id.is_empty():
			continue
		var save_cfg: Dictionary = entry.get("save", {})
		if not bool(save_cfg.get("enabled", false)):
			continue
		map[id] = true
	return map
