# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/game_config.gd
# 架构定位: Central Configuration Center
# 跨域依赖: 上游: 全域业务域、UI表现层快照提供者 | 下游: JSON 文件系统 | 配置: config/**/*.json (66 张配置表) | 信号: 配置重载广播
# 职责说明: 全域配置文件的泛用加载与读取层。上层业务（42 领域 / 基础设施 / 前端） 通过本底座以「表名 + 多级路径 + 默认值回退」的方式获取一切数值、文案、 标识与分类定义，实现「零硬编码、全配置驱动」，并支持运行时热重载。  配置表布局（res://config/）: config/<name>.json            -> 表名 "<name>"           （顶层） config/<sub>/<name>.json      -> 表名 "<sub>.<name>"     （嵌套目录，递归加载）  路径语法: 以 "/" 分隔多级键，如 "rates/silver"；支持数组下标 "list/0"。 用法示例: GameConfig.get_int("domains.currency", "rates/silver", 100) GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0) GameConfig.get_string("narratives.currency", "sink_transaction", "") GameConfig.get_dict("infrastructure.event_categories", "combat", {}) GameConfig.reload_config()   # 热重载：先构建新快照并校验，成功后原子交换（勿命名 reload——被 GDScript 内建遮蔽）
# 设计依据: WebGames 零硬编码配置驱动总则
# ==============================================================================

class_name GameConfig extends RefCounted

# ==============================================================================
# 一、常量与状态
# ==============================================================================

const CONFIG_DIR: String = "res://config/"

static var _tables: Dictionary = {}
static var _loaded: bool = false

## 路径分段解析缓存（table:path 每调用 split 重建的消除）。
## 键域 = 代码内静态字面量路径（有界）；只缓存分段不含值——热重载表值变化天然生效，
## 成功交换后仍清空为防御（表键集可能变化）。
static var _path_cache: Dictionary = {}

## 路径分段缓存上限：防运行期动态键（msg/拼接路径）无界增长
const PATH_CACHE_MAX_ENTRIES: int = 4096

const ConfigRouterEngine = preload("res://backend/infrastructure/config_router_engine.gd")

const PATH_STORAGE_CATALOG_SCRIPT: String = "res://backend/domains/persistence_protocol/storage_resource_catalog.gd"
const PATH_AUX_WORKER_POOL_SCRIPT: String = "res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd"
const PATH_BATCH_LOAD_REQUEST_SCRIPT: String = "res://backend/domains/persistence_protocol/dto/batch_load_request_dto.gd"
const CAT_CONFIG: String = "config"
const EVENT_ALL_TABLES_READY: String = "config.all_tables_ready"
const EXT_JSON: String = ".json"
const METHOD_GET_INSTANCE: String = "get_instance"
const METHOD_RESOLVE_CONFIG_TABLE_ENTRY: String = "resolve_config_table_entry"
const METHOD_GET_CRITICAL_BOOT_ENTRIES: String = "get_critical_boot_entries"
const BATCH_ID_CONFIG_BULK: String = "config_bulk_async"

