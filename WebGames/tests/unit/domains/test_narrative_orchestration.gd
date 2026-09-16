# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Vol 35 剧情因果事件系统单元测试
# 文件路径: res://tests/unit/domains/test_narrative_orchestration.gd
# ==============================================================================
class_name TestNarrativeOrchestrationDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name = "Domain 35: 全域因果剧情流与编年史引擎"

	results.append(_test_ast_condition_composite_evaluation())
	results.append(_test_priority_weight_arbitration())
	results.append(_test_chronicle_deterministic_hash_logging())

	# Phase 50: 通用剧情因果 DAG 编排引擎与多角色差异化拓扑测试
	var p50_res := TestNarrativeDagOrchestrationPipeline.run_all_tests()
	results.append_array(p50_res.get("results", []))

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func _test_ast_condition_composite_evaluation() -> Dictionary:
	# 复合条件: (TOWN == "TOWN_VALAN" AND MIN_LEVEL >= 10) OR (REPUTATION >= 1000)
	var ast := {
		"type": "OR",
		"conditions": [
			{
				"type": "AND",
				"conditions": [
					{ "kind": "TOWN_EQUALS", "val": "TOWN_VALAN" },
					{ "kind": "MIN_LEVEL", "val": 10 }
				]
			},
			{
				"kind": "REPUTATION_GREATER",
				"faction": "TEMPLE_OF_LIGHT",
				"val": 1000
			}
		]
	}

	var ctx_match_1 := { "town_id": "TOWN_VALAN", "character_level": 12, "reputations": {} }
	var ctx_match_2 := { "town_id": "TOWN_OTHER", "character_level": 1, "reputations": { "TEMPLE_OF_LIGHT": 1500 } }
	var ctx_mismatch := { "town_id": "TOWN_OTHER", "character_level": 5, "reputations": {} }

	var res1 = NarrativeCausalityOrchestrator.evaluate_ast_condition(ast, ctx_match_1)
	var res2 = NarrativeCausalityOrchestrator.evaluate_ast_condition(ast, ctx_match_2)
	var res3 = NarrativeCausalityOrchestrator.evaluate_ast_condition(ast, ctx_mismatch)

	var passed = res1 and res2 and (not res3)
	return {
		"test": "TC-NARRATIVE-01: 复杂布尔逻辑与多维世界上下文 AST 条件求值",
		"passed": passed
	}

static func _test_priority_weight_arbitration() -> Dictionary:
	var evt_low := NarrativeEventAggregate.new("EVT_TOWN_RUMOR", "酒馆传闻", NarrativeEventAggregate.EventScopeTier.PERSONAL_ENCOUNTER, 50)
	var evt_high := NarrativeEventAggregate.new("EVT_CALAMITY_COMET", "赤红彗星坠落", NarrativeEventAggregate.EventScopeTier.WORLD_HISTORICAL, 500)

	var events: Array[NarrativeEventAggregate] = [evt_low, evt_high]
	var ctx := {} # 无条件直接匹配

	var triggered = NarrativeCausalityOrchestrator.arbitrate_and_trigger(events, ctx, 1000)

	var passed = (triggered.size() == 2) and (triggered[0].event_id == "EVT_CALAMITY_COMET")
	return {
		"test": "TC-NARRATIVE-02: 多事件并发优先级权重精准仲裁",
		"passed": passed
	}

static func _test_chronicle_deterministic_hash_logging() -> Dictionary:
	var chronicle: Array[ChronicleLoggerPipeline.ChronicleEntryDTO] = []
	var evt := NarrativeEventAggregate.new("EVT_FOUND_NATION", "瓦尔兰独立建国")

	var entry = ChronicleLoggerPipeline.log_chronicle_event(chronicle, evt, 20260830, "玩家建立了第一座主权公国")

	var passed = (chronicle.size() == 1) and (entry.entry_hash.length() == 16) and (entry.event_id == "EVT_FOUND_NATION")
	return {
		"test": "TC-NARRATIVE-03: 确定性因果大事件哈希指纹与编年史落盘",
		"passed": passed
	}
