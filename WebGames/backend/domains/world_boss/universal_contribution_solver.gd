# ==============================================================================
# 模块归属: 业务领域层 (Domains · 核心战斗与魔法集群 (Combat & Magic))
# 文件路径: res://backend/domains/world_boss/universal_contribution_solver.gd
# 架构定位: Headless Discrete Solver / Numerical Calculator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/world_boss.json | 信号: EventBus 领域广播
# 职责说明: 伤害量/承伤量/治疗量综合贡献度权重加权计算、MVP 评定与掉落拍卖分配 权重由 config/domains/world_boss.json 驱动，文案由 narratives/world_boss.json 驱动。
# 设计依据: 业务域第一性原理 / Phase 02 施工细则规范
# ==============================================================================

class_name UniversalContributionSolver extends RefCounted

## 贡献榜计算：伤害/承伤/治疗加权得分并降序排序（权重配置驱动）
static func calculate_leaderboard(boss: WorldBossAggregate) -> Array[Dictionary]:
	var board: Array[Dictionary] = []
	var w_dmg := GameConfig.get_float("domains.world_boss", "contribution/weights/damage", 1.0)
	var w_tank := GameConfig.get_float("domains.world_boss", "contribution/weights/tanking", 0.5)
	var w_heal := GameConfig.get_float("domains.world_boss", "contribution/weights/heal", 0.8)
	for p_id in boss.battle_contribution_ledger:
		var data = boss.battle_contribution_ledger[p_id]
		var dmg = float(data.get("damage", 0.0))
		var tank = float(data.get("tanking", 0.0))
		var heal = float(data.get("heal", 0.0))
		var score = dmg * w_dmg + tank * w_tank + heal * w_heal
		board.append({ "participant_id": p_id, "score": score, "damage": dmg })

	board.sort_custom(func(a, b): return a["score"] > b["score"])
	return board

## BOSS 掉落分配：MVP 评定 + 广播贡献 MVP 叙事
static func distribute_boss_loot(boss: WorldBossAggregate) -> Dictionary:
	var leaderboard = calculate_leaderboard(boss)
	if leaderboard.is_empty():
		return { "mvp_id": "", "distributed_count": 0 }

	var mvp_id = leaderboard[0].get("participant_id", "")

	EventBusCore.get_instance().emit_narrative_by_key(
		"world_boss/contribution_mvp", "quest", [mvp_id, leaderboard[0].get("score", 0.0)]
	)

	return { "mvp_id": mvp_id, "leaderboard": leaderboard, "distributed_count": leaderboard.size() }
