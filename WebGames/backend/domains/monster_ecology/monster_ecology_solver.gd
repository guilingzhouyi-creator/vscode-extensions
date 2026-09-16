# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/monster_ecology/monster_ecology_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/monster.json | 信号: EventBus 领域广播
# 职责说明: 独立部位受击破坏 AP 惩罚判定、异兽吞噬过载爆体律。 容纳系数/爆体阈值/核心部位 ID 与状态字面量由 config/domains/monster.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name MonsterEcologySolver extends RefCounted

## 多部位独立破坏力学求解器
static func apply_part_damage(
	monster: MonsterAggregateEntity,
	part_id: String,
	damage: float
) -> Dictionary:
	if not monster.body_parts.has(part_id):
		return { "success": false, "broken": false, "ap_penalty": 0 }

	var part: MonsterAggregateEntity.MonsterBodyPart = monster.body_parts[part_id]
	if part.is_severed:
		return { "success": true, "broken": true, "already_broken": true, "ap_penalty": 0 }

	part.durability_current = max(0.0, part.durability_current - damage)
	var broken := false
	var penalty := 0

	if part.durability_current <= 0.0:
		part.is_severed = true
		broken = true
		penalty = part.ap_penalty_on_break
		if part_id == GameConfig.get_string("domains.monster", "devour/core_part_id", "HEART_CORE"):
			monster.physiology.heart_core_integrity = 0.0

	return {
		"success": true,
		"part_id": part_id,
		"current_durability": part.durability_current,
		"broken": broken,
		"ap_penalty": penalty
	}

## 异兽吞噬进化与爆体律求解器
## 容纳上限 = CON * capacity_multiplier
static func evaluate_devour_evolution(
	monster: MonsterAggregateEntity,
	absorbed_mana: float,
	gene_rune: String
) -> Dictionary:
	var capacity_multiplier := GameConfig.get_float("domains.monster", "devour/capacity_multiplier", 15.0)
	var overload_threshold := GameConfig.get_float("domains.monster", "devour/overload_threshold", 1.5)
	var overload_self_damage := GameConfig.get_float("domains.monster", "devour/overload_self_damage", 9999.0)

	# 统一六维底座：容纳上限按 CON 底层实际值折算（等级不变时数值亦可联动）
	var con_capacity = monster.physiology.get_actual_value("CON") * capacity_multiplier
	if absorbed_mana > con_capacity * overload_threshold:
		return {
			"status": GameConfig.get_string("domains.monster", "devour/status_overload_explosion", "OVERLOAD_EXPLOSION"),
			"success": false,
			"damage_to_self": overload_self_damage,
			"desc": GameConfig.get_string("domains.monster", "devour/overload_desc", "异兽吞噬过载灵能，经络爆裂自毁！")
		}

	monster.devoured_genes.append(gene_rune)
	# 吞噬进化：STR/CON 等级 +1（6 级封顶由统一规则校验）
	monster.physiology.set_level("STR", monster.physiology.get_level("STR") + 1)
	monster.physiology.set_level("CON", monster.physiology.get_level("CON") + 1)

	return {
		"status": GameConfig.get_string("domains.monster", "devour/status_evolved", "EVOLVED"),
		"success": true,
		"absorbed_rune": gene_rune,
		"new_str": monster.physiology.get_level("STR"),
		"new_con": monster.physiology.get_level("CON")
	}
