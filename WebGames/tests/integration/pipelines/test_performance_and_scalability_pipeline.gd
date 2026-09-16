# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - Phase 64 全域核心算法性能加固与多实体扩展性测试套件
# 文件路径: res://tests/integration/pipelines/test_performance_and_scalability_pipeline.gd
# 职责: 验收物品统计O(1)增量累加、空间方位倒排索引、多实体状态机隔离、
#       剧情因果DAG邻接表索引与轻量会话序列化、背包增量度量及频控有界缓存。
# ==============================================================================
class_name TestPerformanceAndScalabilityPipeline
extends RefCounted

const DirectionAliasIndexClass = preload("res://backend/domains/spatial_movement/direction_alias_index.gd")
const MultiEntityTriggerRegistryClass = preload("res://backend/domains/spatial_movement/multi_entity_trigger_registry.gd")
const NarrativeDAGExecutionEngineClass = preload("res://backend/domains/narrative_orchestration/narrative_dag_execution_engine.gd")
const InventoryMetricSnapshotClass = preload("res://backend/domains/inventory/inventory_metric_snapshot.gd")
const NarrativeDagSessionDTOClass = preload("res://backend/domains/narrative_orchestration/narrative_dag_session_dto.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	var domain_name := "Phase 64: 全域核心算法性能加固与多实体扩展性治理验收流水线"

	results.append(_test_item_statistics_incremental_equivalence())
	results.append(_test_spatial_direction_alias_index())
	results.append(_test_spatial_multi_entity_trigger_isolation())
	results.append(_test_narrative_dag_adjacency_and_session_dto())
	results.append(_test_inventory_metric_snapshot_and_cdkey_rate_limits())
	# Phase 64 P2 修复回归：移动求解器静态缓存随配置热重载版本推进自动重建
	results.append(_test_movement_cache_rebuild_on_config_reload())

	var passed_cnt := 0
	for r in results:
		if bool(r.get("passed", false)):
			passed_cnt += 1

	return {
		"domain": domain_name,
		"passed_count": passed_cnt,
		"total_count": results.size(),
		"all_passed": (passed_cnt == results.size()),
		"results": results
	}

## TC-PF-01: 物品统计树自底向上 O(1) 增量累加与全量遍历等价性断言
static func _test_item_statistics_incremental_equivalence() -> Dictionary:
	var library := AccountItemLibraryAggregate.new("acc_perf_test_01")

	# 1. 批量挂载物品并施加增量（触发 O(1) _apply_delta_upwards 回溯）
	for i in range(20):
		var item_id := "ITEM_HERB_%02d" % i
		library.mount_item(item_id, "MATERIAL", "HERB")
		library.apply_item_delta(item_id, AccountItemLibraryAggregate.STAT_GAINED, 1)

	for i in range(10):
		var ore_id := "ITEM_ORE_%02d" % i
		library.mount_item(ore_id, "MATERIAL", "ORE")
		library.apply_item_delta(ore_id, AccountItemLibraryAggregate.STAT_GAINED, 2)

	var stats_herb = library.find_item_node("ITEM_HERB_00")
	var herb_ok: bool = (not stats_herb.is_empty()) and (stats_herb["node"]["stats"]["current_quantity"] == 1)

	# 2. 消耗一个物品验证增量扣减与下限保护
	var consume_res = library.apply_item_delta("ITEM_ORE_00", AccountItemLibraryAggregate.STAT_CONSUMED, 1)
	var post_ore = library.find_item_node("ITEM_ORE_00")
	var ore_ok: bool = (not post_ore.is_empty()) and (post_ore["node"]["stats"]["current_quantity"] == 1)

	# 3. 校验大类父级汇总（自底向上增量求和正确性）
	var major_stats = library.root_node["children"]["MATERIAL"]["stats"]
	var total_gained_ok: bool = (major_stats[AccountItemLibraryAggregate.STAT_GAINED] == 40) # 20*1 + 10*2 = 40
	var current_qty_ok: bool = (major_stats[AccountItemLibraryAggregate.STAT_CURRENT] == 39) # 40 - 1 = 39

	var passed: bool = (
		herb_ok and ore_ok and total_gained_ok and current_qty_ok and
		bool(consume_res.get("success", false))
	)
	return {
		"test": "TC-PF-01: 物品统计树自底向上 O(1) 增量累加与父级汇总严格一致",
		"passed": passed
	}

## TC-PF-02: 空间方位动词倒排静态索引查询与标准化映射断言
static func _test_spatial_direction_alias_index() -> Dictionary:
	var index_inst = DirectionAliasIndexClass.new()
	index_inst.alias_to_vector_map["NORTH"] = Vector2(0, -1)
	index_inst.alias_to_vector_map["N"] = Vector2(0, -1)
	index_inst.alias_to_vector_map["SOUTHEAST"] = Vector2(1, 1).normalized()

	var has_n: bool = index_inst.has_alias("n")
	var has_north: bool = index_inst.has_alias("NORTH")
	var has_invalid: bool = not index_inst.has_alias("FLY_UP")
	var vec_n: Vector2 = index_inst.get_vector("n")

	var v_north: Vector2 = MovementVectorBridgeSolver.translate_text_step_to_vector("NORTH", 10.0)
	var v_short_n: Vector2 = MovementVectorBridgeSolver.translate_text_step_to_vector("n", 10.0)
	var v_east: Vector2 = MovementVectorBridgeSolver.translate_text_step_to_vector("e", 5.0)

	var vec_match: bool = is_equal_approx(v_north.y, v_short_n.y) and is_equal_approx(v_east.x, 5.0)
	var alias_match: bool = has_n and has_north and has_invalid and is_equal_approx(vec_n.y, -1.0)

	# 测试结构化参数与速度计算
	var eff_speed: float = MovementVectorBridgeSolver.calculate_effective_speed(5.0, 10.0, 30.0, 1.0)
	var speed_ok: bool = is_equal_approx(eff_speed, 5.0)

	var passed: bool = alias_match and vec_match and speed_ok
	return {
		"test": "TC-PF-02: 空间方位动词倒排静态索引 O(1) 准确映射与结构化参数计算",
		"passed": passed
	}

## TC-PF-03: 空间触发器状态与多实体解耦并发状态机隔离断言
static func _test_spatial_multi_entity_trigger_isolation() -> Dictionary:
	var registry = MultiEntityTriggerRegistryClass.new()
	var trigger := SpatialTriggerFSM.SpatialTriggerArea.new("TRIGGER_PORTAL", Vector2(100, 100), 20.0)

	var pos_inside := Vector2(105, 100)
	var pos_outside := Vector2(0, 0)

	# 实体 A 进入触发区
	var state_a1: int = SpatialTriggerFSM.evaluate_entity_trigger_state(registry, trigger, "entity_hero", pos_inside)
	# 实体 B 处于触发区外
	var state_b1: int = SpatialTriggerFSM.evaluate_entity_trigger_state(registry, trigger, "entity_monster", pos_outside)

	# 再次评估实体 A（应进入 INSIDE 态）
	var state_a2: int = SpatialTriggerFSM.evaluate_entity_trigger_state(registry, trigger, "entity_hero", pos_inside)
	# 实体 B 仍然在外部（应保持 OUTSIDE）
	var state_b2: int = SpatialTriggerFSM.evaluate_entity_trigger_state(registry, trigger, "entity_monster", pos_outside)

	var a_isolated: bool = (state_a1 == SpatialTriggerFSM.TriggerState.ENTERED and state_a2 == SpatialTriggerFSM.TriggerState.INSIDE)
	var b_isolated: bool = (state_b1 == SpatialTriggerFSM.TriggerState.OUTSIDE and state_b2 == SpatialTriggerFSM.TriggerState.OUTSIDE)

	# 清理实体 A
	registry.remove_entity("entity_hero")
	var state_a_after_clear: int = registry.get_state("TRIGGER_PORTAL", "entity_hero")
	var state_b_remains: int = registry.get_state("TRIGGER_PORTAL", "entity_monster")

	var passed: bool = (
		a_isolated and b_isolated and
		state_a_after_clear == SpatialTriggerFSM.TriggerState.OUTSIDE and
		state_b_remains == SpatialTriggerFSM.TriggerState.OUTSIDE
	)
	return {
		"test": "TC-PF-03: 空间触发器状态机按 (trigger_id, entity_id) 复合键实现多实体严格隔离",
		"passed": passed
	}

## TC-PF-04: 剧情因果 DAG 邻接表出边直查与前置依赖哈希断言
static func _test_narrative_dag_adjacency_and_session_dto() -> Dictionary:
	var g := NarrativeDAGGraphDTO.new("TEST_GRAPH_PERF")
	g.entry_node_id = "N1"
	g.terminal_node_id = "N3"

	var n1 := NarrativeDAGNode.new("N1", NarrativeDAGNode.NodeType.START_ENTRY, "key.n1")
	var n2 := NarrativeDAGNode.new("N2", NarrativeDAGNode.NodeType.STANDARD_STEP, "key.n2")
	var n3 := NarrativeDAGNode.new("N3", NarrativeDAGNode.NodeType.TERMINAL_EXIT, "key.n3")
	g.add_node(n1)
	g.add_node(n2)
	g.add_node(n3)

	g.add_edge(NarrativeDAGEdge.new("N1", "N2"))
	g.add_edge(NarrativeDAGEdge.new("N2", "N3"))

	var engine = NarrativeDAGExecutionEngineClass.new()
	var init_res: Dictionary = engine.initialize_with_graph(g)

	# 出边直查验证
	var out_n1: Array = engine._get_outgoing_edges("N1")
	var out_n2: Array = engine._get_outgoing_edges("N2")
	var out_n3: Array = engine._get_outgoing_edges("N3")

	var adj_ok: bool = (out_n1.size() == 1 and out_n1[0].to_node_id == "N2" and out_n2.size() == 1 and out_n2[0].to_node_id == "N3" and out_n3.is_empty())

	# 状态推进与会话 DTO
	var act_res: Dictionary = engine.execute_node_action("N1")
	var dto = engine.export_session_dto()

	var dto_valid: bool = (dto != null and dto.graph_id == "TEST_GRAPH_PERF" and "N1" in dto.completed_node_ids)

	# 恢复到新引擎
	var engine2 = NarrativeDAGExecutionEngineClass.new()
	var restore_res: Dictionary = engine2.restore_session_dto(dto, g)
	var restore_ok: bool = bool(restore_res.get("success", false)) and engine2.active_node_ids.has("N2")

	var passed: bool = (
		adj_ok and bool(init_res.get("success", false)) and bool(act_res.get("success", false)) and
		dto_valid and restore_ok
	)
	return {
		"test": "TC-PF-04: 剧情因果 DAG 邻接表出边直查 O(1) 与会话 DTO 轻量无损往返",
		"passed": passed
	}

## TC-PF-05: 背包容量与负重 O(1) 增量累加与快照不可变 DTO 及频控有界断言
static func _test_inventory_metric_snapshot_and_cdkey_rate_limits() -> Dictionary:
	var inv = WearableInventoryAggregate.new()

	# 穿上背包提供 20 容积
	var backpack := ItemEntity.new()
	backpack.item_id = "ITEM_BACKPACK_01"
	backpack.custom_name = "Backpack"
	backpack.category = "ARMOR_EQUIPMENT"
	backpack.mass_kg = 1.0
	backpack.volume_slots = 20
	backpack.item_uid = "UID_BP_01"
	var equip_ok: bool = inv.equip_item("BACKPACK", backpack)

	# 添加 2 个物品
	var item1 := ItemEntity.new()
	item1.item_id = "ITEM_SWORD"
	item1.custom_name = "Sword"
	item1.category = "WEAPON_BLADE"
	item1.mass_kg = 3.5
	item1.volume_slots = 2
	item1.item_uid = "UID_SWORD_01"
	var add1_ok: bool = inv.add_item(item1)

	var item2 := ItemEntity.new()
	item2.item_id = "ITEM_SHIELD"
	item2.custom_name = "Shield"
	item2.category = "ARMOR_EQUIPMENT"
	item2.mass_kg = 4.0
	item2.volume_slots = 3
	item2.item_uid = "UID_SHIELD_01"
	var add2_ok: bool = inv.add_item(item2)

	# 获取快照 DTO
	var snapshot = inv.get_metric_snapshot()
	var cap_ok: bool = (snapshot.total_capacity_slots == 20)
	var vol_ok: bool = (snapshot.used_volume_slots == 5)
	var wt_ok: bool = is_equal_approx(snapshot.total_mass_kg, 8.5) # 1.0(背包) + 3.5 + 4.0

	# 移除 item1
	var rm_ok: bool = inv.remove_item(item1)
	var post_rm_snapshot = inv.get_metric_snapshot()
	var post_vol_ok: bool = (post_rm_snapshot.used_volume_slots == 3)
	var post_wt_ok: bool = is_equal_approx(post_rm_snapshot.total_mass_kg, 5.0)

	# 验证 CDKey 频控有界清理
	var rate_limits := {}
	rate_limits["acc_01"] = { "count": 5, "lock_until_utc": 1000 }
	rate_limits["acc_02"] = { "count": 2, "lock_until_utc": 2000 }
	rate_limits["acc_03"] = { "count": 5, "lock_until_utc": 4000 }

	var purged: int = CDKeyRedemptionSolver.purge_expired_rate_limits(rate_limits, 2500)
	var purge_ok: bool = (purged == 2 and rate_limits.size() == 1 and rate_limits.has("acc_03"))

	var passed: bool = (
		equip_ok and add1_ok and add2_ok and cap_ok and vol_ok and
		wt_ok and rm_ok and post_vol_ok and post_wt_ok and purge_ok
	)
	return {
		"test": "TC-PF-05: 背包容量/负重增量累加与快照不可变 DTO 及频控缓存有界清理",
		"passed": passed
	}

## Phase 64 P2 修复回归（红证：修复前 init_or_rebuild_cache 零外部触发点，
## 配置热重载后移动参数/别名静默冻结，与 S3「缓存热重载失效机制已闭环」不符）：
## 热重载版本推进后，下一次调用必须重建缓存并同步到新版本。
static func _test_movement_cache_rebuild_on_config_reload() -> Dictionary:
	var v_north: Vector2 = MovementVectorBridgeSolver.translate_text_step_to_vector("NORTH", 10.0)
	var built_version: int = MovementVectorBridgeSolver._cached_config_version
	var res := GameConfig.reload_config()
	var reload_ok: bool = res.get("success", false)
	# 热重载成功后，下一次调用必须重建缓存并同步到新版本
	MovementVectorBridgeSolver.translate_text_step_to_vector("NORTH", 10.0)
	var after_version: int = MovementVectorBridgeSolver._cached_config_version

	var passed: bool = reload_ok \
		and v_north == Vector2(0, -1) * 10.0 \
		and built_version >= 0 \
		and after_version == int(res.get("version", -1)) \
		and after_version >= built_version
	return {
		"test": "TC-PF-06: 移动求解器静态缓存随配置热重载版本推进自动重建（P2 接线回归）",
		"passed": passed
	}
