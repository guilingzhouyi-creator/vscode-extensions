# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/attribute_conversion_engine.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 卡拉尔统一属性底座三层模型的唯一换算入口（L1 等级层 → L2 系数层 → L3 实际值域）； 人类基准/成长曲线/系数/死区等参数全部由 config/domains/attribute.json 驱动（零硬编码）， 与相邻模块以「后端权威派生、前端不注入」为边界约定。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## AttributeConversionEngine：Domain Logic Component
class_name AttributeConversionEngine
extends RefCounted

# ==============================================================================
# 一、常量与枚举
# ==============================================================================

## 六维属性标识：STR 力量 / CON 体质 / INT 智力 / AGI 敏捷 / SPR 精神 / VIT 活力
const STAT_STR: String = "STR"
const STAT_CON: String = "CON"
const STAT_INT: String = "INT"
const STAT_AGI: String = "AGI"
const STAT_SPR: String = "SPR"
const STAT_VIT: String = "VIT"

## 六维属性标准遍历序（换算/校验/派生共用，保证确定性遍历）
const DEFAULT_STAT_LIST: Array[String] = [STAT_STR, STAT_CON, STAT_INT, STAT_AGI, STAT_SPR, STAT_VIT]

class AttributeConfigCache extends RefCounted:
	var min_level: int = 1
	var max_level: int = 6
	var dead_ratio: float = 0.5
	var experience_reshape_default: float = 1.0
	var segment_increments: Dictionary = {}
	var race_table: Dictionary = {}
	var human_base_map: Dictionary = {}
	var attribute_coefficient_map: Dictionary = {}
	var prefix_sums: Array[float] = []

static var _attribute_cache: AttributeConfigCache = null
static var _attribute_config_version: int = -1

static func _ensure_attribute_cache() -> AttributeConfigCache:
	var config_version: int = GameConfig.config_reload_version()
	if _attribute_cache != null and _attribute_config_version == config_version:
		return _attribute_cache
	var config_cache := AttributeConfigCache.new()
	config_cache.min_level = GameConfig.get_int("domains.attribute", "levels/min", 1)
	config_cache.max_level = GameConfig.get_int("domains.attribute", "levels/max", 6)
	config_cache.dead_ratio = GameConfig.get_float("domains.attribute", "dead_ratio", 0.5)
	config_cache.experience_reshape_default = GameConfig.get_float("domains.attribute", "experience_reshape_default", 1.0)
	config_cache.segment_increments = GameConfig.get_dict("domains.attribute", "segment_increments", {})
	config_cache.race_table = GameConfig.get_dict("domains.attribute", "race_coefficients", {})
	var raw_human_base: Dictionary = GameConfig.get_dict("domains.attribute", "human_base", {})
	var raw_attribute_coefficients: Dictionary = GameConfig.get_dict("domains.attribute", "attribute_coefficients", {})
	for attribute_name in DEFAULT_STAT_LIST:
		config_cache.human_base_map[attribute_name] = float(raw_human_base.get(attribute_name, 100.0))
		config_cache.attribute_coefficient_map[attribute_name] = float(raw_attribute_coefficients.get(attribute_name, 1.0))
	var limit: int = maxi(1, config_cache.max_level)
	config_cache.prefix_sums.resize(limit + 1)
	config_cache.prefix_sums[0] = 0.0
	for segment_index in range(1, limit + 1):
		config_cache.prefix_sums[segment_index] = config_cache.prefix_sums[segment_index - 1] + float(config_cache.segment_increments.get(str(segment_index), 1.0))
	_attribute_cache = config_cache
	_attribute_config_version = config_version
	return config_cache

# ==============================================================================
# 二、等级域（L1 等级层）
# ==============================================================================

## 最小等级（config/domains/attribute.json levels/min，默认 1）
static func min_level() -> int:
	return _ensure_attribute_cache().min_level

## 最大等级（config/domains/attribute.json levels/max，默认 6）
static func max_level() -> int:
	return _ensure_attribute_cache().max_level

## 等级域规则校验（统一 1~6 级，越界返回 false）
static func validate_level(level: int) -> bool:
	var config_cache := _ensure_attribute_cache()
	return level >= config_cache.min_level and level <= config_cache.max_level

# ==============================================================================
# 三、系数（L2 中间系数结构层）
# ==============================================================================

## 人类基准（每级基准值，config/domains/attribute.json human_base/*，默认 100.0）
static func human_base(attribute_name: String) -> float:
	var config_cache := _ensure_attribute_cache()
	if config_cache.human_base_map.has(attribute_name):
		return float(config_cache.human_base_map[attribute_name])
	return GameConfig.get_float("domains.attribute", "human_base/%s" % attribute_name, 100.0)

