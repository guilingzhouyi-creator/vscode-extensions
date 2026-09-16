# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/save_data_access_layer.gd
# 架构定位: Domain Entity / Aggregate Root
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 作为全域数据持久化唯一访问门面，提供统一序列化装配、反序列化分发、 脏标记增量持久化、空壳档阻断与运行模式闸门控制（Inv-SV-2/6/10）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name SaveDataAccessLayer extends RefCounted

const SaveDomainContract = preload("res://backend/domains/persistence_protocol/save_domain_contract.gd")
const RuntimeModeGate = preload("res://backend/domains/persistence_protocol/runtime_mode_gate.gd")

static var _domain_contracts: Dictionary = {}   # domain_id -> SaveDomainContract
static var _dirty_domains: Dictionary = {}      # domain_id -> true
static var _config_version: int = -1

## 确保存档域契约与配置最新（热重载版本推进时平滑重建，保持已注册对象）
static func _ensure_contracts_fresh() -> void:
	if _config_version == GameConfig.config_reload_version() and not _domain_contracts.is_empty():
		return
	_config_version = GameConfig.config_reload_version()

	# 保留旧契约中已注册的 provider 与 consumer
	var old_providers: Dictionary = {}
	var old_consumers: Dictionary = {}
	for d_id in _domain_contracts.keys():
		var old_c: Variant = _domain_contracts[d_id]
		if old_c != null and old_c.is_provider_registered():
			old_providers[d_id] = old_c.get_provider_aggregate()
		if old_c != null and old_c.is_consumer_registered():
			old_consumers[d_id] = old_c.get_consumer_callable()

	_domain_contracts.clear()
	var all_entries: Array = GameConfig.get_array("infrastructure.domains", "domains", [])
	for entry in all_entries:
		var id := String(entry.get("id", ""))
		var save_cfg: Dictionary = entry.get("save", {})
		if not bool(save_cfg.get("enabled", false)):
			continue
		var contract: Variant = SaveDomainContract.from_config(id, save_cfg)
		if old_providers.has(id):
			contract.register_provider(old_providers[id])
		if old_consumers.has(id):
			contract.register_consumer(old_consumers[id])
		_domain_contracts[id] = contract

## 注册特定数据域的运行期数据提供者聚合
static func register_provider(domain_id: String, instance: Variant) -> void:
	_ensure_contracts_fresh()
	if _domain_contracts.has(domain_id):
		(_domain_contracts[domain_id] as Variant).register_provider(instance)
	else:
		# 动态临时契约（未在 domains.json 显式声明 save 时兜底）
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
	for k in _domain_contracts.keys():
		list.append(String(k))
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
	for k in _dirty_domains.keys():
		list.append(String(k))
	return list

## 统一写入装配入口：按域契约调度 serialize，装配进统一 payload（Inv-SV-6）
static func build_save_payload(domain_ids: Array = []) -> Dictionary:
	_ensure_contracts_fresh()
	var providers: Dictionary = {}
	var targets: Array = domain_ids if not domain_ids.is_empty() else _domain_contracts.keys()
	for d_id in targets:
		var contract: Variant = _domain_contracts.get(d_id, null)
		if contract == null or not contract.is_provider_registered():
			continue
		var agg: Variant = contract.get_provider_aggregate()
		if agg == null:
			continue
		providers[d_id] = agg
	return GameSaveAssembler.build_save_payload(providers)

## 统一反序列化分发入口：反向流回灌数据（Inv-SV-6）
static func apply_save_data(data: Dictionary, consumer_domain_ids: Array = []) -> Dictionary:
	_ensure_contracts_fresh()
	var consumers: Dictionary = {}
	var targets: Array = consumer_domain_ids if not consumer_domain_ids.is_empty() else data.keys()
	for d_id in targets:
		var contract: Variant = _domain_contracts.get(d_id, null)
		if contract == null or not contract.is_consumer_registered():
			continue
		consumers[d_id] = contract.get_consumer_callable()
	return GameSaveAssembler.apply_save_data(data, consumers)

## 统一存档写盘门面：四层隔离判定 + 空壳档阻断 + 原子写
static func save_game(slot_name: String, payload: Dictionary = {}) -> Dictionary:
	# 1. 运行模式隔离闸门拦截（Inv-SV-8）
	var active_source: Variant = RuntimeModeGate.get_active_data_source()
	if not RuntimeModeGate.is_single_player() or active_source != SaveManager:
		return { "success": false, "error_code": "ONLINE_SAVE_RESTRICTED" }

	# 2. 若未传入已组装 payload，则现场构建全量载荷
	var target_payload := payload
	if target_payload.is_empty() or not target_payload.has("data"):
		target_payload = build_save_payload()

	# 3. 审查 L2 空壳档阻断（providers 全空时严禁静默写空档）
	var data_dict: Dictionary = target_payload.get("data", {})
	if data_dict.is_empty():
		ErrorReporter.emit_error("save_data_access_layer", "EMPTY_SAVE_BLOCKED", "存档拒绝写入，数据域全空", {
			"slot": slot_name
		})
		return { "success": false, "error_code": "EMPTY_SAVE_BLOCKED" }

	# 4. 委托底层 SaveManager 实施 SHA-256 签名与 tmp->bak->rename 原子替换
	return SaveManager.save_game(slot_name, target_payload)

## 统一存档读取门面：四层隔离判定 + 介质读取 + 版本感知
static func load_game(slot_name: String) -> Dictionary:
	var active_source: Variant = RuntimeModeGate.get_active_data_source()
	if not RuntimeModeGate.is_single_player() or active_source != SaveManager:
		return { "success": false, "error_code": "ONLINE_LOAD_RESTRICTED" }

	return SaveManager.load_game(slot_name)

## 脏标记增量写盘（Inv-SV-10）：仅重序列化脏域，但与既有全量档合并后原子落盘，
## 避免部分写盘覆盖丢失非脏域数据
static func flush_dirty(slot_name: String = "quicksave_dirty") -> Dictionary:
	var dirty_ids := get_dirty_domains()
	if dirty_ids.is_empty():
		return { "success": true, "written": 0 }

	# 1. 仅重序列化脏域（增量装配）
	var dirty_payload := build_save_payload(dirty_ids)
	var dirty_data: Dictionary = dirty_payload.get("data", {})
	if dirty_data.is_empty():
		clear_dirty()
		return { "success": false, "written": 0, "error_code": "EMPTY_SAVE_BLOCKED" }

	# 2. 读取既有全量档，将脏域数据合并覆盖（非脏域原样保留，Inv-SV-10）
	var merged_data: Dictionary = dirty_data
	var existing := SaveManager.load_game(slot_name)
	if bool(existing.get("success", false)) and existing.get("data", null) is Dictionary:
		merged_data = (existing["data"] as Dictionary).duplicate(true)
		for d_id in dirty_data.keys():
			merged_data[d_id] = dirty_data[d_id]

	var result := save_game(slot_name, { "data": merged_data })
	result["written"] = dirty_ids.size()
	# 写盘成功后才清除脏标记（评审收敛 L2）：失败时保留脏域，供下次 flush 重试，
	# 避免介质错误/空壳判定等场景下增量更新静默丢失且不再重试
	if bool(result.get("success", false)):
		clear_dirty()
	return result

## 测试重置
static func reset_for_tests() -> void:
	_domain_contracts.clear()
	_dirty_domains.clear()
	_config_version = -1
