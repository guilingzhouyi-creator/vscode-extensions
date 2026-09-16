# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/sovereignty_realm/nation_sovereignty_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/sovereignty.json | 信号: EventBus 领域广播
# 职责说明: 荒原拓荒建国、领土自治、宫廷政变刺杀弑君与全域超级蝴蝶效应震荡。 建国/政变数值与叙事文案由 config/sovereignty.json、 config/narratives/sovereignty.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name NationSovereigntyAndCoupFSM extends RefCounted

## 玩家荒原拓荒独立建国状态机
## initial_treasury_gold < 0 时取配置默认值（GDScript 默认参数须为常量表达式）
static func establish_new_sovereign_nation(
	founder_id: String,
	nation_name: String,
	initial_town_ids: Array,
	initial_treasury_gold: int = -1
) -> KnighthoodTitle.NationRealmAggregate:
	var treasury_gold = initial_treasury_gold
	if treasury_gold < 0:
		treasury_gold = GameConfig.get_int("domains.sovereignty", "nation_defaults/founding_treasury_gold", 20000)
	var founding_stability := GameConfig.get_float("domains.sovereignty", "nation_defaults/founding_stability_percent", 100.0)
	var nation_id_prefix := GameConfig.get_string("domains.sovereignty", "nation_defaults/nation_id_prefix", "NATION_")

	var nation := KnighthoodTitle.NationRealmAggregate.new()
	nation.nation_id = UniqueIdGenerator.next_id(nation_id_prefix)
	nation.canonical_nation_name = nation_name
	nation.sovereign_ruler_id = founder_id
	nation.territory_town_ids = initial_town_ids
	nation.national_treasury_gold = treasury_gold
	nation.stability_percent = founding_stability

	EventBusCore.get_instance().emit_narrative_by_key(
		"sovereignty/nation_founded", "sovereignty", [founder_id, nation_name, initial_town_ids.size()]
	)

	return nation

## 宫廷政变刺杀弑君与全域蝴蝶效应震荡
## success_chance < 0 时取配置默认值
static func execute_palace_coup(
	nation: KnighthoodTitle.NationRealmAggregate,
	usurper_id: String,
	success_chance: float = -1.0,
	rng: DeterministicRNG = null
) -> Dictionary:
	var coup_rng := DeterministicRNG.resolve(rng)
	var chance = success_chance
	if chance < 0.0:
		chance = GameConfig.get_float("domains.sovereignty", "coup/default_success_chance", 0.8)
	chance = clampf(chance, 0.0, 1.0)

	var success_floor := GameConfig.get_float("domains.sovereignty", "coup/success_stability_floor", 20.0)
	var success_drop := GameConfig.get_float("domains.sovereignty", "coup/success_stability_drop", 35.0)
	var failure_floor := GameConfig.get_float("domains.sovereignty", "coup/failure_stability_floor", 40.0)
	var failure_drop := GameConfig.get_float("domains.sovereignty", "coup/failure_stability_drop", 15.0)

	var is_success = (coup_rng.randf() < chance)
	if is_success:
		var old_ruler = nation.sovereign_ruler_id
		nation.sovereign_ruler_id = usurper_id
		nation.stability_percent = _apply_stability_drop(nation.stability_percent, success_drop, success_floor)

		# 全域蝴蝶效应: 国策重构与治安震荡
		EventBusCore.get_instance().emit_narrative_by_key(
			"sovereignty/coup_success", "sovereignty", [usurper_id, old_ruler, nation.stability_percent]
		)
		return { "success": true, "new_ruler": usurper_id, "stability": nation.stability_percent }
	else:
		nation.stability_percent = _apply_stability_drop(nation.stability_percent, failure_drop, failure_floor)
		EventBusCore.get_instance().emit_narrative_by_key(
			"sovereignty/coup_failed", "sovereignty", [usurper_id]
		)
		return { "success": false, "stability": nation.stability_percent }

## M7（Phase 53）稳定性单调衰减（Inv-ON-3）：下限只约束「从上方下跌」的止点，
## 绝不在现值已低于下限时抬升（旧 max(floor, cur - drop) 会让失败政变把 20 → 40 反弹）。
static func _apply_stability_drop(cur: float, drop: float, floor: float) -> float:
	if cur <= floor:
		return cur
	return maxf(floor, cur - drop)