## 必需配置表清单（分层规范：infrastructure.* / domains.* / frontend.* / items.*）。
## 分层目录规则：
##   config/infrastructure/<name>.json -> 表名 "infrastructure.<name>"
##   config/domains/<name>.json        -> 表名 "domains.<name>"
##   config/frontend/<name>.json       -> 表名 "frontend.<name>"
##   config/narratives/<name>.json     -> 表名 "narratives.<name>"
##   config/items/<name>.json          -> 表名 "items.<name>"（物品定义，装配入口自动发现）
##
## 维护约定（顺序铁律）：必须先确认表文件已存在，再登记到此清单；
## 登记不存在的表会让 TC-CFG-04（必需配置表零缺失）立即变红。
## 领域与配置表的归属映射见 config/infrastructure/domains.json（唯一事实来源）。
static var _required_tables: Array = [
	"infrastructure.event_categories",
	"infrastructure.log",
	"infrastructure.clock",
	"infrastructure.persistence",
	"infrastructure.admin",
	"infrastructure.domains",
	"infrastructure.contracts",
	"infrastructure.lifecycle",
	"infrastructure.errors_catalog",
	"infrastructure.event_bus_config",
	"infrastructure.release_policy",
	"infrastructure.version_manifest",
	"infrastructure.object_pool",
	"items.core",
	"frontend.ui",
	"frontend.views",
	"domains.account.core",
	"domains.attribute.core",
	"domains.bulletin_board_maintenance.core",
	"domains.cdkey_voucher.core",
	"domains.character_creation.core",
	"domains.chat_command.core",
	"domains.combat.mechanics",
	"domains.combat.damage_formulas",
	"domains.combat.buff_definitions",
	"domains.commission_quest.core",
	"domains.currency.core",
	"domains.deterministic.core",
	"domains.economy.core",
	"domains.elite.core",
	"domains.equipment.core",
	"domains.event_driven_audio.core",
	"domains.event_extractor.core",
	"domains.event_probability.core",
	"domains.feature_toggle_canary.core",
	"domains.gacha.core",
	"domains.game_settings.core",
	"domains.ground_loot.core",
	"domains.hardware_input.core",
	"domains.identity_disguise.core",
	"domains.inventory.core",
	"domains.item_attributes.core",
	"domains.item_namespace_registry.core",
	"domains.item_statistics.core",
	"domains.lattice.core",
	"domains.lifecycle.core",
	"domains.localization_i18n.core",
	"domains.magic_rules.core",
	"domains.magic_tiers.core",
	"domains.mail_system.core",
	"domains.matter_disposal.core",
	"domains.monster.core",
	"domains.narrative_orchestration.core",
	"domains.notification_red_dot.core",
	"domains.npc.core",
	"domains.organization_guild.core",
	"domains.potential.core",
	"domains.quality_tiers.core",
	"domains.quest.core",
	"domains.sovereignty.core",
	"domains.spatial_merchant.core",
	"domains.spatial_movement.core",
	"domains.starter_loadout.core",
	"domains.telemetry_account_lifecycle.core",
	"domains.trading.core",
	"domains.workshop.core",
	"domains.world.core",
	"domains.world_boss.core",
	"domains.world_gateway.core",
	"domains.world_state.core"
]

# ==============================================================================
# 二、加载与校验
# ==============================================================================

## 确保配置已加载（首次访问时惰性加载；重复调用零开销）
static func ensure_loaded() -> void:
	if _loaded:
		return
	_tables.clear()
	_scan_dir(CONFIG_DIR, "")
	_loaded = true
	_validate_required_tables()

## 必需表校验：缺失时输出警告（防止配置漏删/改名导致业务静默回退到代码默认值）
static func _validate_required_tables() -> void:
	var missing: Array = []
	for table_name in _required_tables:
		if not _tables.has(table_name):
			missing.append(table_name)
	if not missing.is_empty():
		ErrorReporter.emit_error("game_config", "REQUIRED_TABLE_MISSING", "GameConfig: 缺少必需配置表: %s" % ", ".join(missing))

## 获取统一资源目录实例（动态解耦，杜绝跨层静态强引用）
static func _get_catalog() -> Variant:
	if ResourceLoader.exists(PATH_STORAGE_CATALOG_SCRIPT):
		var s = load(PATH_STORAGE_CATALOG_SCRIPT)
		if s != null and s.has_method(METHOD_GET_INSTANCE):
			return s.get_instance()
	return null

## JIT 靶向按需加载单个配置表（按需即时读盘，消除全局阻塞）
static func _ensure_table_loaded_jit(table_name: String) -> void:
	var target_name := ConfigRouterEngine.resolve_table_name(table_name)
	if _tables.has(target_name):
		return
	var catalog: Variant = _get_catalog()
	if catalog != null and catalog.has_method(METHOD_RESOLVE_CONFIG_TABLE_ENTRY):
		var entry = catalog.resolve_config_table_entry(target_name)
		if entry != null and not str(entry.physical_path).is_empty() and FileAccess.file_exists(entry.physical_path):
			_load_table(entry.physical_path, target_name)
			return

	# 回退至约定物理路径
	var parts := target_name.split(".")
	var fallback_path := CONFIG_DIR + "/".join(parts) + EXT_JSON
	if FileAccess.file_exists(fallback_path):
		_load_table(fallback_path, target_name)

