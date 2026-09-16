# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/elite_mutation/elite_monster_entity.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/elite.json | 信号: EventBus 领域广播
# 职责说明: 继承 MonsterAggregateEntity 微观生理底座，动态注入精英词缀与狂暴/召唤 状态字段；精英等级/词缀/血线阈值/小怪数量默认值由 config/domains/elite.json 的 entity_defaults 段驱动（代码零硬编码）。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name EliteMonsterAggregate extends MonsterAggregateEntity

# ==============================================================================
# 一、精英等级枚举
# ==============================================================================

## 精英变异等级：决定基础强度、词缀池权重与掉落稀有度
enum EliteGrade {
	COMMON = 0,    # 普通（无精英词缀）
	ENHANCED = 1,  # 强化（1 个词缀）
	ELITE = 2,     # 精英（2 个词缀，默认）
	NIGHTMARE = 3  # 噩梦（满词缀 + 光环力场）
}

# ==============================================================================
# 二、精英状态字段（config/domains/elite.json 驱动）
# ==============================================================================

## 当前精英等级（初始取 entity_defaults/elite_grade，默认 2 精英）
var elite_grade: int = GameConfig.get_int("domains.elite", "entity_defaults/elite_grade", 2)
## 已注入的精英词缀 ID 清单（apply_affixes 填充，空 = 无词缀）
var elite_affix_ids: Array = []
## 狂暴触发血线阈值（HP 占比，entity_defaults/berserk_health_threshold，默认 30%）
var berserk_health_threshold: float = GameConfig.get_float("domains.elite", "entity_defaults/berserk_health_threshold", 0.30)
## 是否已进入狂暴态（幂等：触发后不重复狂暴）
var is_berserk: bool = GameConfig.get_bool("domains.elite", "entity_defaults/is_berserk", false)
## 精英召唤的小怪数量（0 = 不召唤）
var minion_count: int = GameConfig.get_int("domains.elite", "entity_defaults/minion_count", 0)

# ==============================================================================
# 三、精英词缀注入（Phase 88 角色归位）
# ==============================================================================

## 精英词缀注入：L2 系数乘性修正（STR/CON/AGI/SPR）后重算体魄。
## 角色归位依据（《后端逻辑处理标准 v1》）：本方法原地改写**自身**生理系数，属
## 「entity / aggregate 承载自身状态变更」；原实现位于 GenericAffixSolver，
## 违反「solver 禁 mutator（禁止 -> void 改写入参状态）」，故迁入实体自身。
## 词缀定义读取仍由 GenericAffixSolver.get_affix（纯函数）承担，权重池由 domains.elite 段驱动。
## 契约：未登记词缀安全跳过；注入后经 calculate_somatic_function 重算（等级不变、底层实际值联动）。
func apply_affixes(affix_ids: Array) -> void:
	elite_affix_ids = affix_ids
	if physiology == null:
		return
	for aff_id in affix_ids:
		var aff: Dictionary = GenericAffixSolver.get_affix(str(aff_id))
		if aff.is_empty():
			continue
		var mods: Variant = aff.get("stat_mods", {})
		if not (mods is Dictionary):
			continue
		if mods.has("str"): physiology.base_coefficients["STR"] = float(physiology.base_coefficients.get("STR", 1.0)) * float(mods["str"])
		if mods.has("con"): physiology.base_coefficients["CON"] = float(physiology.base_coefficients.get("CON", 1.0)) * float(mods["con"])
		if mods.has("agi"): physiology.base_coefficients["AGI"] = float(physiology.base_coefficients.get("AGI", 1.0)) * float(mods["agi"])
		if mods.has("spr"): physiology.base_coefficients["SPR"] = float(physiology.base_coefficients.get("SPR", 1.0)) * float(mods["spr"])
	LifeCycleAndPhysiologySolver.calculate_somatic_function(physiology)
