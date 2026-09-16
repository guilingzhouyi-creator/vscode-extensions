# ==============================================================================
# 模块归属: 业务领域层 (Domains · 经济、交易与物流集群 (Economy & Trade))
# 文件路径: res://backend/domains/trading_logistics/caravan_logistics_fsm.gd
# 架构定位: Domain FSM / Lifecycle Session Engine
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/trading.json | 信号: EventBus 领域广播
# 职责说明: 商队运输进度推进、沿途遇袭劫掠风险计算与货物运抵结算。 风险系数与叙事文案由 config/trading.json、config/narratives/trading.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name CaravanLogisticsFSM extends RefCounted

## 商队进度推进：进度封顶 + 劫镖风险判定（危险度×系数 − 护卫×保护）→ 遇袭/运抵叙事广播
static func advance_caravan_progress(
	caravan: TownMarketCommodity.TradeCaravanEntity,
	delta_progress: float,
	route_danger_level: float, # 0.0 ~ 1.0
	rng: DeterministicRNG = null
) -> Dictionary:
	var caravan_rng := DeterministicRNG.resolve(rng)
	var max_progress := GameConfig.get_float("domains.trading", "caravan/max_progress", 1.0)
	var danger_coefficient := GameConfig.get_float("domains.trading", "caravan/danger_coefficient", 0.5)
	var guard_protection := GameConfig.get_float("domains.trading", "caravan/guard_protection", 0.02)
	var ambush_chance_max := GameConfig.get_float("domains.trading", "caravan/ambush_chance_max", 0.8)

	caravan.progress_ratio = min(max_progress, caravan.progress_ratio + delta_progress)

	# 劫镖风险判定: 护卫越少，危险度越高，遇袭概率越大
	var ambush_chance = clamp(route_danger_level * danger_coefficient - float(caravan.guards_count) * guard_protection, 0.0, ambush_chance_max)
	var is_ambushed = (caravan_rng.randf() < ambush_chance) and not caravan.is_intercepted

	if is_ambushed:
		caravan.is_intercepted = true
		EventBusCore.get_instance().emit_narrative_by_key(
			"trading/caravan_ambushed", "caravan", [caravan.caravan_id]
		)

	var arrived = (caravan.progress_ratio >= max_progress)
	if arrived:
		EventBusCore.get_instance().emit_narrative_by_key(
			"trading/caravan_arrived", "caravan", [caravan.caravan_id, caravan.destination_town_id]
		)

	return { "progress": caravan.progress_ratio, "is_ambushed": is_ambushed, "arrived": arrived }
