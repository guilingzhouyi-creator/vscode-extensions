# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/inventory/item_attribute_evaluation_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/inventory.json | 信号: EventBus 领域广播
# 职责说明: 融合 A类增量、B类减量与已鉴定的 C类特殊词缀，实施互斥过滤与严格非负截断 (max(0.0, ...))。 三阶段流水：词缀收集与互斥 → 数值累加与单条上下界钳制 → 合并与非负硬截断。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ItemAttributeEvaluationSolver
extends RefCounted

# ==============================================================================
# 一、最终生效面板属性求解
# ==============================================================================

## 求解物品最终生效面板属性
static func evaluate_effective_stats(
	item_uid: String,
	base_stats: Dictionary,
	mounts: Array,
	definitions_by_uid: Dictionary
) -> Dictionary:
	var final_stats: Dictionary = base_stats.duplicate(true)
	var raw_inc: Dictionary = {}
	var raw_dec: Dictionary = {}
	var active_affixes: Array = []
	var suppressed_affixes: Array = []

	var active_tags: Dictionary = {}

	# 阶段一：收集激活词缀与标签互斥处理
	for m in mounts:
		if not (m is ItemAttributeMountInstance):
			continue
		var mount: ItemAttributeMountInstance = m

		var def: ItemAttributeDefinition = definitions_by_uid.get(mount.attribute_uid, null)
		if def == null:
			continue

		# C 类特殊词缀在 HIDDEN 态严格不生效
		if mount.category == ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
			if mount.visibility != ItemAttributeMountInstance.VisibilityState.APPRAISED or not mount.is_active:
				suppressed_affixes.append(mount.attribute_uid)
				continue

		# 互斥标签冲突校验
		var conflict_hit := false
		for ctag in def.conflict_tags:
			if active_tags.has(ctag):
				conflict_hit = true
				break

		if conflict_hit:
			suppressed_affixes.append(mount.attribute_uid)
			continue

		# 记录激活词缀
		active_affixes.append(mount.attribute_uid)
		for stag in def.synergy_tags:
			active_tags[stag] = true

		# 阶段二：数值累加与单条上下界钳制
		var effective_val: float = mount.current_value
		effective_val = clampf(effective_val, def.value_min, def.value_max)

		var stat_name: String = def.target_stat
		if stat_name.is_empty():
			continue

		match mount.category:
			ItemAttributeDefinition.AttributeCategory.INCREMENT:
				raw_inc[stat_name] = float(raw_inc.get(stat_name, 0.0)) + effective_val
			ItemAttributeDefinition.AttributeCategory.DECREMENT:
				raw_dec[stat_name] = float(raw_dec.get(stat_name, 0.0)) + effective_val
			ItemAttributeDefinition.AttributeCategory.SPECIAL_AFFIX:
				# 特殊词缀若是数值增益，同样纳入统计
				if def.calculation_type == ItemAttributeDefinition.CalculationType.FLAT_ADD:
					raw_inc[stat_name] = float(raw_inc.get(stat_name, 0.0)) + effective_val
				elif def.calculation_type == ItemAttributeDefinition.CalculationType.PERCENT_ADD:
					final_stats[stat_name] = float(final_stats.get(stat_name, 0.0)) + effective_val

	# 阶段三：合并计算与非负下界硬性截断 (P8.6 铁律：所有属性不得低于 0.0)
	var all_stat_keys := {}
	for k in final_stats.keys():
		all_stat_keys[k] = true
	for k in raw_inc.keys():
		all_stat_keys[k] = true
	for k in raw_dec.keys():
		all_stat_keys[k] = true

	for sname in all_stat_keys.keys():
		var b_val: float = float(final_stats.get(sname, 0.0))
		var inc_val: float = float(raw_inc.get(sname, 0.0))
		var dec_val: float = float(raw_dec.get(sname, 0.0))

		var calc_val: float = b_val + inc_val - dec_val
		# 强制非负截断，杜绝出现负防御、负攻击等异常
		final_stats[sname] = maxf(0.0, calc_val)

	return {
		"final_stats": final_stats,
		"raw_increment": raw_inc,
		"raw_decrement": raw_dec,
		"active_affixes": active_affixes,
		"suppressed_affixes": suppressed_affixes
	}
