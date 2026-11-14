# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/equipment_loadout/equipment_modifier_evaluator.gd
# 架构定位: Domain Resolver / Policy Evaluator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/equipment.json | 信号: EventBus 领域广播
# 职责说明: 遍历战备槽位装备，聚合前缀/后缀/符文词条，输出综合六维属性与抗性修正， 并基于生理副本叠加（不污染存档）重算体魄； 符文加成由 config/domains/equipment.json 的 rune_modifiers 段驱动。
# 退出语义与设计依据: 业务域第一性原理 / 战备词缀聚合与生理属性叠加规范
# ==============================================================================

## EquipmentModifierEvaluator：Domain Resolver / Policy Evaluator
class_name EquipmentModifierEvaluator extends RefCounted

# ==============================================================================
# 一、战备词缀聚合求值
# ==============================================================================

static func _accumulate_stat_map(stat_map: Dictionary, total_modifiers: Dictionary) -> void:
	for stat_key in stat_map:
		if total_modifiers.has(stat_key):
			total_modifiers[stat_key] += float(stat_map[stat_key])

static func _accumulate_slot_item(equipped_item: ItemEntity, rune_definitions: Dictionary, total_modifiers: Dictionary) -> void:
	total_modifiers["total_mass_kg"] += equipped_item.mass_kg
	total_modifiers["total_armor"] += float(equipped_item.combat_metrics.get("effective_armor", 0.0))

	var dynamic_affixes: Array = equipped_item.affix_sockets.get("dynamic_affixes", [])
	for dynamic_affix in dynamic_affixes:
		if dynamic_affix is Dictionary:
			_accumulate_stat_map(dynamic_affix, total_modifiers)

	var runes: Array = equipped_item.affix_sockets.get("imprinted_runes", [])
	for rune_id in runes:
		var raw_definition: Variant = rune_definitions.get(str(rune_id))
		if raw_definition is Dictionary:
			_accumulate_stat_map(raw_definition as Dictionary, total_modifiers)

## 聚合战备全槽词缀：前缀/后缀/符文修正 → 六维属性与抗性总和（rune_modifiers 配置驱动）
## 契约：空槽安全跳过；动态词缀/符文键名不在 total_modifiers 白名单内的自动忽略（不报错）。
## 性能：配置表外提至槽位循环外单次查询，无嵌套瞬态分配。
static func evaluate_total_modifiers(loadout: EquipmentLoadoutAggregate) -> Dictionary:
	var total_modifiers: Dictionary = {
		"bonus_str": 0.0, "bonus_con": 0.0, "bonus_int": 0.0,
		"bonus_agi": 0.0, "bonus_spr": 0.0, "bonus_vit": 0.0,
		"total_armor": 0.0, "total_mass_kg": 0.0,
		"slash_boost": 0.0, "stab_boost": 0.0, "mana_efficiency": 0.0
	}
	var rune_definitions: Dictionary = GameConfig.get_dict("domains.equipment", "rune_modifiers", {})

	for slot_name in loadout.slots:
		var equipped_item: ItemEntity = loadout.slots[slot_name]
		if equipped_item != null:
			_accumulate_slot_item(equipped_item, rune_definitions, total_modifiers)

	return total_modifiers

# ==============================================================================
# 二、词缀作用于 L3 实际值域
# ==============================================================================

## 战备词缀作用于 L3 实际值域：基于生理副本叠加（不污染存档）并重算体魄
## 契约：返回新实例（duplicate_physiology），入参 base_sheet 保持不变。
static func apply_loadout_to_physiology(
	loadout: EquipmentLoadoutAggregate,
	base_sheet: CharacterPhysiologySheet
) -> CharacterPhysiologySheet:
	var modifiers: Dictionary = evaluate_total_modifiers(loadout)
	# 词缀加成作用于 L3 实际值域（等级不变、底层能力联动）：基于副本叠加，不污染存档
	var active_sheet: CharacterPhysiologySheet = base_sheet.duplicate_physiology()
	var bonus_map: Dictionary = {
		"STR": modifiers["bonus_str"], "CON": modifiers["bonus_con"], "INT": modifiers["bonus_int"],
		"AGI": modifiers["bonus_agi"], "SPR": modifiers["bonus_spr"], "VIT": modifiers["bonus_vit"]
	}
	for stat_key in bonus_map:
		active_sheet.dynamic_adjustments[stat_key] = float(active_sheet.dynamic_adjustments.get(stat_key, 0.0)) + float(bonus_map[stat_key])

	LifecycleAndPhysiologySolver.calculate_somatic_function(active_sheet)
	return active_sheet
