# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/editor_hot_reload_manager.gd
# 架构定位: Domain Service / State Orchestrator
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: infrastructure.persistence.json | 信号: EventBus 领域广播
# 职责说明: 监听并检测单机编辑器配置变更，按领域白名单精确重载并广播业务刷新。 严格仅单机模式生效，联机模式物理阻断（Inv-SV-8/9/14）。
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

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
		var d_id := String(entry.get("id", ""))
		var cfg_table := String(entry.get("config", ""))
		var save_cfg: Dictionary = entry.get("save", {})
		var hr_cfg: Dictionary = save_cfg.get("hot_reload", {})
		_hot_reload_scope[d_id] = {
			"allow": bool(hr_cfg.get("allow", false)),
			"requires_rebuild": bool(hr_cfg.get("requires_rebuild", false))
		}
		if not cfg_table.is_empty():
			_table_to_domain_map[cfg_table] = d_id

## 配置表内容 SHA-256 哈希计算（纯值类型与确定性序列化，Inv-SV-9）
static func _compute_table_hash(table_name: String) -> String:
	var tbl_data: Variant = GameConfig.get_table(table_name, {})
	return JSON.stringify(tbl_data).sha256_text()

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

	for tbl in monitored_tables:
		var current := _compute_table_hash(tbl)
		if _last_hashes.has(tbl):
			if _last_hashes[tbl] != current:
				changed[tbl] = current
		else:
			_last_hashes[tbl] = current
	return changed

## 领域级热更新调度：单机门禁 -> 白名单过滤 -> 广播通知 -> 更新基线（Inv-SV-8/9）
static func apply_hot_reload(changed_tables: Dictionary) -> Dictionary:
	_ensure_scope_loaded()
	# 1. 运行模式四层隔离首道闸门（Inv-SV-8）
	if not RuntimeModeGate.is_single_player():
		return { "success": false, "error_code": "HOT_RELOAD_BLOCKED_IN_ONLINE" }

	var results: Dictionary = {}
	var reloaded_tables: Array[String] = []

	for tbl in changed_tables.keys():
		var domain_id: String = _table_to_domain_map.get(tbl, "")
		if domain_id.is_empty():
			# 允许直接以 domain_id 作为键调用
			if _hot_reload_scope.has(tbl):
				domain_id = tbl

		var scope: Dictionary = _hot_reload_scope.get(domain_id, {})
		var allow: bool = bool(scope.get("allow", false))
		var requires_rebuild: bool = bool(scope.get("requires_rebuild", false))

		# 2. 白名单拒绝判定（Inv-SV-14）
		if not allow:
			results[domain_id if not domain_id.is_empty() else tbl] = {
				"status": "skipped",
				"reason": "HOT_RELOAD_DENIED"
			}
			continue

		# 3. 确定性红线与运行时重建约束（战斗/经济等状态不可热更）
		if requires_rebuild:
			results[domain_id if not domain_id.is_empty() else tbl] = {
				"status": "skipped",
				"reason": "REQUIRES_RUNTIME_REBUILD"
			}
			continue

		# 4. 允许热更领域：执行领域级重载并广播业务系统刷新
		var reload_info := {
			"status": "reloaded",
			"table": tbl,
			"domain_id": domain_id,
			"hash": changed_tables[tbl]
		}
		EventBusCore.get_instance().emit_domain_event("persistence.domain_hot_reloaded", reload_info)
		results[domain_id] = reload_info
		reloaded_tables.append(tbl)

	# 5. 失败安全（Inv-SV-9）：仅成功重载的域推进基线哈希；
	#    被白名单/重建约束拒绝的域保持旧哈希，供后续 detect_changes 持续报告与重试
	for tbl in reloaded_tables:
		_last_hashes[tbl] = changed_tables[tbl]

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
