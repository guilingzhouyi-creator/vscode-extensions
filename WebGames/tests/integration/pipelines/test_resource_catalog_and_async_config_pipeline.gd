# ==============================================================================
# 单元测试：统一资源索引中心与配置系统异步流式加载全链路流水线
# 文件路径: res://tests/integration/pipelines/test_resource_catalog_and_async_config_pipeline.gd
# 职责: 覆盖资源索引注册中心解析、多态解码器分发、GameConfig L0 极速启动预算、
#       辅助资源工作池批量载入栅栏、JIT 按需实时兜底加载、批任务取消令牌阻断、
#       DTO 序列化自洽性与测试单例隔离复位。
# ==============================================================================
class_name TestResourceCatalogAndAsyncConfigPipeline
extends TestCase

const StorageContractInterfaces = preload("res://backend/domains/persistence_protocol/storage_contract_interfaces.gd")
const ResourceIndexEntryDTO = preload("res://backend/domains/persistence_protocol/dto/resource_index_entry_dto.gd")
const BatchLoadRequestDTO = preload("res://backend/domains/persistence_protocol/dto/batch_load_request_dto.gd")
const ResourceDecoderRegistry = preload("res://backend/domains/persistence_protocol/resource_decoder_registry.gd")
const StorageResourceCatalog = preload("res://backend/domains/persistence_protocol/storage_resource_catalog.gd")
const AuxiliaryWorkerPool = preload("res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd")
const CancellationToken = preload("res://backend/domains/persistence_protocol/cancellation_token.gd")

static func run_all_tests() -> Dictionary:
	var results: Array[Dictionary] = []
	results.append(test_catalog_resolution_and_indexing())
	results.append(test_resource_decoder_polymorphism())
	results.append(test_game_config_l0_boot_budget())
	results.append(test_worker_pool_batch_load_barrier())
	results.append(test_game_config_jit_fallback())
	results.append(test_batch_load_cancellation())
	results.append(test_dto_serialization_and_reset())
	results.append(test_singleton_isolation_cleanup())

	return TestCase.pack_results("统一资源索引中心与配置系统异步流式加载流水线", results)

# ---- TC-RIC-01: 资源索引中心全域表名索引与极速寻址 ----
static func test_catalog_resolution_and_indexing() -> Dictionary:
	StorageResourceCatalog.reset_for_tests()
	var catalog = StorageResourceCatalog.get_instance()
	catalog.ensure_catalog_loaded()

	var storage_entry: ResourceIndexEntryDTO = catalog.resolve_config_table_entry("infrastructure.storage")
	assert_not_null(storage_entry, "TC-RIC-01A: storage 表索引项不应为空")
	assert_eq(storage_entry.priority, StorageContractInterfaces.LoadPriority.CRITICAL, "TC-RIC-01B: storage 应判定为 L0 关键启动表")
	assert_true(storage_entry.physical_path.ends_with("infrastructure/storage.json"), "TC-RIC-01C: 物理路径应指向 storage.json")

	var account_entry: ResourceIndexEntryDTO = catalog.resolve_config_table_entry("domains.account")
	assert_not_null(account_entry, "TC-RIC-01D: domains 派生的 account 表索引项应存在")
	assert_eq(account_entry.category, "config", "TC-RIC-01E: 领域配置分类应为 config")

	var critical_entries: Array = catalog.get_critical_boot_entries()
	assert_gt(critical_entries.size(), 0, "TC-RIC-01F: 关键启动项集合不应为空")

	var has_storage: bool = catalog.has_resource("config.infrastructure.storage")
	assert_true(has_storage, "TC-RIC-01G: storage 逻辑资源键应存在")

	var batch_manifest: BatchLoadRequestDTO = catalog.build_manifest_for_state(null)
	assert_not_null(batch_manifest, "TC-RIC-01H: 批量清单生成不应为空")
	assert_gt(batch_manifest.total_count, 0, "TC-RIC-01I: 批量清单任务数应大于 0")

	StorageResourceCatalog.reset_for_tests()
	return {"test": "TC-RIC-01: 资源索引中心全域表名索引与极速寻址", "passed": true}

