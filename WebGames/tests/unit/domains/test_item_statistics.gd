# ==============================================================================
# 单元测试：账号 UID 物品 ID 库统计系统 (Item Statistics Tests)
# 文件路径: res://tests/unit/domains/test_item_statistics.gd
# ==============================================================================
class_name TestItemStatisticsDomain
extends RefCounted

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_event_intake_and_tree_update())
	results.append(test_recursive_subtree_aggregation())
	results.append(test_account_uid_isolation())
	results.append(test_consumption_floor_clamp())
	results.append(test_global_aggregation_rbac_gate())
	# Phase 44 P3 新增：canonical 索引 O(1) 定位 + 反序列化后懒重建（TC-P44-P3-01）
	results.append(test_canonical_index_after_restore())

	var passed_cnt := 0
	for r in results:
		if r.get("passed", false):
			passed_cnt += 1

	return {
		"domain": "Domain 43: 账号UID物品ID库统计（递归挂载聚合）",
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

static func test_event_intake_and_tree_update() -> Dictionary:
	var lib := AccountItemLibraryAggregate.new("ACC_001")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	var telemetry := TelemetrySidecarEngine.new()

	# 事件接入：granted → current/total_gained + 遥测落点
	var r1 = ItemStatisticsSolver.record_item_event(
		lib, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 2, catalog, telemetry
	)
	var stats = ItemStatisticsSolver.query_account_item_stats(lib, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	var intake_ok = r1.success and (r1.actual_quantity == 2) \
		and stats.found and (int(stats.stats["current_quantity"]) == 2) \
		and (int(stats.stats["total_gained"]) == 2)

	# 树形挂载：按注册表分类自动递归建路径 EQUIPMENT → WEAPON_BLADE
	var subtree = ItemStatisticsSolver.query_account_subtree(lib, "EQUIPMENT", "WEAPON_BLADE")
	var tree_ok = (int(subtree["current_quantity"]) == 2) and (int(subtree["total_gained"]) == 2)

	# 遥测落点：事件入环形缓冲（含 account_id 维度）
	var telem_ok = (telemetry.get_buffer_count() == 1) and (telemetry.flush_events_batch().size() == 1)

	var passed = intake_ok and tree_ok and telem_ok
	return {
		"test": "TC-ITEM-STAT-01: 事件接入与 UID 树递归挂载/落账/遥测落点",
		"passed": passed
	}

static func test_recursive_subtree_aggregation() -> Dictionary:
	var lib := AccountItemLibraryAggregate.new("ACC_002")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	# 装备两件（不同小类）+ 消耗品一件（不同大类）
	ItemStatisticsSolver.record_item_event(lib, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 3, catalog)
	ItemStatisticsSolver.record_item_event(lib, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:EQUIP:ARMOR:IRON_CHEST", 1, catalog)
	ItemStatisticsSolver.record_item_event(lib, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:CONSUM:ALCHEMY:POTION_MANA", 5, catalog)

	# 递归聚合：EQUIPMENT 大类 = WEAPON_BLADE(3) + ARMOR(1) = 4
	var equip = ItemStatisticsSolver.query_account_subtree(lib, "EQUIPMENT")
	var equip_ok = (int(equip["current_quantity"]) == 4) and (int(equip["total_gained"]) == 4)

	# 全树聚合 = 4 + 5 = 9；叶节点遍历 = 3 件
	var all = ItemStatisticsSolver.query_account_subtree(lib)
	var all_ok = (int(all["current_quantity"]) == 9) and (lib.query_all_items().size() == 3)

	var passed = equip_ok and all_ok
	return {
		"test": "TC-ITEM-STAT-02: 分类子树递归聚合与全量遍历",
		"passed": passed
	}

static func test_account_uid_isolation() -> Dictionary:
	var lib_a := AccountItemLibraryAggregate.new("ACC_A")
	var lib_b := AccountItemLibraryAggregate.new("ACC_B")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	ItemStatisticsSolver.record_item_event(lib_a, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 2, catalog)

	# UID 隔离：B 账号库无此物品（互不可见）；A 查询正常
	var b_stats = ItemStatisticsSolver.query_account_item_stats(lib_b, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	var a_stats = ItemStatisticsSolver.query_account_item_stats(lib_a, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	var passed = (not b_stats.found) and a_stats.found \
		and (lib_b.account_id == "ACC_B") and (lib_a.account_id == "ACC_A")
	return {
		"test": "TC-ITEM-STAT-03: 按账号 UID 隔离（不同账号库互不可见）",
		"passed": passed
	}

static func test_consumption_floor_clamp() -> Dictionary:
	var lib := AccountItemLibraryAggregate.new("ACC_003")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	ItemStatisticsSolver.record_item_event(lib, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:CONSUM:ALCHEMY:POTION_MANA", 3, catalog)

	# 消耗 1 → current 2 / total_consumed 1
	ItemStatisticsSolver.record_item_event(lib, ItemStatisticsSolver.EVENT_ITEM_CONSUMED, "KALAR:CONSUM:ALCHEMY:POTION_MANA", 1, catalog)
	# 销毁 5 → 触底钳制：current 0、实际生效 2（不扣成负数），累计销毁 5
	var r_destroy = ItemStatisticsSolver.record_item_event(lib, ItemStatisticsSolver.EVENT_ITEM_DESTROYED, "KALAR:CONSUM:ALCHEMY:POTION_MANA", 5, catalog)
	var stats = ItemStatisticsSolver.query_account_item_stats(lib, "KALAR:CONSUM:ALCHEMY:POTION_MANA")
	var passed = (int(stats.stats["current_quantity"]) == 0) \
		and (int(r_destroy.actual_quantity) == 2) \
		and (int(stats.stats["total_destroyed"]) == 5)
	return {
		"test": "TC-ITEM-STAT-04: 消耗/销毁减量下限 0（触底钳制不扣负）",
		"passed": passed
	}

static func test_global_aggregation_rbac_gate() -> Dictionary:
	var lib_a := AccountItemLibraryAggregate.new("ACC_A")
	var lib_b := AccountItemLibraryAggregate.new("ACC_B")
	var catalog := ItemLoaderPipeline.build_catalog_from_config()
	ItemStatisticsSolver.record_item_event(lib_a, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 2, catalog)
	ItemStatisticsSolver.record_item_event(lib_b, ItemStatisticsSolver.EVENT_ITEM_GRANTED, "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 3, catalog)

	# RBAC 门禁：PLAYER(0) 拒绝；GAME_MASTER(2) 放行并跨账号聚合
	var denied = ItemStatisticsSolver.query_global_item_stats([lib_a, lib_b], "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", 0)
	var allowed = ItemStatisticsSolver.query_global_item_stats(
		[lib_a, lib_b], "KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD",
		AdminPermissionAggregate.AdminLevel.LEVEL_GAME_MASTER
	)
	var passed = (not denied.success) and (denied.error_code == "STATS_GLOBAL_FORBIDDEN") \
		and allowed.success and (int(allowed.agg["current_quantity"]) == 5) \
		and (int(allowed.agg["account_count"]) == 2)
	return {
		"test": "TC-ITEM-STAT-05: 跨账号全局聚合与 RBAC 权限门禁",
		"passed": passed
	}

## Phase 44 P3（TC-P44-P3-01）：canonical 索引 O(1) 定位——挂载后 find 命中即返；
## 模拟反序列化（新实例仅塞 root_node）后索引懒重建仍可 O(1) 定位，语义与线性扫等价。
static func test_canonical_index_after_restore() -> Dictionary:
	var lib := AccountItemLibraryAggregate.new("ACC_IDX")
	lib.mount_item("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", "EQUIPMENT", "WEAPON_BLADE")
	lib.mount_item("KALAR:CONSUM:ALCHEMY:POTION_MANA", "CONSUMABLE", "ALCHEMY")
	lib.apply_item_delta("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD", AccountItemLibraryAggregate.STAT_GAINED, 3)

	var found: Dictionary = lib.find_item_node("KALAR:EQUIP:WEAPON_BLADE:MITHRIL_LONGSWORD")
	var direct_ok: bool = not found.is_empty() \
		and str(found["path"][0]) == "EQUIPMENT" and str(found["path"][1]) == "WEAPON_BLADE" \
		and int(found["node"]["stats"].get(AccountItemLibraryAggregate.STAT_CURRENT, 0)) == 3

	# 反序列化重建：新实例只塞 root_node（索引为空）→ 首查触发懒重建仍命中且路径正确
	var restored := AccountItemLibraryAggregate.new("ACC_IDX")
	restored.root_node = lib.serialize()["root_node"]
	var found2: Dictionary = restored.find_item_node("KALAR:CONSUM:ALCHEMY:POTION_MANA")
	var lazy_ok: bool = not found2.is_empty() \
		and str(found2["path"][0]) == "CONSUMABLE" and str(found2["path"][1]) == "ALCHEMY"
	# 懒重建后索引生效：未挂载 id 仍返回空
	var miss: Dictionary = restored.find_item_node("KALAR:X:NOT_MOUNTED")
	var miss_ok: bool = miss.is_empty()

	var passed = direct_ok and lazy_ok and miss_ok
	return {
		"test": "TC-P44-P3-01: canonical 索引直查 + 反序列化懒重建（未挂载仍空）",
		"passed": passed
	}
