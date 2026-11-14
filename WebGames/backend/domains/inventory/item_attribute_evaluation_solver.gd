# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_evaluation_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 融合 A类增量、B类减量与已鉴定的 C类特殊词缀，实施互斥过滤与严格非负截断 (max(0.0, ...))。 三阶段流水：词缀收集与互斥 → 数值累加与单条上下界钳制 → 合并与非负硬截断。
# 退出语义与设计依据: 业务域第一性原理 / 架构设计规范
# ==============================================================================

## ItemAttributeEvaluationSolver：Headless Discrete Solver / Numerical Calculator
class_name ItemAttributeEvaluationSolver
extends RefCounted

# ==============================================================================
# 一、最终生效面板属性求解
# ==============================================================================

static func _has_tag_conflict(conflict_tags: Array, active_tags: Dictionary) -> bool:
	for conflict_tag in conflict_tags:
		if active_tags.has(conflict_tag):
			return true
	return false

static func _register_synergy_tags(synergy_tags: Array, active_tags: Dictionary) -> void:
	for synergy_tag in synergy_tags:
		active_tags[synergy_tag] = true

## 求解物品最终生效面板属性
static func evaluate_effective_stats(
	item_uid: String,
	base_stats: Dictionary,
	mounts: Array,
	definitions_by_uid: Dictionary
) -> Dictionary:
	var final_stats: Dictionary = base_stats.duplicate(true)
	var raw_increment: Dictionary = {}
	var raw_decrement: Dictionary = {}
	var active_affixes: Array = []
	var suppressed_affixes: Array = []

	var active_tags: Dictionary = {}

	# 阶段一：收集激活词缀与标签互斥处理
	for mount_entry in mounts:
		if not (mount_entry is ItemAttributeMountInstance):
			continue
		var mount: ItemAttributeMountInstance = mount_entry

		var definition: ItemAttributeDefinition = definitions_by_uid.get(mount.attribute_uid, null)
		if definition == null:
			continue

		# C 类特殊词缀在 HIDDEN 态严格不生效
		if mount.category == ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
			if mount.visibility != ItemAttributeMountInstance.VisibilityState.APPRAISED or not mount.is_active:
				suppressed_affixes.append(mount.attribute_uid)
				continue

		# 互斥标签冲突校验
		if _has_tag_conflict(definition.conflict_tags, active_tags):
			suppressed_affixes.append(mount.attribute_uid)
			continue

		# 记录激活词缀
		active_affixes.append(mount.attribute_uid)
		_register_synergy_tags(definition.synergy_tags, active_tags)

		# 阶段二：数值累加与单条上下界钳制
		var effective_value: float = mount.current_value
		effective_value = clampf(effective_value, definition.value_min, definition.value_max)

		var stat_name: String = definition.target_stat
		if stat_name.is_empty():
			continue

		match mount.category:
			ItemAttributeDefinition.AttributeCategory.INCREMENT:
				raw_increment[stat_name] = float(raw_increment.get(stat_name, 0.0)) + effective_value
			ItemAttributeDefinition.AttributeCategory.DECREMENT:
				raw_decrement[stat_name] = float(raw_decrement.get(stat_name, 0.0)) + effective_value
			ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
				# 特殊词缀若是数值增益，同样纳入统计
				if definition.calculation_type == ItemAttributeDefinition.CalculationType.FLAT_ADD:
					raw_increment[stat_name] = float(raw_increment.get(stat_name, 0.0)) + effective_value
				elif definition.calculation_type == ItemAttributeDefinition.CalculationType.PERCENT_ADD:
					final_stats[stat_name] = float(final_stats.get(stat_name, 0.0)) + effective_value

	# 阶段三：合并计算与非负下界硬性截断 (铁律：所有属性不得低于 0.0)
	var all_stat_keys := {}
	for stat_key in final_stats.keys():
		all_stat_keys[stat_key] = true
	for stat_key in raw_increment.keys():
		all_stat_keys[stat_key] = true
	for stat_key in raw_decrement.keys():
		all_stat_keys[stat_key] = true

	for stat_key in all_stat_keys.keys():
		var base_value: float = float(final_stats.get(stat_key, 0.0))
		var increment_value: float = float(raw_increment.get(stat_key, 0.0))
		var decrement_value: float = float(raw_decrement.get(stat_key, 0.0))

		var calculated_value: float = base_value + increment_value - decrement_value
		# 强制非负截断，杜绝出现负防御、负攻击等异常
		final_stats[stat_key] = maxf(0.0, calculated_value)

	return {
		"final_stats": final_stats,
		"raw_increment": raw_increment,
		"raw_decrement": raw_decrement,
		"active_affixes": active_affixes,
		"suppressed_affixes": suppressed_affixes
	}