# ---- TC-RIC-02: 多态资源解码器注册与解析分发 ----
static func test_resource_decoder_polymorphism() -> Dictionary:
	ResourceDecoderRegistry.reset_for_tests()
	var registry = ResourceDecoderRegistry.get_instance()

	# 1. 内置 JSON 解码器测试
	var json_entry := ResourceIndexEntryDTO.new("res_json", "res://config/domains/combat.json", "config", 2)
	var valid_json_str: String = "{\"test_key\": 1234, \"status\": \"ok\"}"
	var valid_json_raw: PackedByteArray = valid_json_str.to_utf8_buffer()
	var json_res: Dictionary = registry.decode(valid_json_raw, valid_json_str, json_entry)
	assert_eq(String(json_res.get("error", "")), StorageContractInterfaces.ERR_NONE, "TC-RIC-02A: 合法 JSON 解码应无错误")
	var json_data: Dictionary = json_res.get("data", {})
	assert_eq(int(json_data.get("test_key", 0)), 1234, "TC-RIC-02B: JSON 解码内容应一致")

	var invalid_json_str: String = "{broken_json:"
	var invalid_json_raw: PackedByteArray = invalid_json_str.to_utf8_buffer()
	var err_res: Dictionary = registry.decode(invalid_json_raw, invalid_json_str, json_entry)
	assert_eq(String(err_res.get("error", "")), StorageContractInterfaces.ERR_CORRUPT, "TC-RIC-02C: 畸形 JSON 解码应报 ERR_CORRUPT")

	# 2. 内置 Text 解码器测试
	var text_entry := ResourceIndexEntryDTO.new("res_txt", "res://narratives/intro.txt", "text", 3)
	var text_str: String = "Hello Kalar Engine"
	var text_raw: PackedByteArray = text_str.to_utf8_buffer()
	var text_res: Dictionary = registry.decode(text_raw, text_str, text_entry)
	assert_eq(String(text_res.get("error", "")), StorageContractInterfaces.ERR_NONE, "TC-RIC-02D: 纯文本解码应成功")
	assert_eq(String(text_res.get("data", "")), "Hello Kalar Engine", "TC-RIC-02E: 纯文本内容应一致")

	# 3. 默认解码器选择断言
	var decoder = registry.get_decoder_for_entry(null)
	assert_not_null(decoder, "TC-RIC-02F: 空 entry 应安全回退默认解码器")

	ResourceDecoderRegistry.reset_for_tests()
	return {"test": "TC-RIC-02: 多态资源解码器注册与解析分发", "passed": true}

# ---- TC-RIC-03: GameConfig L0 极速启动与时间预算约束 ----
static func test_game_config_l0_boot_budget() -> Dictionary:
	var start_us: int = Time.get_ticks_usec()
	GameConfig.ensure_l0_loaded_sync()
	var elapsed_ms: float = float(Time.get_ticks_usec() - start_us) / 1000.0

	assert_true(GameConfig.is_loaded(), "TC-RIC-03A: L0 关键配置应已就绪")
	assert_true(elapsed_ms < 100.0, "TC-RIC-03B: L0 极速启动耗时应严格控制在预算内")

	var storage_cfg: Dictionary = GameConfig.get_dict("infrastructure.storage", "")
	assert_gt(storage_cfg.size(), 0, "TC-RIC-03C: L0 读取 storage 表不应为空")

	var save_dir: String = GameConfig.get_string("infrastructure.storage", "paths/primary_save_dir", "")
	assert_false(save_dir.is_empty(), "TC-RIC-03D: storage 配置路径应成功读取")

	return {"test": "TC-RIC-03: GameConfig L0 极速启动与时间预算约束", "passed": true}

# ---- TC-RIC-04: 辅助资源工作池批量载入栅栏与进度回调 ----
static func test_worker_pool_batch_load_barrier() -> Dictionary:
	AuxiliaryWorkerPool.reset_for_tests()
	var pool = AuxiliaryWorkerPool.get_instance()
	pool.set_deterministic_mode(true)

	var batch := BatchLoadRequestDTO.new("batch_test_01")
	var entry1 := ResourceIndexEntryDTO.new("res_t1", "config/infrastructure/storage.json", "config", 1)
	var entry2 := ResourceIndexEntryDTO.new("res_t2", "config/infrastructure/clock.json", "config", 1)
	batch.add_entry(entry1)
	batch.add_entry(entry2)

	var loaded_records: Array[Dictionary] = []
	batch.on_item_loaded = func(entry: Variant, ok: bool, data: Variant, _err: String) -> void:
		loaded_records.append({"entry": entry, "ok": ok, "has_data": data != null})

	var completion_record := {"called": false, "total": 0, "failed": 0}
	batch.on_batch_completed = func(_bid: String, total: int, failed: int) -> void:
		completion_record["called"] = true
		completion_record["total"] = total
		completion_record["failed"] = failed

	var returned_id: String = pool.enqueue_batch(batch)

	assert_eq(returned_id, "batch_test_01", "TC-RIC-04A: 应返回正确批处理 ID")
	assert_true(bool(completion_record["called"]), "TC-RIC-04B: 确定性模式下完成回调应立即触发")
	assert_eq(int(completion_record["total"]), 2, "TC-RIC-04C: 批量总数应为 2")
	assert_eq(int(completion_record["failed"]), 0, "TC-RIC-04D: 失败数量应为 0")
	assert_eq(loaded_records.size(), 2, "TC-RIC-04E: 单项回调触发次数应为 2")

	AuxiliaryWorkerPool.reset_for_tests()
	return {"test": "TC-RIC-04: 辅助资源工作池批量载入栅栏与进度回调", "passed": true}

