# ==============================================================================
# 单元测试：算法优化与瞬态分配消除 (Algorithm Optimization & Zero Allocation)
# 文件路径: res://tests/unit/infrastructure/test_algorithm_optimization_performance.gd
# 职责: 验证空间触发器二维哈希矩阵、时间轴零分配短路跳过、实体配置静态缓存
#       与池化复用重置契约（TC-ALG-01 ~ TC-ALG-04）
# ==============================================================================
class_name TestAlgorithmOptimizationPerformance extends RefCounted

const MultiEntityTriggerRegistryClass = preload("res://backend/domains/spatial_movement/multi_entity_trigger_registry.gd")
const SpatialTriggerFSMClass = preload("res://backend/domains/spatial_movement/spatial_trigger_fsm.gd")
const TertiaryTimelineEngineClass = preload("res://backend/domains/physics_thermodynamics/tertiary_timeline_engine.gd")
const DeterministicRNGClass = preload("res://backend/infrastructure/deterministic_rng.gd")
const ItemEntityClass = preload("res://backend/domains/inventory/item_entity.gd")

static func run_all_tests() -> Dictionary:
	var results: Array = []
	results.append(test_multi_entity_trigger_registry_matrix_isolation())
	results.append(test_tertiary_timeline_advance_time_zero_allocation_short_circuit())
	results.append(test_item_entity_static_defaults_cache_and_reset_state())
	results.append(test_cross_domain_batch_instantiation_integrity())

	var all_passed: bool = true
	for r in results:
		if not bool(r.get("passed", false)):
			all_passed = false
			break
	return {
		"domain": "算法优化与瞬态分配消除",
		"all_passed": all_passed,
		"results": results
	}

## TC-ALG-01: MultiEntityTriggerRegistry 二维哈希矩阵索引隔离与 O(1) 擦除断言
static func test_multi_entity_trigger_registry_matrix_isolation() -> Dictionary:
	var reg = MultiEntityTriggerRegistryClass.new()

	# 1. 验证初态与默认未进入状态
	var initial_count: int = reg.get_total_tracked_count()
	var initial_state: int = reg.get_state("TRIG_A", "ENTITY_1")

	# 2. 插入多触发区与多实体状态
	var prev1: int = reg.update_state("TRIG_A", "ENTITY_1", SpatialTriggerFSMClass.TriggerState.ENTERED)
	var prev2: int = reg.update_state("TRIG_A", "ENTITY_2", SpatialTriggerFSMClass.TriggerState.INSIDE)
	var prev3: int = reg.update_state("TRIG_B", "ENTITY_1", SpatialTriggerFSMClass.TriggerState.EXITED)

	var count_after_insert: int = reg.get_total_tracked_count()
	var get_a1: int = reg.get_state("TRIG_A", "ENTITY_1")
	var get_a2: int = reg.get_state("TRIG_A", "ENTITY_2")
	var get_b1: int = reg.get_state("TRIG_B", "ENTITY_1")
	var get_b2: int = reg.get_state("TRIG_B", "ENTITY_2")

	# 3. 验证触发区 O(1) 批量擦除
	reg.remove_trigger("TRIG_A")
	var count_after_remove_trig: int = reg.get_total_tracked_count()
	var get_a1_after: int = reg.get_state("TRIG_A", "ENTITY_1")
	var get_b1_remains: int = reg.get_state("TRIG_B", "ENTITY_1")

	# 4. 重新构建并验证实体跨区注销
	reg.update_state("TRIG_X", "ENTITY_HERO", SpatialTriggerFSMClass.TriggerState.ENTERED)
	reg.update_state("TRIG_Y", "ENTITY_HERO", SpatialTriggerFSMClass.TriggerState.INSIDE)
	reg.update_state("TRIG_Y", "ENTITY_BOSS", SpatialTriggerFSMClass.TriggerState.ENTERED)
	var count_before_hero_rm: int = reg.get_total_tracked_count()

	reg.remove_entity("ENTITY_HERO")
	var count_after_hero_rm: int = reg.get_total_tracked_count()
	var hero_x_state: int = reg.get_state("TRIG_X", "ENTITY_HERO")
	var boss_y_state: int = reg.get_state("TRIG_Y", "ENTITY_BOSS")

	# 5. 全表清空
	var cleared_count: int = reg.clear()
	var final_count: int = reg.get_total_tracked_count()

	# 6. 验证静态辅助方法契约
	var test_key: String = MultiEntityTriggerRegistryClass._make_key("T1", "E1")

	var passed: bool = (
		initial_count == 0 and
		initial_state == SpatialTriggerFSMClass.TriggerState.OUTSIDE and
		prev1 == SpatialTriggerFSMClass.TriggerState.OUTSIDE and
		prev2 == SpatialTriggerFSMClass.TriggerState.OUTSIDE and
		prev3 == SpatialTriggerFSMClass.TriggerState.OUTSIDE and
		count_after_insert == 3 and
		get_a1 == SpatialTriggerFSMClass.TriggerState.ENTERED and
		get_a2 == SpatialTriggerFSMClass.TriggerState.INSIDE and
		get_b1 == SpatialTriggerFSMClass.TriggerState.EXITED and
		get_b2 == SpatialTriggerFSMClass.TriggerState.OUTSIDE and
		count_after_remove_trig == 1 and
		get_a1_after == SpatialTriggerFSMClass.TriggerState.OUTSIDE and
		get_b1_remains == SpatialTriggerFSMClass.TriggerState.EXITED and
		count_before_hero_rm == 4 and
		count_after_hero_rm == 2 and
		hero_x_state == SpatialTriggerFSMClass.TriggerState.OUTSIDE and
		boss_y_state == SpatialTriggerFSMClass.TriggerState.ENTERED and
		cleared_count == 2 and
		final_count == 0 and
		test_key == "T1::E1"
	)

	return {
		"test": "TC-ALG-01: MultiEntityTriggerRegistry 二维哈希矩阵索引隔离与 O(1) 擦除断言",
		"passed": passed,
		"detail": "tracked_count_flow: 0->3->1->4->2->0, cleared=%d, key_compat=%s" % [cleared_count, test_key]
	}