## 同步极速加载 L0 核心底座配置表（耗时 <= 5.0ms，建立最小可运行世界状态）
static func ensure_l0_loaded_sync() -> int:
	var catalog: Variant = _get_catalog()
	var loaded_count := 0
	if catalog != null and catalog.has_method(METHOD_GET_CRITICAL_BOOT_ENTRIES):
		for entry in catalog.get_critical_boot_entries():
			var t_name: String = str(entry.metadata.get("table_name", ""))
			if not t_name.is_empty() and not _tables.has(t_name):
				_load_table(entry.physical_path, t_name)
				loaded_count += 1
	_loaded = true
	return loaded_count

## 借助双域储存并发工作池异步装载全部业务与文案配置表
static func load_via_storage_async(on_completed: Callable = Callable()) -> void:
	ensure_l0_loaded_sync()
	var catalog: Variant = _get_catalog()
	if catalog == null or not ResourceLoader.exists(PATH_AUX_WORKER_POOL_SCRIPT):
		ensure_loaded()
		if on_completed.is_valid():
			on_completed.call(_tables.size())
		return

	var pool_script = load(PATH_AUX_WORKER_POOL_SCRIPT)
	var pool: Variant = pool_script.get_instance() if pool_script != null else null
	var batch_script = load(PATH_BATCH_LOAD_REQUEST_SCRIPT)
	if pool == null or batch_script == null:
		ensure_loaded()
		if on_completed.is_valid():
			on_completed.call(_tables.size())
		return

	var batch_req = batch_script.new(BATCH_ID_CONFIG_BULK)
	for entry in catalog.get_entries_by_category(CAT_CONFIG):
		var t_name: String = str(entry.metadata.get("table_name", ""))
		if not t_name.is_empty() and not _tables.has(t_name):
			batch_req.add_entry(entry)

	batch_req.on_item_loaded = func(entry: Variant, ok: bool, data: Variant, _err: String) -> void:
		if ok and (data is Dictionary):
			var t_name: String = str(entry.metadata.get("table_name", ""))
			if not t_name.is_empty():
				_tables[t_name] = data

	batch_req.on_batch_completed = func(_bid: String, total: int, _failed: int) -> void:
		_validate_required_tables()
		EventBusCore.get_instance().emit_domain_event(EVENT_ALL_TABLES_READY, {"total": total})
		if on_completed.is_valid():
			on_completed.call(total)

	pool.enqueue_batch(batch_req)

## 加载报告：全部表名 / 缺失必需表 / 表总数（运维与调试用）
static func describe() -> Dictionary:
	ensure_loaded()
	var missing: Array = []
	for table_name in _required_tables:
		if not _tables.has(table_name):
			missing.append(table_name)
	return {
		"count": _tables.size(),
		"tables": _tables.keys(),
		"missing_required": missing
	}

# ==============================================================================
# 三、热重载（构建 → 校验 → 原子交换）
# ==============================================================================

## 热重载版本计数（单调递增，供 ConfigReloadResult.version）
static var _reload_counter: int = 0

## 当前热重载版本只读访问（供各域静态缓存做版本比对自动失效重建，
## 与 reload_config 成功发布保持同源）
static func config_reload_version() -> int:
	return _reload_counter

## 扫描失败记录（S3-01：JSON 解析失败/顶层非对象表在此登记，reload 据此拒绝发布）
static var _scan_failures: Array = []

