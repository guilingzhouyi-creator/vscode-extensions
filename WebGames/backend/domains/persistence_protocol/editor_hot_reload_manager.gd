# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/editor_hot_reload_manager.gd
# 架构定位: Domain Service / State Orchestrator
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 监听并检测单机编辑器配置变更，按领域白名单精确重载并广播业务刷新。 严格仅单机模式生效，联机模式物理阻断（Inv-SV-8/9/14）。
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## EditorHotReloadManager：Domain Service / State Orchestrator
class_name EditorHotReloadManager extends RefCounted

const RuntimeModeGate = preload("res://backend/domains/persistence_protocol/runtime_mode_gate.gd")
const SaveDataAccessLayer = preload("res://backend/domains/persistence_protocol/save_data_access_layer.gd")

static var _last_hashes: Dictionary = {}              # table_name -> content_hash
static var _hot_reload_scope: Dictionary = {}         # domain_id -> { "allow": bool, "requires_rebuild": bool }
static var _table_to_domain_map: Dictionary = {}      # table_name -> domain_id

## 从 domains.json 初始化配置表映射与热更新作用域白名单
static func _ensure_scope_loaded() -> void:
	if not _hot_reload_scope.is_empty():
		return
	var all_entries: Array = GameConfig.get_array("infrastructure.domains", "domains", [])
	for entry in all_entries:
		var domain_key := String(entry.get("id", ""))
		var config_table := String(entry.get("config", ""))
		var save_raw: Variant = entry.get("save")
		var allow_reload := false
		var needs_rebuild := false
		if save_raw is Dictionary:
			var hot_reload_raw: Variant = (save_raw as Dictionary).get("hot_reload")
			if hot_reload_raw is Dictionary:
				var hot_reload_dict := hot_reload_raw as Dictionary
				allow_reload = bool(hot_reload_dict.get("allow", false))
				needs_rebuild = bool(hot_reload_dict.get("requires_rebuild", false))
		_hot_reload_scope[domain_key] = {
			"allow": allow_reload,
			"requires_rebuild": needs_rebuild
		}
		if not config_table.is_empty():
			_table_to_domain_map[config_table] = domain_key

## 配置表内容 SHA-256 哈希计算（纯值类型与确定性序列化，Inv-SV-9）
static func _compute_table_hash(table_name: String) -> String:
	var table_data: Variant = GameConfig.get_table(table_name, {})
	return JSON.stringify(table_data).sha256_text()

## 记录配置表初始哈希基线
static func register_table_baseline(table_name: String) -> void:
	_ensure_scope_loaded()
	_last_hashes[table_name] = _compute_table_hash(table_name)

## 变更检测：比对受监控配置表哈希，返回发生变化的表集
static func detect_changes() -> Dictionary:
	_ensure_scope_loaded()
	var changed: Dictionary = {}
	var monitored_tables := _last_hashes.keys()
	if monitored_tables.is_empty():
		monitored_tables = _table_to_domain_map.keys()

	for table_name in monitored_tables:
		var current := _compute_table_hash(table_name)
		if _last_hashes.has(table_name):
			if _last_hashes[table_name] != current:
				changed[table_name] = current
		else:
			_last_hashes[table_name] = current
	return changed

## 领域级热更新调度：单机门禁 -> 白名单过滤 -> 广播通知 -> 更新基线（Inv-SV-8/9）
static func apply_hot_reload(changed_tables: Dictionary) -> Dictionary:
	_ensure_scope_loaded()
	# 1. 运行模式四层隔离首道闸门（Inv-SV-8）
	if not RuntimeModeGate.is_single_player():
		return { "success": false, "error_code": "HOT_RELOAD_BLOCKED_IN_ONLINE" }

	var results: Dictionary = {}
	var reloaded_tables: Array[String] = []

	for table_name in changed_tables.keys():
		var domain_id: String = _table_to_domain_map.get(table_name, "")
		if domain_id.is_empty():
			# 允许直接以 domain_id 作为键调用
			if _hot_reload_scope.has(table_name):
				domain_id = table_name

		var scope_raw: Variant = _hot_reload_scope.get(domain_id)
		var allow: bool = false
		var requires_rebuild: bool = false
		if scope_raw is Dictionary:
			var scope_dict := scope_raw as Dictionary
			allow = bool(scope_dict.get("allow", false))
			requires_rebuild = bool(scope_dict.get("requires_rebuild", false))

		# 2. 白名单拒绝判定（Inv-SV-14）
		if not allow:
			results[domain_id if not domain_id.is_empty() else table_name] = {
				"status": "skipped",
				"reason": "HOT_RELOAD_DENIED"
			}
			continue

		# 3. 确定性红线与运行时重建约束（战斗/经济等状态不可热更）
		if requires_rebuild:
			results[domain_id if not domain_id.is_empty() else table_name] = {
				"status": "skipped",
				"reason": "REQUIRES_RUNTIME_REBUILD"
			}
			continue

		# 4. 允许热更领域：执行领域级重载并广播业务系统刷新
		var reload_info := {
			"status": "reloaded",
			"table": table_name,
			"domain_id": domain_id,
			"hash": changed_tables[table_name]
		}
		EventBusCore.get_instance().emit_domain_event("persistence.domain_hot_reloaded", reload_info)
		results[domain_id] = reload_info
		reloaded_tables.append(table_name)

	# 5. 失败安全（Inv-SV-9）：仅成功重载的域推进基线哈希；
	#    被白名单/重建约束拒绝的域保持旧哈希，供后续 detect_changes 持续报告与重试
	for table_name in reloaded_tables:
		_last_hashes[table_name] = changed_tables[table_name]

	return { "success": true, "results": results }

## 显式配置指定域热更新白名单策略（测试与动态配置用）
static func set_domain_scope(domain_id: String, allow: bool, requires_rebuild: bool, table_name: String = "") -> void:
	_hot_reload_scope[domain_id] = {
		"allow": allow,
		"requires_rebuild": requires_rebuild
	}
	if not table_name.is_empty():
		_table_to_domain_map[table_name] = domain_id

## 测试重置
static func reset_for_tests() -> void:
	_last_hashes.clear()
	_hot_reload_scope.clear()
	_table_to_domain_map.clear()
