# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/elite_mutation/generic_affix_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/elite.json | 信号: EventBus 领域广播
# 职责说明: 吸血/熔火/迅捷/荆棘/虚化等通用变异词缀的定义读取与后端概率滚动（纯函数）； 词缀定义与词缀池权重由 config/domains/elite.json 的 affixes / affix_pool 段驱动。 Phase 88 角色归位：原 apply_elite_affixes（原地改写入参状态）已迁入 EliteMonsterAggregate.apply_affixes，本文件收敛为纯求解器。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name GenericAffixSolver extends RefCounted

# ==============================================================================
# 一、词缀定义读取
# ==============================================================================

## 词缀定义表（domains.elite affixes 配置）
static func _affixes() -> Dictionary:
	return GameConfig.get_dict("domains.elite", "affixes", {})

## 按词缀 ID 取定义（未登记返回空字典）
static func get_affix(aff_id: String) -> Dictionary:
	var m := _affixes()
	if m.has(aff_id):
		return m[aff_id]
	return {}

# ==============================================================================
# 二、词缀注入与概率滚动
# ==============================================================================

## 精英词缀注入已迁出（Phase 88 角色归位）：原 apply_elite_affixes(monster, affix_ids) 原地改写
## 入参聚合，违反「solver 禁 mutator」红线，已迁入 EliteMonsterAggregate.apply_affixes。
## 本文件收敛为纯求解器：仅承担词缀定义读取与后端概率滚动（无任何入参状态改写）。

## 后端概率滚动（GAP-04 算法主权）：词缀池与权重由 config/domains/elite.json 的
## affix_pool 段驱动（aff_id 必须已登记于 affixes 段）；rng 为空回退共享实例。
## 契约：无对应 tier 池时回退 global 池；两池皆空时安全返回空数组（不崩溃）。
## 性能：一次 `%` 取模无循环；count 超池大小时按池大小截断（mini），不越界。
static func roll_random_affixes(
	monster_tier: int,
	count: int,
	rng: DeterministicRNG = null
) -> Array[String]:
	var pool: Array = GameConfig.get_array("domains.elite", "affix_pool/tier_%d" % monster_tier, [])
	if pool.is_empty():
		pool = GameConfig.get_array("domains.elite", "affix_pool/global", [])
	if pool.is_empty():
		return []

	var affix_rng := DeterministicRNG.resolve(rng)
	var selected: Array[String] = []
	var safe_count := mini(count, pool.size())
	for i in range(safe_count):
		var entry: Variant = affix_rng.pick_weighted(pool, "weight")
		if entry is Dictionary and entry.has("aff_id"):
			selected.append(str(entry["aff_id"]))
	return selected
