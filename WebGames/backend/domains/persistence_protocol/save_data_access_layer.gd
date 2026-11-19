# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/save_data_access_layer.gd
# 架构定位: Domain Entity / Aggregate Root
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 作为全域数据持久化唯一访问门面，提供统一序列化装配、反序列化分发、 脏标记增量持久化、空壳档阻断与运行模式闸门控制（Inv-SV-2/6/10）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## SaveDataAccessLayer：Domain Entity / Aggregate Root
class_name SaveDataAccessLayer extends RefCounted

static var _domain_contracts: Dictionary = {}   # domain_id -> SaveDomainContract
static var _dirty_domains: Dictionary = {}      # domain_id -> true
static var _config_version: int = -1
static var _is_mock_busy_for_test: bool = false

## 测试专用：设置模拟存档繁忙/阻断状态
static func set_mock_busy_for_test(is_busy: bool) -> void:
	_is_mock_busy_for_test = is_busy

## 确保存档域契约与配置最新（热重载版本推进时平滑重建，保持已注册对象）
static func _ensure_contracts_fresh() -> void:
	if _config_version == GameConfig.config_reload_version() and not _domain_contracts.is_empty():
		return
	_config_version = GameConfig.config_reload_version()

	# 保留旧契约中已注册的 provider 与 consumer
	var old_providers: Dictionary = {}
	var old_consumers: Dictionary = {}
	for domain_id in _domain_contracts.keys():
		var old_contract: Variant = _domain_contracts[domain_id]
		if old_contract != null and old_contract.is_provider_registered():
			old_providers[domain_id] = old_contract.get_provider_aggregate()
		if old_contract != null and old_contract.is_consumer_registered():
			old_consumers[domain_id] = old_contract.get_consumer_callable()

	_domain_contracts.clear()
	var all_entries: Array = GameConfig.get_array("infrastructure.domains", "domains", [])
	var empty_config: Dictionary = {}
	for entry in all_entries:
		var contract_domain_id := String(entry.get("id", ""))
		var save_config: Dictionary = entry.get("save", empty_config)
		if not bool(save_config.get("enabled", false)):
			continue
		var contract: Variant = SaveDomainContract.from_config(contract_domain_id, save_config)
		if old_providers.has(contract_domain_id):
			contract.register_provider(old_providers[contract_domain_id])
		if old_consumers.has(contract_domain_id):
			contract.register_consumer(old_consumers[contract_domain_id])
		_domain_contracts[contract_domain_id] = contract

## 注册特定数据域的运行期数据提供者聚合
static func register_provider(domain_id: String, instance: Variant) -> void:
	_ensure_contracts_fresh()
	if _domain_contracts.has(domain_id):
		(_domain_contracts[domain_id] as Variant).register_provider(instance)
	else:
		# 动态临时契约（未在 domains.json 显式声明 save 时安全回退）
		var contract := SaveDomainContract.new()
		contract.domain_id = domain_id
		contract.enabled = true
		contract.register_provider(instance)
		_domain_contracts[domain_id] = contract

## 注销数据提供者
static func unregister_provider(domain_id: String) -> void:
	if _domain_contracts.has(domain_id):
		(_domain_contracts[domain_id] as Variant).unregister_provider()

## 注册特定数据域的反序列化接收者
static func register_consumer(domain_id: String, consumer: Callable) -> void:
	_ensure_contracts_fresh()
	if _domain_contracts.has(domain_id):
		(_domain_contracts[domain_id] as Variant).register_consumer(consumer)
	else:
		var contract := SaveDomainContract.new()
		contract.domain_id = domain_id
		contract.enabled = true
		contract.register_consumer(consumer)
		_domain_contracts[domain_id] = contract

## 注销反序列化接收者
static func unregister_consumer(domain_id: String) -> void:
	if _domain_contracts.has(domain_id):
		(_domain_contracts[domain_id] as Variant).unregister_consumer()

