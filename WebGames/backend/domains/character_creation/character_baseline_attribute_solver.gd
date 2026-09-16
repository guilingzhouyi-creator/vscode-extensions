# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/character_creation/character_baseline_attribute_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/character_creation.json | 信号: EventBus 领域广播
# 职责说明: 角色创建阶段基础六维（STR/CON/INT/AGI/SPR/VIT）一律由后端依据种族 定义配置封闭派生（L1 等级层基线 + 种族修正），严禁信任前端传入的任何 初始属性值（前端伪造 STR/CON 等一律由请求侧丢弃，见 CharacterCreationService 防伪守卫）。 关联细则: Phase 48 阶段2 §2.2（后端权威属性派生求解器）
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name CharacterBaselineAttributeSolver
extends RefCounted

# ==============================================================================
# 一、常量与枚举
# ==============================================================================

## 六维属性标准遍历序（与 AttributeConversionEngine.DEFAULT_STAT_LIST 一致，基线派生用）
const DEFAULT_STAT_LIST: Array[String] = ["STR", "CON", "INT", "AGI", "SPR", "VIT"]

# ==============================================================================
# 二、核心算法（基线属性派生）
# ==============================================================================

## 由后端根据种族定义与初始规则确定性生成基础属性等级（L1 1~6）。
## 契约：基线等级经 clampi 收敛进 [point_buy/min, point_buy/max]（防配置越界直写输出，
##       Inv-VD-3，Phase 55）；种族修正仅作用于已存在键并再次收敛；race_def 为 null 时
##       按人族 HUMAN 派生，返回 { attribute_levels, race_id }。
static func generate_baseline_attributes(race_def: RaceDefinitionDTO) -> Dictionary:
	var min_level := GameConfig.get_int("domains.character_creation", "attribute_init/point_buy/min", 1)
	var max_level := GameConfig.get_int("domains.character_creation", "attribute_init/point_buy/max", 6)
	# L11（Phase 55）：基线等级统一收敛进 1~6 级域（Inv-VD-3）——无种族修正分支此前
	# 配置越界值直写输出（save_slot_character_binder 直写不校验），现与修正分支同域收敛
	var base_level := clampi(GameConfig.get_int("domains.character_creation", "defaults/baseline_stat_level", 3), min_level, max_level)

	var base_levels := {}
	for stat_k in DEFAULT_STAT_LIST:
		base_levels[stat_k] = base_level

	# 叠加种族修正（人族全维平衡；扩展种族经配置基准确认后放行）
	if race_def != null and not race_def.base_stat_modifiers.is_empty():
		for stat_k in race_def.base_stat_modifiers.keys():
			if not base_levels.has(stat_k):
				continue
			var mod_val: int = int(race_def.base_stat_modifiers[stat_k])
			base_levels[stat_k] = clampi(int(base_levels[stat_k]) + mod_val, min_level, max_level)

	return {
		"attribute_levels": base_levels,
		"race_id": race_def.race_id if race_def != null else "HUMAN"
	}
