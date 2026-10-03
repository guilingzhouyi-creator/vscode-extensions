# ==============================================================================
# 单元测试：双域储存架构与异步流式加载全链路流水线
# 文件路径: res://tests/integration/pipelines/test_dual_domain_storage_pipeline.gd
# 职责: 覆盖主要数据极速恢复、最小世界状态 DTO 往返、辅助资源工作池并发调度、
#       取消令牌控制、主线程切片预算流控、空间预加载滑动窗口、DAG 定向热重载
#       与九维观测度量看板端到端无头断言。
# 需求源: 路线图短期施工区双域储存架构与流式加载规范
# ==============================================================================
class_name TestDualDomainStoragePipeline
extends TestCase

const StorageContractInterfaces = preload("res://backend/domains/persistence_protocol/storage_contract_interfaces.gd")
const MinimumWorldStateDTO = preload("res://backend/domains/persistence_protocol/dto/minimum_world_state_dto.gd")
const StorageMetricsDTO = preload("res://backend/domains/persistence_protocol/dto/storage_metrics_dto.gd")
const PrimaryStorageEngine = preload("res://backend/domains/persistence_protocol/primary_storage_engine.gd")
const AuxiliaryWorkerPool = preload("res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd")
const CancellationToken = preload("res://backend/domains/persistence_protocol/cancellation_token.gd")
const FrameBudgetDispatcher = preload("res://backend/domains/persistence_protocol/frame_budget_dispatcher.gd")
const PreloadWindowGovernor = preload("res://backend/domains/persistence_protocol/preload_window_governor.gd")
const ResourceDependencyDAG = preload("res://backend/domains/persistence_protocol/resource_dependency_dag.gd")
const TargetedHotReloader = preload("res://backend/domains/persistence_protocol/targeted_hot_reloader.gd")
const StorageObservability = preload("res://backend/domains/persistence_protocol/storage_observability.gd")
const SaveManager = preload("res://backend/infrastructure/save_manager.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_primary_storage_fast_recovery())
	results.append(test_auxiliary_worker_pool_priority_and_cancellation())
	results.append(test_frame_budget_dispatcher_time_slicing())
	results.append(test_preload_window_governor_spatial_filtering())
	results.append(test_resource_dependency_dag_and_targeted_hot_reload())
	results.append(test_storage_observability_nine_metrics_snapshot())
	results.append(test_dto_serialization_and_object_pool_reset())

	return TestCase.pack_results("双域储存架构与异步流式加载流水线", results)

static func _cleanup_test_save(slot_id: String) -> void:
	var base_path := "user://saves/" + slot_id + ".kalar_save"
	DirAccess.remove_absolute(base_path)
	DirAccess.remove_absolute(base_path + ".bak")
	DirAccess.remove_absolute(base_path + ".tmp")

# ---- TC-DDS-01: 主要数据极速恢复引擎与最小世界状态提取 ----
static func test_primary_storage_fast_recovery() -> Dictionary:
	var test_slot := "test_slot_dual_01"
	_cleanup_test_save(test_slot)

	var payload := {
		"account": {"account_id": "ACC_DUAL_99"},
		"character": {"name": "KalarGuardian", "level": 12},
		"lifecycle": {"hp": 85.0, "max_hp": 120.0},
		"world_mode": "SINGLE_PLAYER",
		"currency_economy": {"gold": 2500, "crystals": 80},
		"prologue_completed": true
	}
	var engine = PrimaryStorageEngine.get_instance()
	var save_res: Dictionary = engine.save_primary_data(test_slot, payload)
	assert_true(bool(save_res.get("success", false)), "TC-DDS-01A: 主要世界数据原子保存应成功")

	var restore_res: Dictionary = engine.quick_restore_minimal_state(test_slot)
	assert_true(bool(restore_res.get("success", false)), "TC-DDS-01B: 最小世界状态极速恢复应成功")

	var state: MinimumWorldStateDTO = restore_res.get("state", null)
	assert_not_null(state, "TC-DDS-01C: 恢复的最小世界状态 DTO 不应为空")
	assert_eq(state.account_id, "ACC_DUAL_99", "TC-DDS-01D: 账号 ID 应无损还原")
	assert_eq(state.character_name, "KalarGuardian", "TC-DDS-01E: 角色名应无损还原")
	assert_eq(state.level, 12, "TC-DDS-01F: 角色等级应一致")
	assert_eq(int(state.current_hp), 85, "TC-DDS-01G: 当前生命值应一致")
	assert_true(state.prologue_completed, "TC-DDS-01H: 序章完成标记应为 true")
	assert_true(float(restore_res.get("duration_ms", 999.0)) < 50.0, "TC-DDS-01I: 极速恢复耗时应受预算约束")

	var is_valid: bool = engine.verify_integrity(test_slot)
	assert_true(is_valid, "TC-DDS-01J: 完整性签名校验应通过")

	_cleanup_test_save(test_slot)
	PrimaryStorageEngine.reset_for_tests()
	return {"test": "TC-DDS-01: 主要数据极速恢复引擎与最小世界状态提取", "passed": true}

# ---- TC-DDS-02: 辅助资源工作池并发调度、优先级与取消令牌 ----
static func test_auxiliary_worker_pool_priority_and_cancellation() -> Dictionary:
	AuxiliaryWorkerPool.reset_for_tests()
	var pool = AuxiliaryWorkerPool.get_instance()
	pool.set_deterministic_mode(true)

	var token := CancellationToken.new()
	assert_false(token.is_cancelled(), "TC-DDS-02A: 新创建取消令牌应未取消")

	# 1. 取消令牌生效断言
	token.cancel()
	assert_true(token.is_cancelled(), "TC-DDS-02B: 取消后令牌状态应为 true")

	var cancelled_callback_called := false
	var task_id: int = pool.request_resource_async("config/infrastructure/storage.json", StorageContractInterfaces.LoadPriority.NORMAL, token, func(ok: bool, _data: Variant, err: String):
		cancelled_callback_called = true
		assert_false(ok, "TC-DDS-02C: 被取消的任务回调应指示失败")
		assert_eq(err, StorageContractInterfaces.ERR_TASK_CANCELLED, "TC-DDS-02D: 错误码应为 ERR_TASK_CANCELLED")
	)
	assert_true(task_id > 0, "TC-DDS-02E: 应返回有效任务 ID")
	assert_true(cancelled_callback_called, "TC-DDS-02F: 确定性模式下取消回调应已触发")

	# 2. 正常资源异步读取与缓存断言
	var fresh_token := CancellationToken.new()
	var success_called := false
	pool.request_resource_async("config/infrastructure/storage.json", StorageContractInterfaces.LoadPriority.CRITICAL, fresh_token, func(ok: bool, data: Variant, _err: String):
		success_called = true
		assert_true(ok, "TC-DDS-02G: 存在资源读取应成功")
		assert_not_null(data, "TC-DDS-02H: 解析数据不应为空")
	)
	assert_true(success_called, "TC-DDS-02I: 资源加载回调应成功执行")

	var cached_item: Variant = pool.get_cached_resource("config/infrastructure/storage.json")
	assert_not_null(cached_item, "TC-DDS-02J: 结果应安全写入缓存")

	var evicted: int = pool.evict_idle_resources()
	assert_gt(evicted, 0, "TC-DDS-02K: 逐出闲置资源应清空缓存")

	AuxiliaryWorkerPool.reset_for_tests()
	return {"test": "TC-DDS-02: 辅助资源工作池并发调度、优先级与取消令牌", "passed": true}

# ---- TC-DDS-03: 主线程切片预算调度器时间控制与排队 ----
static func test_frame_budget_dispatcher_time_slicing() -> Dictionary:
	FrameBudgetDispatcher.reset_for_tests()
	var dispatcher = FrameBudgetDispatcher.get_instance()

	var counter := [0]
	var action := func() -> void:
		counter[0] += 1

	for i in range(5):
		dispatcher.enqueue_submission(action, 1)

	assert_eq(dispatcher.get_pending_count(), 5, "TC-DDS-03A: 待提交任务队列应包含 5 项")

	var slice_res: Dictionary = dispatcher.pump_slice(50.0)
	assert_eq(int(slice_res.get("executed_count", 0)), 5, "TC-DDS-03B: 充足预算下应全量提交")
	assert_eq(counter[0], 5, "TC-DDS-03C: 任务执行次数应为 5")
	assert_eq(dispatcher.get_pending_count(), 0, "TC-DDS-03D: 执行后队列应排空")

	FrameBudgetDispatcher.reset_for_tests()
	return {"test": "TC-DDS-03: 主线程切片预算调度器时间控制与排队", "passed": true}

# ---- TC-DDS-04: 动态预加载滑动窗口管理器与空间候选过滤 ----
static func test_preload_window_governor_spatial_filtering() -> Dictionary:
	PreloadWindowGovernor.reset_for_tests()
	var governor = PreloadWindowGovernor.get_instance()
	governor.update_focus(Vector2(0, 0), "scene_hub")

	assert_true(governor.is_within_window(Vector2(20, 20), "scene_hub"), "TC-DDS-04A: 半径内同场景资源应在窗口内")
	assert_false(governor.is_within_window(Vector2(500, 500), "scene_hub"), "TC-DDS-04B: 超出半径资源应在窗口外")
	assert_false(governor.is_within_window(Vector2(10, 10), "scene_dungeon"), "TC-DDS-04C: 异场景资源应在窗口外")

	var candidates := [
		{"position": Vector2(10, 10), "scene_id": "scene_hub", "name": "npc_01"},
		{"position": Vector2(300, 300), "scene_id": "scene_hub", "name": "npc_far"},
		{"position": Vector2(5, 5), "scene_id": "scene_dungeon", "name": "npc_other_scene"}
	]
	var filtered: Array = governor.filter_candidates(candidates)
	assert_eq(filtered.size(), 1, "TC-DDS-04D: 候选过滤后应仅保留 1 个视锥内资源")
	assert_eq(String(filtered[0]["name"]), "npc_01", "TC-DDS-04E: 保留的资源应为近邻资源")

	PreloadWindowGovernor.reset_for_tests()
	return {"test": "TC-DDS-04: 动态预加载滑动窗口管理器与空间候选过滤", "passed": true}

# ---- TC-DDS-05: 资源依赖 DAG 失效拓扑与定向热重载容错回滚 ----
static func test_resource_dependency_dag_and_targeted_hot_reload() -> Dictionary:
	TargetedHotReloader.reset_for_tests()
	var reloader = TargetedHotReloader.get_instance()
	var dag = reloader.get_dag()

	dag.add_dependency("config/items.json", "item_factory")
	dag.add_dependency("item_factory", "inventory_ui")

	var invalidations: Array = dag.get_invalidation_subgraph("config/items.json")
	assert_true(invalidations.has("item_factory"), "TC-DDS-05A: 失效子图应包含直接下游 item_factory")
	assert_true(invalidations.has("inventory_ui"), "TC-DDS-05B: 失效子图应包含传递下游 inventory_ui")

	# 定向热重载成功路径
	var reloaded_nodes := []
	var resolver := func(node_id: String) -> Dictionary:
		reloaded_nodes.append(node_id)
		return {"success": true, "data": "updated_" + node_id}

	var reload_res: Dictionary = reloader.trigger_reload("config/items.json", resolver)
	assert_true(bool(reload_res.get("success", false)), "TC-DDS-05C: 定向热重载应成功")
	assert_eq(int(reload_res.get("reloaded_count", 0)), 2, "TC-DDS-05D: 刷新节点数应为 2")

	# 定向热重载失败回滚路径
	var fail_resolver := func(node_id: String) -> Dictionary:
		if node_id == "inventory_ui":
			return {"success": false, "data": null}
		return {"success": true, "data": "ok"}

	var fail_reload_res: Dictionary = reloader.trigger_reload("config/items.json", fail_resolver)
	assert_false(bool(fail_reload_res.get("success", true)), "TC-DDS-05E: 存在节点失败时热重载应标记失败")
	assert_true(bool(fail_reload_res.get("rollback_performed", false)), "TC-DDS-05F: 失败应触发安全回滚")

	TargetedHotReloader.reset_for_tests()
	return {"test": "TC-DDS-05: 资源依赖 DAG 失效拓扑与定向热重载容错回滚", "passed": true}

# ---- TC-DDS-06: 九维储存观测指标看板聚合与快照输出 ----
static func test_storage_observability_nine_metrics_snapshot() -> Dictionary:
	StorageObservability.reset_for_tests()
	var obs = StorageObservability.get_instance()

	obs.record_primary_recovery(4.2, 5.8)
	obs.record_auxiliary_load(2048, 10.0, false, false)
	obs.record_auxiliary_load(0, 0.5, false, true)
	obs.record_main_thread_wait(0.0)

	var snapshot: StorageMetricsDTO = obs.get_metrics_snapshot()
	assert_not_null(snapshot, "TC-DDS-06A: 指标快照不应为空")
	assert_eq(snapshot.primary_recovery_time_ms, 4.2, "TC-DDS-06B: 主数据恢复耗时应一致")
	assert_eq(snapshot.time_to_first_interactive_ms, 5.8, "TC-DDS-06C: TTFI 耗时应一致")
	assert_gt(snapshot.auxiliary_throughput_mb_per_sec, 0.0, "TC-DDS-06D: 吞吐率应大于 0")
	assert_eq(snapshot.main_thread_io_wait_ms, 0.0, "TC-DDS-06E: 主线程 IO 等待应为 0")
	assert_eq(snapshot.cache_hit_rate, 0.5, "TC-DDS-06F: 缓存命中率应为 50%")
	assert_gt(snapshot.frame_submission_budget_ms, 0.0, "TC-DDS-06G: 帧预算应大于 0")
	assert_gt(snapshot.peak_memory_mb, 0.0, "TC-DDS-06H: 峰值内存应大于 0")

	StorageObservability.reset_for_tests()
	return {"test": "TC-DDS-06: 九维储存观测指标看板聚合与快照输出", "passed": true}

# ---- TC-DDS-07: DTO 序列化往返自洽性与对象池复位契约 ----
static func test_dto_serialization_and_object_pool_reset() -> Dictionary:
	var state_dto := MinimumWorldStateDTO.new("ACC_DTO_01", "slot_dto_01", "HeroDto", "SINGLE_PLAYER")
	state_dto.level = 8
	state_dto.current_hp = 70.0
	state_dto.max_hp = 100.0

	var dict_data := state_dto.to_dict()
	var restored: MinimumWorldStateDTO = MinimumWorldStateDTO.from_dict(dict_data)

	assert_eq(restored.account_id, "ACC_DTO_01", "TC-DDS-07A: 序列化还原账号 ID 应一致")
	assert_eq(restored.character_name, "HeroDto", "TC-DDS-07B: 序列化还原角色名应一致")
	assert_eq(restored.level, 8, "TC-DDS-07C: 序列化还原等级应一致")

	state_dto.reset_state()
	assert_eq(state_dto.account_id, "", "TC-DDS-07D: reset_state 后账号 ID 应为空")
	assert_eq(state_dto.character_name, "", "TC-DDS-07E: reset_state 后角色名应为空")

	var metrics_dto := StorageMetricsDTO.new()
	metrics_dto.primary_recovery_time_ms = 2.5
	metrics_dto.cache_hit_rate = 0.8
	var m_dict := metrics_dto.to_dict()
	var m_restored: StorageMetricsDTO = StorageMetricsDTO.from_dict(m_dict)

	assert_eq(m_restored.primary_recovery_time_ms, 2.5, "TC-DDS-07F: 度量 DTO 还原耗时应一致")
	assert_eq(m_restored.cache_hit_rate, 0.8, "TC-DDS-07G: 度量 DTO 还原命中率应一致")

	metrics_dto.reset_state()
	assert_eq(metrics_dto.primary_recovery_time_ms, 0.0, "TC-DDS-07H: reset_state 后度量耗时应清零")

	return {"test": "TC-DDS-07: DTO 序列化往返自洽性与对象池复位契约", "passed": true}
