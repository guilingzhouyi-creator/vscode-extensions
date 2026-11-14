# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/magic_system/magic_rule_condition.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/magic_rules.json | 信号: EventBus 领域广播
# 职责说明: 求值可配置组合条件树（AND/OR/NOT/LEAF），用于升格资格、融会贯通、 延时释放校验等场景。条件结构与参数全部来自配置（magic_rules.json / 运行时输入），引擎不把具体条件组合写死。未识别条件种类返回 false （受控失败），不产生隐含规则。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## MagicRuleCondition：Domain Logic Component
class_name MagicRuleCondition
extends RefCounted

const OP_AND: String = "AND"
const OP_OR: String = "OR"
const OP_NOT: String = "NOT"
const OP_LEAF: String = "LEAF"

## 求值入口：node = {op, terms / kind + args}；context 提供运行时事实。
## 内置 LEAF kind：
##   - "school_attrs_learned": args {school, min_count}，context.learned_by_school[String]
##   - "holder_rank_gte":      args {min_rank}，context.holder_rank（当前位阶）
##   - "variant_flag":         args {variant}，context.variant_flags（Array[String]）
static func evaluate(node: Dictionary, context: Dictionary = {}) -> bool:
	if node.is_empty():
		return false
	var op := String(node.get("op", ""))
	match op:
		OP_AND:
			return _eval_and(node, context)
		OP_OR:
			return _eval_or(node, context)
		OP_NOT:
			return _eval_not(node, context)
		OP_LEAF:
			return _eval_leaf(node, context)
	return false  # 未知操作符：受控失败，不猜测

## AND 语义：全子项成立（空/非法 terms 受控失败）
static func _eval_and(node: Dictionary, context: Dictionary) -> bool:
	var terms: Variant = node.get("terms", [])
	if not terms is Array or terms.is_empty():
		return false
	for term in terms:
		if not term is Dictionary or not evaluate(term, context):
			return false
	return true

## OR 语义：任一子项成立（空/非法 terms 受控失败）
static func _eval_or(node: Dictionary, context: Dictionary) -> bool:
	var terms: Variant = node.get("terms", [])
	if not terms is Array or terms.is_empty():
		return false
	for term in terms:
		if term is Dictionary and evaluate(term, context):
			return true
	return false

## NOT 语义：唯一子项取反（非单子项受控失败）
static func _eval_not(node: Dictionary, context: Dictionary) -> bool:
	var terms: Variant = node.get("terms", [])
	if not terms is Array or terms.size() != 1:
		return false
	var term: Variant = terms[0]
	if not term is Dictionary:
		return false
	return not evaluate(term, context)

## LEAF 求值：按 kind 分派（school_attrs_learned/holder_rank_gte/variant_flag），未知种类受控失败
static func _eval_leaf(node: Dictionary, context: Dictionary) -> bool:
	var kind := String(node.get("kind", ""))
	var args: Dictionary = node.get("args", {})
	match kind:
		"school_attrs_learned":
			var learned: Dictionary = context.get("learned_by_school", {})
			var school := String(args.get("school", ""))
			var min_count := int(args.get("min_count", 1))
			return int(learned.get(school, 0)) >= min_count
		"holder_rank_gte":
			var min_rank := int(args.get("min_rank", 1))
			return int(context.get("holder_rank", 0)) >= min_rank
		"variant_flag":
			var flags: Array = context.get("variant_flags", [])
			return flags.has(String(args.get("variant", "")))
	return false  # 未知 LEAF 种类：受控失败，不静默放行
