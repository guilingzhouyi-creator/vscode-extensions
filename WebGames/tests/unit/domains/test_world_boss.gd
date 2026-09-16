# ==============================================================================
# 单元测试：领域 23 全服世界 BOSS 与转相结算 (World Boss Tests)
# 文件路径: res://tests/unit/domains/test_world_boss.gd
# ==============================================================================
class_name TestWorldBossDomain extends RefCounted

static func run_all_tests() -> Dictionary:
	var results := []
	results.append(test_multi_phase_boss_transition())
	results.append(test_universal_contribution_leaderboard())
	results.append(test_defeated_latch_blocks_resettlement())

	var all_passed := true
	for r in results:
		if not r.get("passed", false):
			all_passed = false
			break
	return { "domain": "Domain 23: 全服世界BOSS与转相结算", "all_passed": all_passed, "results": results }

static func test_multi_phase_boss_transition() -> Dictionary:
	var boss := WorldBossAggregate.new()
	boss.phase_max_hp = 500.0
	boss.phase_current_hp = 500.0
	boss.total_phases = 3
	boss.current_phase_index = 1

	# 打掉第一阶段 500 血
	var res1 = ConfigurablePhaseTransitionFSM.apply_boss_damage(boss, "HERO_01", 500.0)
	var passed = res1.phase_transition and (boss.current_phase_index == 2) and boss.is_channeling_wipe_spell
	return { "test": "TC-BOSS-01: 世界首领多阶段转相与机制护盾激活", "passed": passed }

static func test_universal_contribution_leaderboard() -> Dictionary:
	var boss := WorldBossAggregate.new()
	ConfigurablePhaseTransitionFSM.apply_boss_damage(boss, "PLAYER_A", 1000.0)
	ConfigurablePhaseTransitionFSM.apply_boss_damage(boss, "PLAYER_B", 3000.0)

	var loot = UniversalContributionSolver.distribute_boss_loot(boss)
	var passed = (loot.mvp_id == "PLAYER_B") and (loot.leaderboard.size() == 2)
	return { "test": "TC-BOSS-02: 单机联机通用战功榜加权计算与 MVP 评定", "passed": passed }

static func test_defeated_latch_blocks_resettlement() -> Dictionary:
	# L9-b（Phase 53）：击败终态锁存——终态后重复受击不再结算
	# 红证：修复前无 is_defeated 锁存，重复伤害重复触发击败叙事/渠道、战功榜继续累计
	var boss := WorldBossAggregate.new()
	boss.phase_max_hp = 500.0
	boss.phase_current_hp = 500.0
	boss.total_phases = 1 # 单阶段：hp 归零即终态击败
	boss.current_phase_index = 1

	var r1 = ConfigurablePhaseTransitionFSM.apply_boss_damage(boss, "HERO_01", 500.0)
	var defeated_once = r1.defeated and boss.is_defeated
	var r2 = ConfigurablePhaseTransitionFSM.apply_boss_damage(boss, "HERO_01", 500.0)
	var ledger_damage: float = float(boss.battle_contribution_ledger.get("HERO_01", {}).get("damage", 0.0))
	var passed = defeated_once and r2.get("error_code", "") == "BOSS_ALREADY_DEFEATED" \
		and is_equal_approx(ledger_damage, 500.0) and boss.is_defeated
	return { "test": "TC-BOSS-03: 击败终态锁存（L9-b：重复受击零结算零记账）", "passed": passed }
