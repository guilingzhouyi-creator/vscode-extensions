# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle_physiology/lifecycle_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 跨种族寿命等效换算引擎、肉身机能 SF 衰退方程与魔法资质反噬判定。 SF 公式与反噬阈值由 config/lifecycle.json 驱动。
# 设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

class_name LifeCycleAndPhysiologySolver extends RefCounted

## 0-100岁绝对标准原器寿命等效与机能衰减求解器
static func calculate_somatic_function(sheet: CharacterPhysiologySheet) -> float:
	var scale_floor: float = GameConfig.get_float("domains.lifecycle", "sf_formula/scale_floor", 0.1)
	var age_normalize: float = GameConfig.get_float("domains.lifecycle", "sf_formula/age_normalize", 100.0)
	var sf_max: float = GameConfig.get_float("domains.lifecycle", "sf_formula/sf_max", 100.0)
	var decay_exponent: float = GameConfig.get_float("domains.lifecycle", "sf_formula/decay_exponent", 1.8)

	var safe_scale: float = max(scale_floor, sheet.lifespan_scale)
	var normalized_age: float = clamp(sheet.raw_chronological_age / safe_scale, 0.0, age_normalize)

	# SF = sf_max * (1 - (NormAge / age_normalize)^decay_exponent) * HeartCore
	var age_ratio: float = normalized_age / age_normalize
	var base_sf: float = sf_max * (1.0 - pow(age_ratio, decay_exponent))
	var effective_sf: float = max(0.0, base_sf * clamp(sheet.heart_core_integrity, 0.0, 1.0))
	sheet.somatic_function = effective_sf
	return effective_sf

## 魔法资质反噬风险判定
static func evaluate_mana_backfire_risk(sheet: CharacterPhysiologySheet, spell_tier: int) -> float:
	var threshold: int = GameConfig.get_int("domains.lifecycle", "backfire/threshold_manadaptor", 1)
	match sheet.mana_aptitude:
		CharacterPhysiologySheet.ManaAptitude.MANA_ADAPTOR: threshold = GameConfig.get_int("domains.lifecycle", "backfire/threshold_manadaptor", 1)
		CharacterPhysiologySheet.ManaAptitude.WORD_SPEAKER: threshold = GameConfig.get_int("domains.lifecycle", "backfire/threshold_wordspeaker", 3)
		CharacterPhysiologySheet.ManaAptitude.AWAKENED: threshold = GameConfig.get_int("domains.lifecycle", "backfire/threshold_awakened", 6)
		CharacterPhysiologySheet.ManaAptitude.HEAVEN_RULER: threshold = GameConfig.get_int("domains.lifecycle", "backfire/threshold_heavenruler", 9)

	if spell_tier <= threshold:
		return 0.0

	var stress_base: float = GameConfig.get_float("domains.lifecycle", "backfire/stress_base", 50.0)
	var risk_coefficient: float = GameConfig.get_float("domains.lifecycle", "backfire/risk_coefficient", 0.20)

	var excess: float = float(spell_tier - threshold)
	var stress_factor: float = (stress_base + max(0.0, sheet.mental_stress_factor)) / stress_base
	return clamp(excess * risk_coefficient * stress_factor, 0.0, 1.0)