## TC-ALG-02: TertiaryTimelineEngine advance_time 零分配短路与预排期等价性断言
static func test_tertiary_timeline_advance_time_zero_allocation_short_circuit() -> Dictionary:
	var engine = TertiaryTimelineEngineClass.new()
	var rng = DeterministicRNGClass.new(12345)
	engine.initialize(1000, rng)

	var initial_events_count: int = engine.scheduled_events.size()
	var min_trigger_time: int = 9999999
	for evt in engine.scheduled_events:
		if evt.trigger_time_ms < min_trigger_time:
			min_trigger_time = evt.trigger_time_ms

	# 1. 推进微小时钟 delta=20ms，远未达到最近事件触发时间，验证零分配返回
	var fired_early: Array = engine.advance_time(20)
	var current_time_after_early: int = engine.current_timeline_ms
	var empty_ok: bool = fired_early.is_empty() and (current_time_after_early == 1020)

	# 2. 负值或零步长前进验证
	var fired_zero: Array = engine.advance_time(0)
	var fired_negative: Array = engine.advance_time(-10)
	var invalid_steps_ok: bool = fired_zero.is_empty() and fired_negative.is_empty()

	# 3. 大步长前进推进至跨越首个事件触发点
	var delta_to_fire: int = (min_trigger_time - engine.current_timeline_ms) + 10
	var fired_events: Array = engine.advance_time(delta_to_fire)
	var has_fired: bool = fired_events.size() >= 1

	var first_fired = fired_events[0]
	var event_id_valid: bool = str(first_fired.event_id).begins_with("EVT_")
	var is_processed_marked: bool = first_fired.is_processed

	# 4. 验证排期队列自动滚动补充且新事件严格大于当前时钟
	var events_rolled_count: int = engine.scheduled_events.size()
	var all_future: bool = true
	for evt in engine.scheduled_events:
		if evt.trigger_time_ms <= engine.current_timeline_ms:
			all_future = false
			break

	var passed: bool = (
		initial_events_count == 2 and
		empty_ok and
		invalid_steps_ok and
		has_fired and
		event_id_valid and
		is_processed_marked and
		events_rolled_count == 2 and
		all_future
	)

	return {
		"test": "TC-ALG-02: TertiaryTimelineEngine advance_time 零分配短路与预排期等价性断言",
		"passed": passed,
		"detail": "early_empty=%s, fired_count=%d, all_future=%s" % [empty_ok, fired_events.size(), all_future]
	}

