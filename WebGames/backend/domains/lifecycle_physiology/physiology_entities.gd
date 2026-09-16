# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle_physiology/physiology_entities.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 统一六维属性底座（三层模型）+ 三大综合生理指标 + 寿命年轮 + 体质/资质。 - L1 等级层：attribute_levels（统一 1~6 级）+ attribute_progress（区间内连续值）； - L2 中间系数结构层（阅历重塑层）：experience_reshape，心核洗点重置，预留阅历联动； - L3 底层实际值域：dynamic_adjustments（随机动态加点永久实际值偏移，洗点不逆转）； - 实际值统一经 AttributeConversionEngine 换算（等级/系数/规则全配置驱动）。 生理初值由 config/lifecycle.json 的 physiology_defaults 段驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CharacterPhysiologySheet extends RefCounted

enum PhysicalConstitution {
	EXOTIC_BODY, # 异体 (坚韧抗毒)
	HEROIC_BODY, # 英体 (高力量动量上限)
	SPIRIT_BODY, # 灵体 (经络通透高导魔)
	HOLY_BODY    # 圣体 (生命自愈不朽)
}

enum ManaAptitude {
	MANA_ADAPTOR, # 魔适者 (基础微控)
	WORD_SPEAKER, # 言灵者 (共振增幅)
	AWAKENED,     # 觉醒者 (回路自适应)
	HEAVEN_RULER  # 天权者 (位阶压制)
}

## ===== 统一六维属性底座（三层模型，唯一换算入口 AttributeConversionEngine）=====

## L1 等级层：统一 1~6 级（离散整数）+ 区间内连续值 [0,1)
var attribute_levels: Dictionary = {}   # attr(STR/CON/INT/AGI/SPR/VIT) -> int 1..6
var attribute_progress: Dictionary = {} # attr -> float [0,1)（等级区间内连续）
var race_id: String = "HUMAN"           # 种族系数查找键（身世/天赋 = 系数修正）

## L2 中间系数结构层（阅历重塑层）：心核洗点重置此层；预留阅历系统联动
## （阅历突破可重塑该系数，见需求表16 双轨加点；默认 1.0 由 attribute.json 驱动）
var experience_reshape: Dictionary = {}

## L2 先天基础系数层（身世/天赋 = 系数修正的载体）：创角时由种族系数 × 天赋修正
## 组合而成，先天固定、心核洗点不重置；实际系数 = 基础系数 × 阅历重塑系数
var base_coefficients: Dictionary = {}

## L3 底层实际值域：随机动态加点直加/直减的永久实际值偏移（洗点不逆转）
var dynamic_adjustments: Dictionary = {}

# 三大综合生理指标
var heart_core_integrity: float = GameConfig.get_float("domains.lifecycle", "physiology_defaults/heart_core_integrity", 1.0) # 0.0 ~ 1.0 (心核活力)
var somatic_function: float = GameConfig.get_float("domains.lifecycle", "physiology_defaults/somatic_function", 100.0)   # 0.0 ~ 100.0 (肉身机能 SF)
var mental_stress_factor: float = GameConfig.get_float("domains.lifecycle", "physiology_defaults/mental_stress_factor", 0.0) # 0.0 ~ 100.0 (狂暴/精神压力 MSF)

# 寿命与年轮
var raw_chronological_age: float = GameConfig.get_float("domains.lifecycle", "physiology_defaults/raw_chronological_age", 20.0)
var lifespan_scale: float = GameConfig.get_float("domains.lifecycle", "physiology_defaults/lifespan_scale", 1.0) # 人类=1.0 (寿命100), 精灵=5.0 (寿命500), 龙族=10.0 (寿命1000)
var constitution_type: int = GameConfig.get_int("domains.lifecycle", "physiology_defaults/constitution_type", 1)
var mana_aptitude: int = GameConfig.get_int("domains.lifecycle", "physiology_defaults/mana_aptitude", 1)

# ==============================================================================
# 统一属性访问器（等级域 + 实际值域，唯一合法入口）
# ==============================================================================

func get_level(attr: String) -> int:
	return int(attribute_levels.get(attr, AttributeConversionEngine.min_level()))

## 等级提升必须经规则校验（统一 1~6 级），失败返回 false 且不改动
func set_level(attr: String, level: int) -> bool:
	if not AttributeConversionEngine.validate_level(level):
		return false
	attribute_levels[attr] = level
	return true

func get_progress(attr: String) -> float:
	return float(attribute_progress.get(attr, 0.0))

func set_progress(attr: String, progress: float) -> void:
	attribute_progress[attr] = clamp(progress, 0.0, 1.0)

## 先天基础系数（身世种族 × 天赋修正，缺省回退配置种族系数）
func get_base_coefficient(attr: String) -> float:
	if base_coefficients.has(attr):
		return float(base_coefficients[attr])
	return AttributeConversionEngine.race_coefficient(race_id, attr)

## 阅历重塑系数（默认 1.0）
func get_experience_reshape(attr: String) -> float:
	return float(experience_reshape.get(attr, AttributeConversionEngine.experience_reshape_default()))

## 底层实际能力值（L3 统一换算：等级/系数/规则全部配置驱动，等级不变时数值亦可联动变化）
func get_actual_value(attr: String) -> float:
	return AttributeConversionEngine.sheet_actual_value(self, attr)

func get_actual_values() -> Dictionary:
	var out := {}
	for k in AttributeConversionEngine.DEFAULT_STAT_LIST:
		out[k] = get_actual_value(k)
	return out

func get_all_levels() -> Dictionary:
	var out := {}
	for k in AttributeConversionEngine.DEFAULT_STAT_LIST:
		out[k] = get_level(k)
	return out

## 生理表副本（装备词缀/临时修正用）：复制 L1/L2/L3 全状态，不共享引用
func duplicate_physiology() -> CharacterPhysiologySheet:
	var clone := CharacterPhysiologySheet.new()
	clone.attribute_levels = attribute_levels.duplicate()
	clone.attribute_progress = attribute_progress.duplicate()
	clone.race_id = race_id
	clone.base_coefficients = base_coefficients.duplicate()
	clone.experience_reshape = experience_reshape.duplicate()
	clone.dynamic_adjustments = dynamic_adjustments.duplicate()
	clone.heart_core_integrity = heart_core_integrity
	clone.raw_chronological_age = raw_chronological_age
	clone.lifespan_scale = lifespan_scale
	clone.constitution_type = constitution_type
	clone.mana_aptitude = mana_aptitude
	clone.somatic_function = somatic_function
	clone.mental_stress_factor = mental_stress_factor
	return clone

func serialize() -> Dictionary:
	return {
		"attribute_levels": attribute_levels,
		"attribute_progress": attribute_progress,
		"race_id": race_id,
		"base_coefficients": base_coefficients,
		"experience_reshape": experience_reshape,
		"dynamic_adjustments": dynamic_adjustments,
		"heart_core_integrity": heart_core_integrity,
		"somatic_function": somatic_function,
		"mental_stress_factor": mental_stress_factor,
		"raw_chronological_age": raw_chronological_age,
		"lifespan_scale": lifespan_scale,
		"constitution_type": constitution_type,
		"mana_aptitude": mana_aptitude
	}
