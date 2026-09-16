# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle_physiology/lifecycle_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 历法年轮推进机能衰退、寿元大限判定、生机逆龄与丹药调和。 大限阈值/恢复量与叙事文案由 config/lifecycle.json、 config/narratives/lifecycle.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name LifeCycleEvolutionFSM extends RefCounted

## 历法年轮推进：机能衰退计算（体魄求解）+ 寿元大限/死亡判定并广播年轮叙事
static func age_character_years(sheet: CharacterPhysiologySheet, years: float) -> Dictionary:
	sheet.raw_chronological_age += years
	var new_sf = LifeCycleAndPhysiologySolver.calculate_somatic_function(sheet)

	var eol_ratio := GameConfig.get_float("domains.lifecycle", "lifecycle/eol_ratio", 90.0)
	var death_ratio := GameConfig.get_float("domains.lifecycle", "lifecycle/death_ratio", 100.0)

	var safe_lifespan: float = maxf(0.1, sheet.lifespan_scale)
	var age_progression: float = sheet.raw_chronological_age / safe_lifespan
	var is_near_end_of_life = age_progression >= eol_ratio
	var is_deceased = new_sf <= 0.0 or age_progression >= death_ratio

	EventBusCore.get_instance().emit_narrative_by_key(
		"lifecycle/age_advance", "lifecycle",
		[years, new_sf, age_progression],
		{ "sf": new_sf, "near_eol": is_near_end_of_life, "deceased": is_deceased }
	)

	return { "new_sf": new_sf, "near_eol": is_near_end_of_life, "deceased": is_deceased }

## 生机逆龄：年岁回退（下限钳制）+ 心核完整度回升，重算体魄并广播
static func apply_rejuvenation(sheet: CharacterPhysiologySheet, rejuvenation_years: float) -> float:
	var min_age := GameConfig.get_float("domains.lifecycle", "lifecycle/min_age", 0.0)
	var heart_core_gain := GameConfig.get_float("domains.lifecycle", "lifecycle/rejuvenation_heart_core_gain", 0.1)

	sheet.raw_chronological_age = max(min_age, sheet.raw_chronological_age - rejuvenation_years)
	sheet.heart_core_integrity = min(1.0, sheet.heart_core_integrity + heart_core_gain)
	var new_sf = LifeCycleAndPhysiologySolver.calculate_somatic_function(sheet)

	EventBusCore.get_instance().emit_narrative_by_key(
		"lifecycle/rejuvenation", "lifecycle", [rejuvenation_years, new_sf]
	)
	return new_sf