# ---- TC-RIC-05: JIT 按需实时兜底加载未预热配置表 ----
static func test_game_config_jit_fallback() -> Dictionary:
	var quest_cfg: Dictionary = GameConfig.get_dict("domains.quest", "")
	assert_gt(quest_cfg.size(), 0, "TC-RIC-05A: JIT 动态加载 domains.quest 表应成功")

	var item_cfg: Dictionary = GameConfig.get_dict("items.core", "")
	assert_gt(item_cfg.size(), 0, "TC-RIC-05B: JIT 动态加载 items.core 表应成功")

	var has_quest: bool = GameConfig.has("domains.quest", "quest_definitions")
	assert_true(has_quest, "TC-RIC-05C: has 接口应成功驱动 JIT 兜底")

	return {"test": "TC-RIC-05: JIT 按需实时兜底加载未预热配置表", "passed": true}

# ---- TC-RIC-06: 批量载入取消令牌即时阻断 ----
static func test_batch_load_cancellation() -> Dictionary:
	AuxiliaryWorkerPool.reset_for_tests()
	var pool = AuxiliaryWorkerPool.get_instance()
	pool.set_deterministic_mode(true)

	var token := CancellationToken.new()
	token.cancel()

	var batch := BatchLoadRequestDTO.new("batch_cancel_01")
	batch.cancellation_token = token
	var entry1 := ResourceIndexEntryDTO.new("res_c1", "config/infrastructure/storage.json", "config", 1)
	batch.add_entry(entry1)

	var completion_record := {"called": false, "failed": 0}
	batch.on_batch_completed = func(_bid: String, _total: int, failed: int) -> void:
		completion_record["called"] = true
		completion_record["failed"] = failed

	pool.enqueue_batch(batch)

	assert_true(bool(completion_record["called"]), "TC-RIC-06A: 取消批次完成回调应被触发")
	assert_eq(int(completion_record["failed"]), 1, "TC-RIC-06B: 取消项应计入 failed 计数")

	AuxiliaryWorkerPool.reset_for_tests()
	return {"test": "TC-RIC-06: 批量载入取消令牌即时阻断", "passed": true}

# ---- TC-RIC-07: DTO 序列化往返自洽性与复位契约 ----
static func test_dto_serialization_and_reset() -> Dictionary:
	var entry := ResourceIndexEntryDTO.new("res_dto_01", "res://config/domains/items.json", "config", 2)
	entry.estimated_bytes = 4096

	var dict_repr: Dictionary = entry.to_dict()
	var restored_entry: ResourceIndexEntryDTO = ResourceIndexEntryDTO.from_dict(dict_repr) as ResourceIndexEntryDTO

	assert_eq(restored_entry.resource_id, "res_dto_01", "TC-RIC-07A: resource_id 应无损还原")
	assert_eq(restored_entry.physical_path, "res://config/domains/items.json", "TC-RIC-07B: physical_path 应无损还原")
	assert_eq(restored_entry.category, "config", "TC-RIC-07C: category 应无损还原")
	assert_eq(restored_entry.priority, 2, "TC-RIC-07D: priority 应无损还原")
	assert_eq(restored_entry.estimated_bytes, 4096, "TC-RIC-07E: estimated_bytes 应无损还原")

	entry.reset_state()
	assert_eq(entry.resource_id, "", "TC-RIC-07F: 复位后 resource_id 应为空")
	assert_eq(entry.estimated_bytes, 0, "TC-RIC-07G: 复位后 estimated_bytes 应为 0")

	var batch := BatchLoadRequestDTO.new("batch_99")
	batch.add_entry(restored_entry)
	assert_eq(batch.total_count, 1, "TC-RIC-07H: 批处理总数计算应正确")

	batch.reset_state()
	assert_eq(batch.batch_id, "", "TC-RIC-07I: 复位后 batch_id 应为空")
	assert_eq(batch.total_count, 0, "TC-RIC-07J: 复位后 total_count 应为 0")

	return {"test": "TC-RIC-07: DTO 序列化往返自洽性与复位契约", "passed": true}

# ---- TC-RIC-08: 确定性单例生命周期隔离与清理 ----
static func test_singleton_isolation_cleanup() -> Dictionary:
	StorageResourceCatalog.reset_for_tests()
	ResourceDecoderRegistry.reset_for_tests()
	AuxiliaryWorkerPool.reset_for_tests()

	var cat1 = StorageResourceCatalog.get_instance()
	var cat2 = StorageResourceCatalog.get_instance()
	assert_eq(cat1, cat2, "TC-RIC-08A: 多次获取应返回同一实例")

	StorageResourceCatalog.reset_for_tests()
	var cat3 = StorageResourceCatalog.get_instance()
	assert_ne(cat1, cat3, "TC-RIC-08B: reset_for_tests 后应生成新实例")

	StorageResourceCatalog.reset_for_tests()
	ResourceDecoderRegistry.reset_for_tests()
	AuxiliaryWorkerPool.reset_for_tests()

	return {"test": "TC-RIC-08: 确定性单例生命周期隔离与清理", "passed": true}