## 获取指定域契约对象
static func get_contract(domain_id: String) -> Variant:
	_ensure_contracts_fresh()
	return _domain_contracts.get(domain_id, null)

## 获取所有当前已注册/启用的数据域列表
static func get_registered_domains() -> Array[String]:
	_ensure_contracts_fresh()
	var list: Array[String] = []
	for domain_id in _domain_contracts.keys():
		list.append(String(domain_id))
	return list

## 标记高频域为脏数据（Inv-SV-10）
static func mark_dirty(domain_id: String) -> void:
	_ensure_contracts_fresh()
	_dirty_domains[domain_id] = true

## 判断指定域是否为脏
static func is_dirty(domain_id: String) -> bool:
	return _dirty_domains.get(domain_id, false)

## 清除脏标记
static func clear_dirty(domain_id: String = "") -> void:
	if domain_id.is_empty():
		_dirty_domains.clear()
	else:
		_dirty_domains.erase(domain_id)

## 获取当前所有脏域清单
static func get_dirty_domains() -> Array[String]:
	var list: Array[String] = []
	for domain_id in _dirty_domains.keys():
		list.append(String(domain_id))
	return list

## 统一写入装配入口：按域契约调度 serialize，装配进统一 payload（Inv-SV-6）
static func build_save_payload(domain_ids: Array = []) -> Dictionary:
	_ensure_contracts_fresh()
	var providers: Dictionary = {}
	var targets: Array = domain_ids if not domain_ids.is_empty() else _domain_contracts.keys()
	for domain_id in targets:
		var contract: Variant = _domain_contracts.get(domain_id, null)
		if contract == null or not contract.is_provider_registered():
			continue
		var provider_aggregate: Variant = contract.get_provider_aggregate()
		if provider_aggregate == null:
			continue
		providers[domain_id] = provider_aggregate
	return GameSaveAssembler.build_save_payload(providers)

## 缓存已知槽位的基线数据快照（槽位名 -> {"sequence": int, "data": Dictionary}），免重复读盘+双重JSON解析
static var _slot_baseline_cache: Dictionary = {}

## 统一反序列化分发入口：反向流回写数据（Inv-SV-6）
static func apply_save_data(domains_payload: Dictionary, consumer_domain_ids: Array = []) -> Dictionary:
	_ensure_contracts_fresh()
	var consumers: Dictionary = {}
	var targets: Array = consumer_domain_ids if not consumer_domain_ids.is_empty() else domains_payload.keys()
	for domain_id in targets:
		var contract: Variant = _domain_contracts.get(domain_id, null)
		if contract == null or not contract.is_consumer_registered():
			continue
		consumers[domain_id] = contract.get_consumer_callable()
	return GameSaveAssembler.apply_save_data(domains_payload, consumers)

## 统一存档写盘门面：四层隔离判定 + 空壳档阻断 + 原子写
static func save_game(slot_name: String, payload: Dictionary = {}) -> Dictionary:
	# 0. 模拟环境阻断守卫（支持测试模拟服务拦截）
	if _is_mock_busy_for_test:
		return { "success": false, "error_code": "ERR_SAVE_GUARD_BLOCKED", "save_status": "BLOCKED" }

	# 1. 运行模式隔离闸门拦截（Inv-SV-8）
	var active_source: Variant = RuntimeModeGate.get_active_data_source()
	if not RuntimeModeGate.is_single_player() or active_source != SaveManager:
		return { "success": false, "error_code": "ONLINE_SAVE_RESTRICTED" }

	# 2. 若未传入已组装 payload，则现场构建全量载荷；若传入未包装字典则包装进 data
	var target_payload := payload
	if target_payload.is_empty():
		target_payload = build_save_payload()
	elif not target_payload.has("data"):
		target_payload = { "data": payload.duplicate(true) }

	# 3. 审查 L2 空壳档阻断（providers 全空时严禁静默写空档）
	var domains_payload: Dictionary = target_payload.get("data", {})
	if domains_payload.is_empty():
		ErrorReporter.emit_error("save_data_access_layer", "EMPTY_SAVE_BLOCKED", "Empty save write rejected: all domain data providers empty.", {
			"slot": slot_name
		})
		return { "success": false, "error_code": "EMPTY_SAVE_BLOCKED" }

	# 4. 委托底层 SaveManager 实施 SHA-256 签名与 tmp->bak->rename 原子替换
	var save_result := SaveManager.save_game(slot_name, target_payload)
	if bool(save_result.get("success", false)):
		save_result["save_status"] = "SUCCESS"
		_slot_baseline_cache[slot_name] = {
			"sequence": SaveManager.get_save_mutation_sequence(),
			"data": domains_payload.duplicate(true)
		}
	return save_result

