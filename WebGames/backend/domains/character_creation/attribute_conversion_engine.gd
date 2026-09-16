# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/attribute_conversion_engine.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 卡拉尔统一属性底座三层模型的唯一换算入口（L1 等级层 → L2 系数层 → L3 实际值域）； 人类基准/成长曲线/系数/死区等参数全部由 config/domains/attribute.json 驱动（零硬编码）， 与相邻模块以「后端权威派生、前端不注入」为边界约定。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

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

# ==============================================================================
# 二、等级域（L1 等级层）
# ==============================================================================

## 最小等级（config/domains/attribute.json levels/min，默认 1）
static func min_level() -> int:
	return GameConfig.get_int("domains.attribute", "levels/min", 1)

## 最大等级（config/domains/attribute.json levels/max，默认 6）
static func max_level() -> int:
	return GameConfig.get_int("domains.attribute", "levels/max", 6)

## 等级域规则校验（统一 1~6 级，越界返回 false）
static func validate_level(level: int) -> bool:
	return level >= min_level() and level <= max_level()

# ==============================================================================
# 三、系数（L2 中间系数结构层）
# ==============================================================================

## 人类基准（每级基准值，config/domains/attribute.json human_base/*，默认 100.0）
static func human_base(attr: String) -> float:
	return GameConfig.get_float("domains.attribute", "human_base/%s" % attr, 100.0)

## 属性系数数组（平衡调节，config/domains/attribute.json attribute_coefficients/*，默认 1.0）
static func attribute_coefficient(attr: String) -> float:
	return GameConfig.get_float("domains.attribute", "attribute_coefficients/%s" % attr, 1.0)

## 种族系数数组（身世/天赋 = 系数修正，创角时叠加进此表；种族缺失回退 DEFAULT 行，默认 1.0）
static func race_coefficient(race: String, attr: String) -> float:
	var table: Dictionary = GameConfig.get_dict("domains.attribute", "race_coefficients", {})
	var entry: Dictionary = table.get(race, table.get("DEFAULT", {}))
	return float(entry.get(attr, 1.0))

## 阅历重塑系数默认值（config/domains/attribute.json experience_reshape_default，默认 1.0）
static func experience_reshape_default() -> float:
	return GameConfig.get_float("domains.attribute", "experience_reshape_default", 1.0)

# ==============================================================================
# 四、成长曲线（分段非线性）
# ==============================================================================

## 连续等级量 q ∈ [0, max_level) 对应成长倍数：
## 死区 q ≤ dead_ratio → 0（STR 参考 0~50 全零，其余按基准同比缩放）；
## 段 1 在死区后重新线性化（保证曲线连续）；段增量系数数组可配置（默认 Σ=6）。
static func growth_units(q: float) -> float:
	var dead_ratio := GameConfig.get_float("domains.attribute", "dead_ratio", 0.5)
	if q <= dead_ratio:
		return 0.0
	var segs: Dictionary = GameConfig.get_dict("domains.attribute", "segment_increments", {})
	var max_lv := max_level()
	if q >= float(max_lv):
		return _segment_sum(segs, max_lv)
	if q <= 1.0:
		var seg1 := float(segs.get("1", 1.0))
		return seg1 * (q - dead_ratio) / (1.0 - dead_ratio)
	var n := int(ceil(q)) # 当前段 2..max
	var before := _segment_sum(segs, n - 1)
	var seg_n := float(segs.get(str(n), 1.0))
	return before + (q - float(n - 1)) * seg_n

## 段增量系数前缀和：前 upto 段系数累加（满级倍数 = 各段增量之和）
static func _segment_sum(segs: Dictionary, upto: int) -> float:
	var total := 0.0
	for i in range(1, upto + 1):
		total += float(segs.get(str(i), 1.0))
	return total

# ==============================================================================
# 五、三层合成（L3 实际值域）
# ==============================================================================

## 实际值 = 人类基准 × 成长曲线(q) × 系数积 + 动态调整值（L3 实际值域）。
## 契约：progress 钳制 [0,1]；experience_reshape 钳制非负（防负系数倒转曲线）；
##       base_coef 缺省 -1 时回退配置种族系数；动态调整直加/直减永久不逆转。
## 性能：纯静态零分配，可在循环内安全调用。
static func convert_to_actual(
	race: String,
	attr: String,
	level: int,
	progress: float,
	experience_reshape: float,
	dynamic_adjustment: float,
	base_coef: float = -1.0
) -> float:
	var q: float = (float(level) - 1.0) + clamp(progress, 0.0, 1.0)
	var rc: float = base_coef if base_coef >= 0.0 else race_coefficient(race, attr)
	var coef: float = rc * attribute_coefficient(attr) * max(0.0, experience_reshape)
	return human_base(attr) * growth_units(q) * coef + dynamic_adjustment

## 从生理表聚合换算（消费方统一入口）：等级 → 底层实际能力值。
## 系数 = 先天基础系数（种族×天赋，缺省回退配置表）× 阅历重塑系数（L2）。
static func sheet_actual_value(sheet: CharacterPhysiologySheet, attr: String) -> float:
	return convert_to_actual(
		sheet.race_id,
		attr,
		int(sheet.attribute_levels.get(attr, 1)),
		float(sheet.attribute_progress.get(attr, 0.0)),
		float(sheet.get_experience_reshape(attr)),
		float(sheet.dynamic_adjustments.get(attr, 0.0)),
		sheet.get_base_coefficient(attr)
	)
