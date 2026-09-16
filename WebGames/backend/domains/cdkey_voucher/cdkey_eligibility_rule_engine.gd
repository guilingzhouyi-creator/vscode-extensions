# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/cdkey_voucher/cdkey_eligibility_rule_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/cdkey_voucher.json | 信号: EventBus 领域广播
# 职责说明: 解释 config/domains/cdkey_voucher.json 的 eligibility_rules 复合门槛配置， 逐条判定 + AND/OR 短路聚合。规则引擎能力与具体业务规则分离—— 引擎只解释配置，不内嵌任何业务条件；示例配置须显式标注 example_only。  契约（Phase 35 S2）: - 未达标返回 allowed=false + failed_rule_id/metric_key（不写任何核销状态） - operator 白名单: gte/lte/eq/neq/contains；未知 operator 受控判定失败 - 无状态纯函数：判定指标由调用方注入，引擎不持有玩家数据
# 设计依据: 业务域第一性原理 / Phase 03 施工细则规范
# ==============================================================================

class_name CDKeyEligibilityRuleEngine
extends RefCounted

## operator 白名单（配置驱动判定语义的唯一来源）
const OPERATOR_WHITELIST: Array[String] = ["gte", "lte", "eq", "neq", "contains"]

## 读取配置复合门槛段：{ "combinator": "AND"|"OR", "rules": [...], "example_only": bool }。
## example_only=true 的示例配置（仅验证框架能力）不参与判定——返回空表，
## 引擎不将示例升级为隐式全局约束（Phase 35 S3 契约）。
static func load_rules(table_id: String = "domains.cdkey_voucher") -> Dictionary:
	var rules := GameConfig.get_dict(table_id, "eligibility_rules", {})
	if rules.get("example_only", false):
		return {}
	return rules

## 作用域合并（Phase 36 S2）：兑换码级规则按 rule_id 覆盖全局规则。
## global_rules/voucher_rules 为 { combinator, rules: [...] } 形态；返回合并后规则集：
## combinator 取 voucher（若有）；rules = voucher 规则 + 全局中未被 voucher 覆盖的规则。
static func merge_rules(global_rules: Dictionary, voucher_rules: Dictionary) -> Dictionary:
	if voucher_rules.is_empty():
		return global_rules
	if global_rules.is_empty():
		return voucher_rules
	var voucher_ids := {}
	var merged_rules: Array = []
	for rule in voucher_rules.get("rules", []):
		voucher_ids[String(rule.get("rule_id", ""))] = true
		merged_rules.append(rule)
	for rule in global_rules.get("rules", []):
		if not voucher_ids.has(String(rule.get("rule_id", ""))):
			merged_rules.append(rule)
	return {
		"combinator": String(voucher_rules.get("combinator", global_rules.get("combinator", "AND"))),
		"rules": merged_rules
	}

## 复合门槛评估：metrics 为调用方注入的判定指标（metric_key -> 值）。
## 返回 { "allowed": bool, "combinator": String, "failed_rule_id": String, "failed_metric": String }
static func evaluate(metrics: Dictionary, rules: Dictionary) -> Dictionary:
	var combinator := String(rules.get("combinator", "AND"))
	var rule_list: Array = rules.get("rules", [])
	if rule_list.is_empty():
		return { "allowed": true, "combinator": combinator, "failed_rule_id": "", "failed_metric": "" }

	for rule in rule_list:
		var passed := _evaluate_rule(metrics, rule)
		if rule.get("negate", false):
			passed = not passed
		if combinator == "OR" and passed:
			return { "allowed": true, "combinator": combinator, "failed_rule_id": "", "failed_metric": "" }
		if combinator == "AND" and not passed:
			return {
				"allowed": false,
				"combinator": combinator,
				"failed_rule_id": String(rule.get("rule_id", "")),
				"failed_metric": String(rule.get("metric_key", ""))
			}

	# AND 全过 或 OR 全败
	var all_passed := (combinator != "OR")
	return {
		"allowed": all_passed,
		"combinator": combinator,
		"failed_rule_id": "" if all_passed else String(rule_list[rule_list.size() - 1].get("rule_id", "")),
		"failed_metric": "" if all_passed else String(rule_list[rule_list.size() - 1].get("metric_key", ""))
	}

## 单规则判定（operator 白名单外的非法配置受控判定失败）
static func _evaluate_rule(metrics: Dictionary, rule: Dictionary) -> bool:
	var metric_key := String(rule.get("metric_key", ""))
	if not metrics.has(metric_key):
		return false
	var operator := String(rule.get("operator", ""))
	if not OPERATOR_WHITELIST.has(operator):
		return false
	var metric: Variant = metrics[metric_key]
	var expected: Variant = rule.get("value")
	match operator:
		"gte":
			return float(metric) >= float(expected)
		"lte":
			return float(metric) <= float(expected)
		"eq":
			return str(metric) == str(expected)
		"neq":
			return str(metric) != str(expected)
		"contains":
			return str(metric).contains(str(expected))
	return false