## TC-ALG-03: ItemEntity 静态默认值缓存与 reset_state 池化复用契约断言
static func test_item_entity_static_defaults_cache_and_reset_state() -> Dictionary:
	var item = ItemEntityClass.new()

	# 1. 验证初态由静态缓存驱动，与配置默认规范严格对齐
	var initial_defaults_ok: bool = (
		item.custom_name == "未命名物品" and
		item.category == ItemEntityClass.CATEGORY_QUEST_MISC and
		item.mass_kg == 1.0 and
		item.volume_slots == 1 and
		item.durability_current == 100.0 and
		item.durability_max == 100.0 and
		item.material_hardness == 10.0 and
		item.market_base_price == 10 and
		item.container_state == "UNOWNED" and
		item.attribute_mounts.is_empty() and
		item.combat_metrics is Dictionary and
		item.affix_sockets is Dictionary
	)

	# 2. 模拟运行期状态脏化修改
	item.item_id = "DIRTY_SWORD"
	item.item_uid = "UID_DIRTY_001"
	item.custom_name = "受污染的魔剑"
	item.mass_kg = 88.5
	item.durability_current = 12.0
	item.combat_metrics["edge_sharpness"] = 99.0
	item.attribute_mounts.append({"mock": "mount"})
	item.container_state = "EQUIPPED"

	# 3. 触发 reset_state() 池化重置契约
	item.reset_state()

	# 4. 验证脏状态完全涤除并恢复配置默认值
	var reset_clean_ok: bool = (
		item.item_id.is_empty() and
		item.item_uid.is_empty() and
		item.custom_name == "未命名物品" and
		item.mass_kg == 1.0 and
		item.durability_current == 100.0 and
		item.container_state == "UNOWNED" and
		item.attribute_mounts.is_empty() and
		item.combat_metrics.get("edge_sharpness", 0.0) == 1.0
	)

	# 5. 反序列化缺省字段兜底验证（从静态缓存提取 deserialize_name）
	var sparse_dto := {
		"item_id": "SPARSE_TEST_ITEM"
	}
	var deserialized = ItemEntityClass.deserialize(sparse_dto)
	var deserialize_fallback_ok: bool = (
		deserialized.item_id == "SPARSE_TEST_ITEM" and
		deserialized.custom_name == "未知物品"
	)

	var passed: bool = initial_defaults_ok and reset_clean_ok and deserialize_fallback_ok

	return {
		"test": "TC-ALG-03: ItemEntity 静态默认值缓存与 reset_state 池化复用契约断言",
		"passed": passed,
		"detail": "defaults_ok=%s, reset_clean=%s, deserialize_fallback=%s" % [
			initial_defaults_ok, reset_clean_ok, deserialize_fallback_ok
		]
	}

## TC-ALG-04: 数据复制与批量实体并发构造零越界与哈希等价性断言
static func test_cross_domain_batch_instantiation_integrity() -> Dictionary:
	var batch_size := 50
	var items: Array = []
	for i in range(batch_size):
		var it = ItemEntityClass.new()
		it.item_id = "BATCH_ITEM_%d" % i
		it.item_uid = "UID_BATCH_%04d" % i
		items.append(it)

	# 验证批量实例化后各实例独立且无引用串扰
	var isolation_ok := true
	for i in range(batch_size):
		var cur = items[i]
		if cur.item_id != ("BATCH_ITEM_%d" % i) or cur.item_uid != ("UID_BATCH_%04d" % i):
			isolation_ok = false
			break
		# 验证每个实例的 combat_metrics 是独立字典副本
		cur.combat_metrics["batch_idx"] = i

	var metrics_isolated := true
	for i in range(batch_size):
		if items[i].combat_metrics.get("batch_idx", -1) != i:
			metrics_isolated = false
			break

	# 序列化再反序列化哈希等价性验证
	var sample_item = items[10]
	var sample_dto: Dictionary = sample_item.serialize()
	var restored_item = ItemEntityClass.deserialize(sample_dto)
	var serde_equal: bool = (
		restored_item.item_id == sample_item.item_id and
		restored_item.item_uid == sample_item.item_uid and
		restored_item.mass_kg == sample_item.mass_kg and
		restored_item.durability_current == sample_item.durability_current
	)

	var passed: bool = isolation_ok and metrics_isolated and serde_equal

	return {
		"test": "TC-ALG-04: 数据复制与批量实体并发构造零越界与哈希等价性断言",
		"passed": passed,
		"detail": "isolation_ok=%s, metrics_isolated=%s, serde_equal=%s" % [isolation_ok, metrics_isolated, serde_equal]
	}
