# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/equipment_loadout/equipment_modifier_evaluator.gd
# 架构定位: Domain Resolver / Policy Evaluator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/equipment.json | 信号: EventBus 领域广播
# 职责说明: 遍历战备槽位装备，聚合前缀/后缀/符文词条，输出综合六维属性与抗性修正， 并基于生理副本叠加（不污染存档）重算体魄； 符文加成由 config/domains/equipment.json 的 rune_modifiers 段驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name EquipmentModifierEvaluator extends RefCounted

# ==============================================================================
# 一、战备词缀聚合求值
# ==============================================================================

## 聚合战备全槽词缀：前缀/后缀/符文修正 → 六维属性与抗性总和（rune_modifiers 配置驱动）
## 契约：空槽安全跳过；动态词缀/符文键名不在 total_mods 白名单内的自动忽略（不报错）。
## 性能：槽位 × 词条双层遍历，槽位为个位数常数，无嵌套瞬态分配。
static func evaluate_total_modifiers(loadout: EquipmentLoadoutAggregate) -> Dictionary:
	var total_mods := {
		"bonus_str": 0.0, "bonus_con": 0.0, "bonus_int": 0.0,
		"bonus_agi": 0.0, "bonus_spr": 0.0, "bonus_vit": 0.0,
		"total_armor": 0.0, "total_mass_kg": 0.0,
		"slash_boost": 0.0, "stab_boost": 0.0, "mana_efficiency": 0.0
	}

	for slot_name in loadout.slots:
		var item: ItemEntity = loadout.slots[slot_name]
		if item == null:
			continue

		total_mods["total_mass_kg"] += item.mass_kg
		total_mods["total_armor"] += float(item.combat_metrics.get("effective_armor", 0.0))

		# 动态词缀（前缀/后缀）逐条叠加
		var dynamic_affixes: Array = item.affix_sockets.get("dynamic_affixes", [])
		for aff in dynamic_affixes:
			if aff is Dictionary:
				for stat_k in aff:
					if total_mods.has(stat_k):
						total_mods[stat_k] += float(aff[stat_k])

		# 符文加成：按 rune_modifiers 配置定义叠加
		var runes: Array = item.affix_sockets.get("imprinted_runes", [])
		var rune_defs: Dictionary = GameConfig.get_dict("domains.equipment", "rune_modifiers", {})
		for r in runes:
			var def: Dictionary = rune_defs.get(str(r), {})
			for k in def:
				if total_mods.has(k):
					total_mods[k] += float(def[k])

	return total_mods

# ==============================================================================
# 二、词缀作用于 L3 实际值域
# ==============================================================================

## 战备词缀作用于 L3 实际值域：基于生理副本叠加（不污染存档）并重算体魄
## 契约：返回新实例（duplicate_physiology），入参 base_sheet 保持不变。
static func apply_loadout_to_physiology(
	loadout: EquipmentLoadoutAggregate,
	base_sheet: CharacterPhysiologySheet
) -> CharacterPhysiologySheet:
	var mods = evaluate_total_modifiers(loadout)
	# 词缀加成作用于 L3 实际值域（等级不变、底层能力联动）：基于副本叠加，不污染存档
	var active_sheet := base_sheet.duplicate_physiology()
	var bonus_map := {
		"STR": mods["bonus_str"], "CON": mods["bonus_con"], "INT": mods["bonus_int"],
		"AGI": mods["bonus_agi"], "SPR": mods["bonus_spr"], "VIT": mods["bonus_vit"]
	}
	for stat_key in bonus_map:
		active_sheet.dynamic_adjustments[stat_key] = float(active_sheet.dynamic_adjustments.get(stat_key, 0.0)) + float(bonus_map[stat_key])

	LifeCycleAndPhysiologySolver.calculate_somatic_function(active_sheet)
	return active_sheet