## 热重载：先构建新表快照，成功后原子交换；构建失败（含必需表缺失/坏配置）保留旧快照与版本。
## 返回 ConfigReloadResult：{ success, version, added, removed, changed, table_count [, error] }
## 命名注意：不可命名为 reload()——GDScript 内建 GDScript.reload() 会遮蔽同名静态方法
## （调用被解析到脚本资源重载并返回 Error，导致热重载永远不生效），故统一使用 reload_config()。
static func reload_config() -> Dictionary:
	# 深拷贝旧快照：GDScript Dictionary 为引用类型，若直接赋值则与 _tables 同体，
	# 后续 _tables.clear() 会连带清空旧快照，使失败路径回滚退化为空操作、added/changed/removed 恒空。
	var old_tables: Dictionary = _tables.duplicate(true)
	var old_loaded: bool = _loaded
	_scan_failures = []

	# 构建阶段（临时装入 _tables，成功后交换）
	_tables.clear()
	_scan_dir(CONFIG_DIR, "")
	var built: Dictionary = _tables
	_tables = old_tables # 先还原旧表（构建阶段不污染运行快照）

	if not _scan_failures.is_empty():
		# 构建失败（存在坏配置：JSON 解析失败/顶层非对象）——保留旧快照继续服务，版本不推进
		return {
			"success": false,
			"version": _reload_counter,
			"error": "BUILD_FAILED",
			"details": _scan_failures.duplicate(true),
			"added": [],
			"removed": [],
			"changed": [],
			"table_count": old_tables.size()
		}

	# 必需表校验：缺表 → 拒绝发布（防止漏删/改名导致业务静默回退到代码默认值）
	var missing: Array = []
	for table_name in _required_tables:
		if not built.has(table_name):
			missing.append(table_name)
	if not missing.is_empty():
		_tables = old_tables
		_loaded = old_loaded
		return {
			"success": false,
			"version": _reload_counter,
			"error": "MISSING_REQUIRED_TABLE",
			"details": missing,
			"added": [],
			"removed": [],
			"changed": [],
			"table_count": old_tables.size()
		}

	if built.is_empty() and not old_tables.is_empty():
		# 构建失败（扫描无结果）——保留旧快照继续服务
		_loaded = old_loaded
		return {
			"success": false,
			"version": _reload_counter,
			"error": "BUILD_FAILED",
			"added": [],
			"removed": [],
			"changed": [],
			"table_count": old_tables.size()
		}

	# 对比新旧表集合（新增/删除/变更清单）
	var added: Array = []
	var changed: Array = []
	for k in built:
		if not old_tables.has(k):
			added.append(k)
		elif old_tables[k] != built[k]:
			changed.append(k)
	var removed: Array = []
	for k in old_tables:
		if not built.has(k):
			removed.append(k)

	# 原子交换新快照
	_reload_counter += 1
	_tables = built
	_loaded = true
	_path_cache.clear() # 表键集可能变化，防御性清空分段缓存
	EventBusCore.get_instance().emit_domain_event("config.security_reloaded", {"version": _reload_counter, "changed": changed})
	return {
		"success": true,
		"version": _reload_counter,
		"added": added,
		"removed": removed,
		"changed": changed,
		"table_count": _tables.size()
	}

## 别名委托 reload_config()
static func reload_all_configurations() -> Dictionary:
	return reload_config()

## 单子表靶向热重载（零污染、单子表原子替换）
static func reload_subtable(subtable_name: String) -> Dictionary:
	var resolved: String = ConfigRouterEngine.resolve_table_name(subtable_name)
	var parts := resolved.split(".")
	var file_path := CONFIG_DIR + "/".join(parts) + EXT_JSON

	if not FileAccess.file_exists(file_path):
		return {
			"success": false,
			"subtable": resolved,
			"error": "FILE_NOT_FOUND",
			"file_path": file_path
		}

	var json := JSON.new()
	var text := FileAccess.get_file_as_string(file_path)
	if json.parse(text) != OK:
		return {
			"success": false,
			"subtable": resolved,
			"error": "JSON_PARSE_FAILED",
			"details": json.get_error_message()
		}

	var data: Variant = json.get_data()
	if not (data is Dictionary):
		return {
			"success": false,
			"subtable": resolved,
			"error": "NOT_A_JSON_OBJECT"
		}

	_tables[resolved] = data
	_reload_counter += 1
	_path_cache.clear()

	EventBusCore.get_instance().emit_domain_event("config.subtable_reloaded", {
		"subtable": resolved,
		"version": _reload_counter
	})

	return {
		"success": true,
		"subtable": resolved,
		"version": _reload_counter
	}