## 统一存档读取门面：四层隔离判定 + 介质读取 + 版本感知
static func load_game(slot_name: String) -> Dictionary:
	var active_source: Variant = RuntimeModeGate.get_active_data_source()
	if not RuntimeModeGate.is_single_player() or active_source != SaveManager:
		return { "success": false, "error_code": "ONLINE_LOAD_RESTRICTED" }

	var load_result := SaveManager.load_game(slot_name)
	if bool(load_result.get("success", false)) and load_result.get("data", null) is Dictionary:
		_slot_baseline_cache[slot_name] = {
			"sequence": SaveManager.get_save_mutation_sequence(),
			"data": (load_result["data"] as Dictionary).duplicate(true)
		}
	return load_result

## 脏标记增量写盘（Inv-SV-10）：仅重序列化脏域，但与既有全量档合并后原子落盘，
## 避免部分写盘覆盖丢失非脏域数据
static func flush_dirty(slot_name: String = "quicksave_dirty") -> Dictionary:
	var dirty_ids := get_dirty_domains()
	if dirty_ids.is_empty():
		return { "success": true, "written": 0 }

	# 1. 仅重序列化脏域（增量装配）
	var dirty_payload := build_save_payload(dirty_ids)
	var dirty_domains_payload: Dictionary = dirty_payload.get("data", {})
	if dirty_domains_payload.is_empty():
		clear_dirty()
		return { "success": false, "written": 0, "error_code": "EMPTY_SAVE_BLOCKED" }

	# 2. 优先复用序列号对齐的内存基线快照，未命中或外部修改时再读盘合并（Inv-SV-10）
	var merged_domains_payload: Dictionary = dirty_domains_payload
	var current_sequence := SaveManager.get_save_mutation_sequence()
	var cached_entry: Variant = _slot_baseline_cache.get(slot_name, null)
	if cached_entry is Dictionary and int((cached_entry as Dictionary).get("sequence", -1)) == current_sequence:
		merged_domains_payload = ((cached_entry as Dictionary)["data"] as Dictionary).duplicate(true)
		for domain_id in dirty_domains_payload.keys():
			merged_domains_payload[domain_id] = dirty_domains_payload[domain_id]
	else:
		var existing := SaveManager.load_game(slot_name)
		if bool(existing.get("success", false)) and existing.get("data", null) is Dictionary:
			merged_domains_payload = (existing["data"] as Dictionary).duplicate(true)
			for domain_id in dirty_domains_payload.keys():
				merged_domains_payload[domain_id] = dirty_domains_payload[domain_id]

	var save_operation_result := save_game(slot_name, { "data": merged_domains_payload })
	save_operation_result["written"] = dirty_ids.size()
	# 写盘成功后才清除脏标记（评审收敛 L2）：失败时保留脏域，供下次 flush 重试，
	# 避免介质错误/空壳判定等场景下增量更新静默丢失且不再重试
	if bool(save_operation_result.get("success", false)):
		clear_dirty()
	return save_operation_result

## 测试重置
static func reset_for_tests() -> void:
	_domain_contracts.clear()
	_dirty_domains.clear()
	_slot_baseline_cache.clear()
	_config_version = -1
	_is_mock_busy_for_test = false
