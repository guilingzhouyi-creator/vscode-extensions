# ==============================================================================
# 单元测试：通用组合事件提取器 (Composite Event Extractor Tests)
# 文件路径: res://tests/unit/domains/test_event_extractor.gd
# ==============================================================================
class_name TestEventExtractorDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_group_compose())
	results.append(test_materialize_floor_equivalence())
	results.append(test_rule_driven_and_raw_fallback())
	results.append(test_uid_isolation_and_idempotency())
	# Phase 54 L10 新增：组合键分隔符碰撞消除
	results.append(test_composite_key_no_separator_collision())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": "Domain 45: 通用组合事件提取器（分组/组合/物化/投影）",
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func test_group_compose() -> Dictionary:
	var lib := AccountItemLibraryAggregate.new("ACC_001")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var batch := [
		{
			"account_id": "ACC_001", "event_type": "item.granted",
			"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "quantity": 2,
			"transaction_id": "TX_CDKEY_1", "currency_delta": { "gold": 500 },
			"meta": { "rule_id": "rule_cdkey_redeem" }
		},
		{
			"account_id": "ACC_001", "event_type": "item.granted",
			"canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "quantity": 1,
			"transaction_id": "TX_CDKEY_1",
			"meta": { "rule_id": "rule_cdkey_redeem" }
		}
	]
	var res = CompositeEventExtractor.extract(batch, { "ACC_001": lib }, {}, catalog)

	# 一事务一组合事件：composed_count == 1；两条物品流全部物化
	var composed_ok = res.success and (int(res.composed_count) == 1) and (int(res.materialized_flows) == 2)
	# 物化落树：两件物品各自 current 正确
	var s1 = ItemStatisticsSolver.query_account_item_stats(lib, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	var s2 = ItemStatisticsSolver.query_account_item_stats(lib, "KALAR:CONSUM:ALCHEMY:POTION_MANA")
	var tree_ok = s1.found and (int(s1.stats["current_quantity"]) == 2) \
		and s2.found and (int(s2.stats["current_quantity"]) == 1)
	# 组合投影：货币增量折叠进组合事件
	var proj: Array = res.projections
	var proj_ok = (proj.size() == 1) and (int(proj[0].currency_delta.get("gold", 0)) == 500) \
		and (int(proj[0].item_flow_count) == 2)

	var passed = composed_ok and tree_ok and proj_ok
	return {
		"test": "TC-EXT-01: 分组组合正确性（一事务一组合事件，货币增量折叠）",
		"passed": passed
	}

static func test_materialize_floor_equivalence() -> Dictionary:
	var lib := AccountItemLibraryAggregate.new("ACC_002")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	# 预置当前持有 2
	ItemStatisticsSolver.record_item_event(lib, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:CONSUM:ALCHEMY:POTION_MANA", 2, catalog)
	# 组合批次：销毁 5 → 触底钳制实际 2（与逐条落账等价）
	var batch := [
		{
			"account_id": "ACC_002", "event_type": "item.destroyed",
			"canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "quantity": 5,
			"transaction_id": "TX_DISPOSAL_1",
			"meta": { "rule_id": "rule_disposal" }
		}
	]
	var res = CompositeEventExtractor.extract(batch, { "ACC_002": lib }, {}, catalog)
	var stats = ItemStatisticsSolver.query_account_item_stats(lib, "KALAR:CONSUM:ALCHEMY:POTION_MANA")
	var passed = res.success \
		and (int(stats.stats["current_quantity"]) == 0) \
		and (int(stats.stats["total_destroyed"]) == 5) \
		and (res.clamped_flows.size() == 1) \
		and (int(res.clamped_flows[0].requested) == 5) and (int(res.clamped_flows[0].actual) == 2)
	return {
		"test": "TC-EXT-02: 物化落树含减量下限（组合路径与逐条落账等价、钳制返回）",
		"passed": passed
	}

static func test_rule_driven_and_raw_fallback() -> Dictionary:
	# 规则驱动：自定义规则表的 composite_event 名决定遥测事件名（零硬编码）
	var custom_rules := {
		"grouping_rules": [
			{
				"rule_id": "rule_custom", "source_event": "item.granted",
				"group_key": "transaction_id", "composite_event": "transaction.custom_test", "projection": ""
			}
		],
		"projections": {}
	}
	var lib := AccountItemLibraryAggregate.new("ACC_003")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var telemetry := TelemetrySidecarEngine.new()
	var batch := [
		{
			"account_id": "ACC_003", "event_type": "item.granted",
			"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "quantity": 1,
			"transaction_id": "TX_CUSTOM_1",
			"meta": { "rule_id": "rule_custom" }
		}
	]
	var res = CompositeEventExtractor.extract(batch, { "ACC_003": lib }, custom_rules, catalog, telemetry)
	var evts = telemetry.flush_events_batch()
	var rule_ok = res.success and (int(res.composed_count) == 1) \
		and (evts.size() == 1) and (evts[0].event_name == "transaction.custom_test")

	# 空键守卫：无 transaction_id 事件不组合、逐条落账（不吞没）
	var lib2 := AccountItemLibraryAggregate.new("ACC_004")
	var batch_raw := [
		{
			"account_id": "ACC_004", "event_type": "item.granted",
			"canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "quantity": 1,
			"transaction_id": ""
		}
	]
	var res_raw = CompositeEventExtractor.extract(batch_raw, { "ACC_004": lib2 }, custom_rules, catalog)
	var s = ItemStatisticsSolver.query_account_item_stats(lib2, "KALAR:CONSUM:ALCHEMY:POTION_MANA")
	var raw_ok = (int(res_raw.raw_materialized_count) == 1) and s.found \
		and (int(s.stats["current_quantity"]) == 1)

	var passed = rule_ok and raw_ok
	return {
		"test": "TC-EXT-03: 规则驱动无硬编码 + 空键守卫逐条落账",
		"passed": passed
	}

static func test_uid_isolation_and_idempotency() -> Dictionary:
	var lib_a := AccountItemLibraryAggregate.new("ACC_A")
	var lib_b := AccountItemLibraryAggregate.new("ACC_B")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var batch := [
		{
			"account_id": "ACC_A", "event_type": "item.granted",
			"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "quantity": 2,
			"transaction_id": "TX_SHARED_1",
			"meta": { "rule_id": "rule_cdkey_redeem" }
		},
		{
			"account_id": "ACC_B", "event_type": "item.granted",
			"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "quantity": 3,
			"transaction_id": "TX_SHARED_1",
			"meta": { "rule_id": "rule_cdkey_redeem" }
		}
	]
	var libraries := { "ACC_A": lib_a, "ACC_B": lib_b }
	var res = CompositeEventExtractor.extract(batch, libraries, {}, catalog)
	var a = ItemStatisticsSolver.query_account_item_stats(lib_a, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	var b = ItemStatisticsSolver.query_account_item_stats(lib_b, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	# UID 隔离：同事务键不同账号各自独立落账
	var iso_ok = (int(a.stats["current_quantity"]) == 2) and (int(b.stats["current_quantity"]) == 3) \
		and (int(res.composed_count) == 2)
	# RBAC 门禁：全局聚合需 GAME_MASTER
	var denied = ItemStatisticsSolver.query_global_item_stats([lib_a, lib_b], "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 0)
	var allowed = ItemStatisticsSolver.query_global_item_stats([lib_a, lib_b], "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER)
	var gate_ok = (not denied.success) and (denied.error_code == "STATS_GLOBAL_FORBIDDEN") \
		and allowed.success and (int(allowed.agg["current_quantity"]) == 5) \
		and (int(allowed.agg["account_count"]) == 2)
	# 幂等：processed_keys 共享后重复提取全部跳过
	var processed := {}
	CompositeEventExtractor.extract(batch, libraries, {}, catalog, null, processed)
	var res2 = CompositeEventExtractor.extract(batch, libraries, {}, catalog, null, processed)
	var idem_ok = (int(res2.composed_count) == 0) and (res2.skipped_keys.size() == 2)

	var passed = iso_ok and gate_ok and idem_ok
	return {
		"test": "TC-EXT-04: UID 隔离 + RBAC 门禁 + 幂等（processed_keys 跳过）",
		"passed": passed
	}

static func test_composite_key_no_separator_collision() -> Dictionary:
	# L10（Phase 54）：长度前缀组合键消除 "|" 拼接碰撞——
	# account="A|B"+txn="TX" 与 account="A"+txn="B|TX"（旧 KEY_SEP 拼接出同键 → 跨账号并组污染）
	var lib_a := AccountItemLibraryAggregate.new("A|B")
	var lib_b := AccountItemLibraryAggregate.new("A")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var batch := [
		{
			"account_id": "A|B", "event_type": "item.granted",
			"canonical_id": "KALAR:CONSUM:ALCHEMY:POTION_MANA", "quantity": 1,
			"transaction_id": "TX", "meta": { "rule_id": "rule_test" }
		},
		{
			"account_id": "A", "event_type": "item.granted",
			"canonical_id": "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "quantity": 1,
			"transaction_id": "B|TX", "meta": { "rule_id": "rule_test" }
		}
	]
	var res = CompositeEventExtractor.extract(batch, { "A|B": lib_a, "A": lib_b }, {}, catalog)
	var passed = res.success and int(res.composed_count) == 2
	return { "test": "TC-EXT-05: 组合键长度前缀编码（L10 竖线分隔符碰撞消除）", "passed": passed }