# ==============================================================================
# 四、泛用取值与类型化取值
# ==============================================================================

static func is_loaded() -> bool:
	return _loaded

## 返回全部已加载表名（用于调试 / 前端遍历）
static func get_table_names() -> Array:
	ensure_loaded()
	return _tables.keys()

## 返回整张配置表（path 为空即取表根）
static func get_table(table_name: String, default: Variant = {}) -> Variant:
	ensure_loaded()
	var target_table := ConfigRouterEngine.resolve_table_name(table_name)
	if not _tables.has(target_table):
		_ensure_table_loaded_jit(target_table)
	return _tables.get(target_table, default)

## 判断「表 + 多级路径」是否存在
static func has(table_name: String, path: String) -> bool:
	ensure_loaded()
	var route: Variant = ConfigRouterEngine.resolve_route(table_name, path)
	var target_table: String = str(route.resolved_table)
	if not _tables.has(target_table):
		_ensure_table_loaded_jit(target_table)
	if _lookup_path_in_table(_tables.get(target_table, {}), path) != null:
		return true
	var subtables: Array = ConfigRouterEngine.get_subtables_for_domain(table_name)
	for sub in subtables:
		var s_name := String(sub)
		if s_name == target_table:
			continue
		if not _tables.has(s_name):
			_ensure_table_loaded_jit(s_name)
		if _lookup_path_in_table(_tables.get(s_name, {}), path) != null:
			return true
	return false

## 泛用取值：任意类型，未命中或类型不符时返回 default（不抛错）
static func get_value(table_name: String, path: String, default: Variant = null) -> Variant:
	ensure_loaded()
	var route: Variant = ConfigRouterEngine.resolve_route(table_name, path)
	var target_table: String = str(route.resolved_table)
	if not _tables.has(target_table):
		_ensure_table_loaded_jit(target_table)
	var val: Variant = _lookup_path_in_table(_tables.get(target_table, {}), path)
	if val != null:
		return val
	var subtables: Array = ConfigRouterEngine.get_subtables_for_domain(table_name)
	for sub in subtables:
		var s_name := String(sub)
		if s_name == target_table:
			continue
		if not _tables.has(s_name):
			_ensure_table_loaded_jit(s_name)
		var sub_val: Variant = _lookup_path_in_table(_tables.get(s_name, {}), path)
		if sub_val != null:
			return sub_val
	return default

## 类型化取值（带数值/字符串宽松转换与默认值回退，未命中一律回退 default）
static func get_string(table_name: String, path: String, default: String = "") -> String:
	var v: Variant = get_value(table_name, path, default)
	if v is String:
		return v
	if v is int or v is float or v is bool:
		return str(v)
	return default

static func get_int(table_name: String, path: String, default: int = 0) -> int:
	var v: Variant = get_value(table_name, path, default)
	if v is int:
		return v
	if v is float:
		return int(v)
	if v is String and (v as String).is_valid_int():
		return (v as String).to_int()
	return default

static func get_float(table_name: String, path: String, default: float = 0.0) -> float:
	var v: Variant = get_value(table_name, path, default)
	if v is float or v is int:
		return float(v)
	if v is String and (v as String).is_valid_float():
		return (v as String).to_float()
	return default

static func get_bool(table_name: String, path: String, default: bool = false) -> bool:
	var v: Variant = get_value(table_name, path, default)
	return v if v is bool else default

static func get_dict(table_name: String, path: String, default: Dictionary = {}) -> Dictionary:
	var v: Variant = get_value(table_name, path, default)
	return v if v is Dictionary else default