## 属性系数数组（平衡调节，config/domains/attribute.json attribute_coefficients/*，默认 1.0）
static func attribute_coefficient(attribute_name: String) -> float:
	var config_cache := _ensure_attribute_cache()
	if config_cache.attribute_coefficient_map.has(attribute_name):
		return float(config_cache.attribute_coefficient_map[attribute_name])
	return GameConfig.get_float("domains.attribute", "attribute_coefficients/%s" % attribute_name, 1.0)

## 种族系数数组（身世/天赋 = 系数修正，创角时叠加进此表；种族缺失回退 DEFAULT 行，默认 1.0）
static func race_coefficient(race: String, attribute_name: String) -> float:
	var table: Dictionary = _ensure_attribute_cache().race_table
	var entry: Dictionary = table.get(race, table.get("DEFAULT", {}))
	return float(entry.get(attribute_name, 1.0))

## 阅历修饰系数默认值（config/domains/attribute.json experience_reshape_default，默认 1.0）
static func experience_reshape_default() -> float:
	return _ensure_attribute_cache().experience_reshape_default

# ==============================================================================
# 四、成长曲线（分段非线性）
# ==============================================================================

## 连续等级量 continuous_level ∈ [0, max_level) 对应成长倍数：
## 死区 continuous_level ≤ dead_ratio → 0（STR 参考 0~50 全零，其余按基准同比缩放）；
## 段 1 在死区后重新线性化（保证曲线连续）；段增量系数数组可配置（默认 Σ=6）。
static func growth_units(continuous_level: float) -> float:
	var config_cache := _ensure_attribute_cache()
	var dead_ratio: float = config_cache.dead_ratio
	if continuous_level <= dead_ratio:
		return 0.0
	var segment_increments: Dictionary = config_cache.segment_increments
	var max_level_value: int = config_cache.max_level
	if continuous_level >= float(max_level_value):
		if max_level_value >= 0 and max_level_value < config_cache.prefix_sums.size():
			return config_cache.prefix_sums[max_level_value]
		return _segment_sum(segment_increments, max_level_value)
	if continuous_level <= 1.0:
		var first_segment_increment: float = float(segment_increments.get("1", 1.0))
		return first_segment_increment * (continuous_level - dead_ratio) / (1.0 - dead_ratio)
	var segment_index: int = int(ceil(continuous_level)) # 当前段 2..max
	var before: float = config_cache.prefix_sums[segment_index - 1] if (segment_index - 1) >= 0 and (segment_index - 1) < config_cache.prefix_sums.size() else _segment_sum(segment_increments, segment_index - 1)
	var segment_increment: float = float(segment_increments.get(str(segment_index), 1.0))
	return before + (continuous_level - float(segment_index - 1)) * segment_increment

## 段增量系数前缀和：前 upto 段系数累加（满级倍数 = 各段增量之和）
static func _segment_sum(segment_increments: Dictionary, segment_limit: int) -> float:
	var total := 0.0
	for segment_index in range(1, segment_limit + 1):
		total += float(segment_increments.get(str(segment_index), 1.0))
	return total

# ==============================================================================
# 五、三层合成（L3 实际值域）
# ==============================================================================

## 实际值 = 人类基准 × 成长曲线(continuous_level) × 系数积 + 动态调整值（L3 实际值域）。
## 契约：progress 钳制 [0,1]；experience_reshape 钳制非负（防负系数倒转曲线）；
##       base_coefficient 缺省 -1 时回退配置种族系数；动态调整直加/直减永久不逆转。
## 性能：纯静态零分配，可在循环内安全调用。
static func convert_to_actual(
	race: String,
	attribute_name: String,
	level: int,
	progress: float,
	experience_reshape: float,
	dynamic_adjustment: float,
	base_coefficient: float = -1.0
) -> float:
	var continuous_level: float = (float(level) - 1.0) + clamp(progress, 0.0, 1.0)
	var effective_race_coefficient: float = base_coefficient if base_coefficient >= 0.0 else race_coefficient(race, attribute_name)
	var combined_coefficient: float = effective_race_coefficient * attribute_coefficient(attribute_name) * max(0.0, experience_reshape)
	return human_base(attribute_name) * growth_units(continuous_level) * combined_coefficient + dynamic_adjustment

## 从生理表聚合换算（消费方统一入口）：等级 → 底层实际能力值。
## 系数 = 先天基础系数（种族×天赋，缺省回退配置表）× 阅历调节系数（L2）。
static func sheet_actual_value(sheet: CharacterPhysiologySheet, attribute_name: String) -> float:
	return convert_to_actual(
		sheet.race_id,
		attribute_name,
		int(sheet.attribute_levels.get(attribute_name, 1)),
		float(sheet.attribute_progress.get(attribute_name, 0.0)),
		float(sheet.get_experience_reshape(attribute_name)),
		float(sheet.dynamic_adjustments.get(attribute_name, 0.0)),
		sheet.get_base_coefficient(attribute_name)
	)
