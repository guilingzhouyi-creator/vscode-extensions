# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/npc_simulation/npc_ai_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/npc.json | 信号: EventBus 领域广播
# 职责说明: 基于五维性格矩阵与等效寿命的目标导向行动规划 (GOAP)。 阈值/权重/目标标识由 config/npc.json 的 goap 段驱动。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name NPCAIAndEvolutionSolver extends RefCounted

## 目标导向行动规划器 (GOAP Action Planner)
static func plan_npc_next_goal(npc: AutonomousNPCEntity) -> String:
	var p = npc.personality
	var scale_floor := GameConfig.get_float("domains.npc", "goap/scale_floor", 0.1)
	var legacy_threshold := GameConfig.get_float("domains.npc", "goap/legacy_age_threshold", 80.0)
	var default_trait := GameConfig.get_float("domains.npc", "goap/default_personality", 0.5)

	var eff_age = npc.physiology.raw_chronological_age / max(scale_floor, npc.physiology.lifespan_scale)

	# 寿元将尽大限前夕: 强制优先著书立说留传衣钵
	if eff_age >= legacy_threshold:
		return GameConfig.get_string("domains.npc", "goap/goals/legacy", "WRITE_LEGACY_BOOK")

	var w_trade_greed := GameConfig.get_float("domains.npc", "goap/weights/trade_greed", 1.5)
	var w_explore_courage := GameConfig.get_float("domains.npc", "goap/weights/explore_courage", 1.2)
	var w_explore_penalty := GameConfig.get_float("domains.npc", "goap/weights/explore_rationality_penalty", 0.4)
	var w_cultivate_rationality := GameConfig.get_float("domains.npc", "goap/weights/cultivate_rationality", 1.3)
	var w_cultivate_piety := GameConfig.get_float("domains.npc", "goap/weights/cultivate_piety", 0.5)

	var score_trade = p.get("greed", default_trait) * w_trade_greed
	var score_explore = p.get("courage", default_trait) * (w_explore_courage - p.get("rationality", default_trait) * w_explore_penalty)
	var score_cultivate = p.get("rationality", default_trait) * w_cultivate_rationality + p.get("piety", default_trait) * w_cultivate_piety

	if score_trade > score_explore and score_trade > score_cultivate:
		return GameConfig.get_string("domains.npc", "goap/goals/trade", "TRADE_COMMODITY")
	elif score_explore > score_cultivate:
		return GameConfig.get_string("domains.npc", "goap/goals/explore", "EXPLORE_DUNGEON")
	else:
		return GameConfig.get_string("domains.npc", "goap/goals/cultivate", "CULTIVATE_MAGIC")