static func get_array(table_name: String, path: String, default: Array = []) -> Array:
	var v: Variant = get_value(table_name, path, default)
	return v if v is Array else default

## 批量取值（热路径一次取参）。单次 ensure_loaded + 单次取表根，
## 逐路径复用 _split_path 分段缓存，与逐键 get_value(table, p, null) 逐位等价
## （含数组下标路径；缺失路径不含键、不抛错——调用方自带默认回退）。
static func get_many(table_name: String, paths: PackedStringArray) -> Dictionary:
	ensure_loaded()
	var out: Dictionary = {}
	for path in paths:
		if path.is_empty():
			continue
		var val: Variant = get_value(table_name, path, null)
		if val != null:
			out[path] = val
	return out

static func _lookup_path_in_table(table: Variant, path: String) -> Variant:
	var cur: Variant = table
	for part in _split_path(path):
		if cur is Dictionary and cur.has(part):
			cur = cur[part]
		elif cur is Array and part.is_valid_int():
			var idx := part.to_int()
			if idx >= 0 and idx < (cur as Array).size():
				cur = (cur as Array)[idx]
			else:
				return null
		else:
			return null
	return cur

## 领域文案统一读取：表 = narratives.<domain_id>，未命中回退键名本身。
## 各领域 `_msg(key)` 私有助手一律一行委托到此（语义单点化，改动只需改这一处）；
## 键名为运行期变量，属动态键，不参与 TC-ARCH-06 的静态键校验（键清单由文案表维护）。
static func msg(domain_id: String, key: String) -> String:
	return get_string("narratives." + domain_id, key, key)

# ==============================================================================
# 五、内部实现（路径解析 / 目录扫描 / 表加载）
# ==============================================================================

static func _split_path(path: String) -> PackedStringArray:
	if path.is_empty():
		return PackedStringArray()
	if _path_cache.has(path):
		return _path_cache[path]
	var parts := path.split("/")
	# 路径缓存有界 FIFO——动态文案键可无限增长，超限时仅淘汰最旧一条
	# （超限时淘汰最旧条目，对齐 BoundedResourceCache 语义，热重载仍整体清空）
	if _path_cache.size() >= PATH_CACHE_MAX_ENTRIES:
		var oldest: String = ""
		for k in _path_cache:
			oldest = String(k)
			break
		if not oldest.is_empty():
			_path_cache.erase(oldest)
	_path_cache[path] = parts
	return parts

static func _scan_dir(dir_path: String, table_prefix: String) -> void:
	var dir := DirAccess.open(dir_path)
	if dir == null:
		push_warning("GameConfig: 配置目录不存在: %s" % dir_path)
		return
	for file_name in dir.get_files():
		if not file_name.ends_with(".json"):
			continue
		var table_name := file_name.get_basename()
		if not table_prefix.is_empty():
			table_name = table_prefix + "." + table_name
		_load_table(dir_path + file_name, table_name)
	for sub_dir in dir.get_directories():
		var sub_prefix := sub_dir if table_prefix.is_empty() else table_prefix + "." + sub_dir
		_scan_dir(dir_path + sub_dir + "/", sub_prefix)

static func _load_table(file_path: String, table_name: String) -> void:
	var json := JSON.new()
	var text := FileAccess.get_file_as_string(file_path)
	var err := json.parse(text)
	if err != OK:
		_scan_failures.append("%s: JSON 解析失败 (行 %d)" % [file_path, json.get_error_line()])
		push_warning("GameConfig: JSON 解析失败 [%s]: %s (行 %d)" % [
			file_path, json.get_error_message(), json.get_error_line()
		])
		return
	var data: Variant = json.get_data()
	if data is Dictionary:
		_tables[table_name] = data
	else:
		_scan_failures.append("%s: 顶层必须是 JSON 对象" % file_path)
		push_warning("GameConfig: [%s] 顶层必须是 JSON 对象" % file_path)
