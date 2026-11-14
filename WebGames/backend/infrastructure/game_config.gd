# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Configuration Core)
# 文件路径: res://backend/infrastructure/game_config.gd
# 架构定位: Central Configuration Center
# 依赖与触发: 上游: 全域业务域、UI表现层快照提供者 | 下游: JSON 文件系统 | 配置: config/**/*.json (66 张配置表) | 信号: 配置重载广播
# 职责说明: 全域配置文件的泛用加载与读取层。上层业务（42 领域 / 基础设施 / 前端） 通过本底座以「表名 + 多级路径 + 默认值回退」的方式获取一切数值、文案、 标识与分类定义，实现「零硬编码、全配置驱动」，并支持运行时热重载。  配置表布局（res://config/）: config/<name>.json            -> 表名 "<name>"           （顶层） config/<sub>/<name>.json      -> 表名 "<sub>.<name>"     （嵌套目录，递归加载）  路径语法: 以 "/" 分隔多级键，如 "rates/silver"；支持数组下标 "list/0"。 用法示例: GameConfig.get_int("domains.currency", "rates/silver", 100) GameConfig.get_float("domains.combat", "participant_defaults/hp", 100.0) GameConfig.get_string("narratives.currency", "sink_transaction", "") GameConfig.get_dict("infrastructure.event_categories", "combat", {}) GameConfig.reload_config()   # 热重载：先构建新快照并校验，成功后原子交换（勿命名 reload——被 GDScript 内建遮蔽）
# 退出语义与设计依据: WebGames 零硬编码配置驱动总则
# ==============================================================================

## GameConfig：Central Configuration Center
class_name GameConfig extends RefCounted

const ConfigRouterEngine = preload("res://backend/infrastructure/config_router_engine.gd")
const GameConfigLoader = preload("res://backend/infrastructure/game_config_loader.gd")
const LogConstants = preload("res://backend/infrastructure/logging/log_constants.gd")
const SystemBaseMessages = preload("res://backend/infrastructure/logging/system_base_messages.gd")

# ==============================================================================
# 一、常量与状态
# ==============================================================================

const CONFIG_DIR: String = "res://config/"

static var _tables: Dictionary = {}
static var _loaded: bool = false
static var _tables_mutex: Mutex = Mutex.new()

## 路径分段解析缓存（table:path 每调用 split 重建的消除）。
## 键域 = 代码内静态字面量路径（有界）；只缓存分段不含值——热重载表值变化天然生效，
## 成功交换后仍清空为防御（表键集可能变化）。
static var _path_cache: Dictionary = {}

## 路径分段缓存上限：防运行期动态键（msg/拼接路径）无界增长
const PATH_CACHE_MAX_ENTRIES: int = 4096

const PATH_STORAGE_CATALOG_SCRIPT: String = "res://backend/domains/persistence_protocol/storage_resource_catalog.gd"
const PATH_AUX_WORKER_POOL_SCRIPT: String = "res://backend/domains/persistence_protocol/auxiliary_worker_pool.gd"
const PATH_BATCH_LOAD_REQUEST_SCRIPT: String = "res://backend/domains/persistence_protocol/dto/batch_load_request_dto.gd"
const CAT_CONFIG: String = "config"
const EVENT_ALL_TABLES_READY: String = "config.all_tables_ready"
const EXT_JSON: String = ".json"
const EXT_KDAT: String = ".kdat"
const PATH_CONFIG_BUNDLE: String = "res://config/config.kdat"
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
	var warnings: Array = []
	GameConfigLoader.load_all_tables_into(_tables, _scan_failures, warnings)
	_flush_loader_warnings(warnings)
	_loaded = true
	_validate_required_tables()

## 必需表校验：缺失时输出警告（防止配置漏删/改名导致业务静默回退到代码默认值）
static func _validate_required_tables() -> void:
	var missing: Array = GameConfigLoader.collect_missing_required(_tables, _required_tables)
	if not missing.is_empty():
		ErrorReporter.emit_error(LogConstants.CHANNEL_GAME_CONFIG, "REQUIRED_TABLE_MISSING", SystemBaseMessages.format(SystemBaseMessages.MSG_GAME_CONFIG_REQUIRED_MISSING, {"tables": ", ".join(missing)}))

## 同步极速加载 L0 核心底座配置表（耗时 <= 5.0ms，建立最小可运行世界状态）
static func ensure_l0_loaded_sync() -> int:
	var warnings: Array = []
	var loaded_count: int = GameConfigLoader.load_l0_entries_into(_tables, _scan_failures, warnings)
	_flush_loader_warnings(warnings)
	_loaded = true
	return loaded_count

## 借助双域储存并发工作池异步装载全部业务与文案配置表
static func load_via_storage_async(on_completed: Callable = Callable()) -> void:
	ensure_l0_loaded_sync()
	var on_item := func(entry: Variant, ok: bool, data: Variant, _err: String) -> void:
		if ok and (data is Dictionary):
			var table_name: String = str(entry.metadata.get("table_name", ""))
			if not table_name.is_empty():
				_tables_mutex.lock()
				_tables[table_name] = data
				_tables_mutex.unlock()
	var on_done := func(_bid: String, total: int, _failed: int) -> void:
		_validate_required_tables()
		EventBusCore.get_instance().emit_domain_event(EVENT_ALL_TABLES_READY, {"total": total})
		if on_completed.is_valid():
			on_completed.call(total)
	if not GameConfigLoader.try_enqueue_async_config_batch(_tables, on_item, on_done):
		ensure_loaded()
		if on_completed.is_valid():
			on_completed.call(_tables.size())

## 加载报告：全部表名 / 缺失必需表 / 表总数（运维与调试用）
static func describe() -> Dictionary:
	ensure_loaded()
	return {
		"count": _tables.size(),
		"tables": _tables.keys(),
		"missing_required": GameConfigLoader.collect_missing_required(_tables, _required_tables)
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

## 扫描失败记录（JSON 解析失败或顶层非对象表在此登记，reload 据此拒绝发布）
static var _scan_failures: Array = []

static func _flush_loader_warnings(warnings: Array) -> void:
	for warning_message in warnings:
		push_warning(str(warning_message))

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

	var built: Dictionary = {}
	var warnings: Array = []
	GameConfigLoader.scan_dir_into(CONFIG_DIR, "", built, _scan_failures, warnings)
	_flush_loader_warnings(warnings)

	if not _scan_failures.is_empty():
		return {
			"success": false, "version": _reload_counter, "error": "BUILD_FAILED",
			"details": _scan_failures.duplicate(true), "added": [], "removed": [], "changed": [],
			"table_count": old_tables.size()
		}

	var missing: Array = GameConfigLoader.collect_missing_required(built, _required_tables)
	if not missing.is_empty():
		_tables = old_tables
		_loaded = old_loaded
		return {
			"success": false, "version": _reload_counter, "error": "MISSING_REQUIRED_TABLE",
			"details": missing, "added": [], "removed": [], "changed": [],
			"table_count": old_tables.size()
		}

	if built.is_empty() and not old_tables.is_empty():
		_loaded = old_loaded
		return {
			"success": false, "version": _reload_counter, "error": "BUILD_FAILED",
			"added": [], "removed": [], "changed": [],
			"table_count": old_tables.size()
		}

	var diff: Dictionary = GameConfigLoader.diff_table_snapshots(old_tables, built)
	_reload_counter += 1
	_tables = built
	_loaded = true
	_path_cache.clear()
	EventBusCore.get_instance().emit_domain_event("config.security_reloaded", {"version": _reload_counter, "changed": diff["changed"]})
	return {
		"success": true,
		"version": _reload_counter,
		"added": diff["added"],
		"removed": diff["removed"],
		"changed": diff["changed"],
		"table_count": _tables.size()
	}

## 别名委托 reload_config()
static func reload_all_configurations() -> Dictionary:
	return reload_config()

## 单子表靶向热重载（零污染、单子表原子替换）
static func reload_subtable(subtable_name: String) -> Dictionary:
	var resolved: String = ConfigRouterEngine.resolve_table_name(subtable_name)
	var load_result: Dictionary = GameConfigLoader.load_single_subtable_json(resolved)
	if not bool(load_result.get("success", false)):
		return load_result

	_tables[resolved] = load_result.get("data", {})
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

## 查询全量配置表是否已完成初始化加载
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
		GameConfigLoader.ensure_table_loaded_jit(target_table, _tables, _scan_failures)
	return _tables.get(target_table, default)

## 判定指定配置表是否存在且可加载
static func has_table(table_name: String) -> bool:
	ensure_loaded()
	var target_table := ConfigRouterEngine.resolve_table_name(table_name)
	if not _tables.has(target_table):
		GameConfigLoader.ensure_table_loaded_jit(target_table, _tables, _scan_failures)
	return _tables.has(target_table)

static func _resolve_raw_value(table_name: String, path: String) -> Variant:
	ensure_loaded()
	var target_table: String = ConfigRouterEngine.resolve_target_table(table_name, path)
	if not _tables.has(target_table):
		GameConfigLoader.ensure_table_loaded_jit(target_table, _tables, _scan_failures)
	var raw_value: Variant = _lookup_path_in_table(_tables.get(target_table, {}), path)
	if raw_value != null:
		return raw_value
	var subtables: Array = ConfigRouterEngine.get_subtables_for_domain(table_name)
	var empty_table: Dictionary = {}
	for sub in subtables:
		var subtable_name := String(sub)
		if subtable_name == target_table:
			continue
		if not _tables.has(subtable_name):
			GameConfigLoader.ensure_table_loaded_jit(subtable_name, _tables, _scan_failures)
		var subtable_value: Variant = _lookup_path_in_table(_tables.get(subtable_name, empty_table), path)
		if subtable_value != null:
			return subtable_value
	return null

## 判断「表 + 多级路径」是否存在
static func has(table_name: String, path: String) -> bool:
	return _resolve_raw_value(table_name, path) != null

## 泛用取值：任意类型，未命中或类型不符时返回 default（不抛错）
static func get_value(table_name: String, path: String, default: Variant = null) -> Variant:
	var raw_value: Variant = _resolve_raw_value(table_name, path)
	return raw_value if raw_value != null else default

## 类型化取值（带数值/字符串宽松转换与默认值回退，未命中一律回退 default）
static func get_string(table_name: String, path: String, default: String = "") -> String:
	var raw_value: Variant = get_value(table_name, path, default)
	if raw_value is String:
		return raw_value
	if raw_value is int or raw_value is float or raw_value is bool:
		return str(raw_value)
	return default

## 读取配置表指定路径的整型数值
static func get_int(table_name: String, path: String, default: int = 0) -> int:
	var raw_value: Variant = get_value(table_name, path, default)
	if raw_value is int:
		return raw_value
	if raw_value is float:
		return int(raw_value)
	if raw_value is String and (raw_value as String).is_valid_int():
		return (raw_value as String).to_int()
	return default

## 读取配置表指定路径的浮点数值
static func get_float(table_name: String, path: String, default: float = 0.0) -> float:
	var raw_value: Variant = get_value(table_name, path, default)
	if raw_value is float or raw_value is int:
		return float(raw_value)
	if raw_value is String and (raw_value as String).is_valid_float():
		return (raw_value as String).to_float()
	return default

## 读取配置表指定路径的布尔值
static func get_bool(table_name: String, path: String, default: bool = false) -> bool:
	var raw_value: Variant = get_value(table_name, path, default)
	return raw_value if raw_value is bool else default

## 读取配置表指定路径的字典结构
static func get_dict(table_name: String, path: String, default: Dictionary = {}) -> Dictionary:
	var raw_value: Variant = get_value(table_name, path, default)
	return raw_value if raw_value is Dictionary else default

## 读取配置表指定路径的数组列表
static func get_array(table_name: String, path: String, default: Array = []) -> Array:
	var raw_value: Variant = get_value(table_name, path, default)
	return raw_value if raw_value is Array else default

## 批量取值（热路径一次取参）。单次 ensure_loaded + 单次取表根，
## 逐路径复用 _split_path 分段缓存，与逐键 get_value(table, p, null) 逐位等价
## （含数组下标路径；缺失路径不含键、不抛错——调用方自带默认回退）。
static func get_many(table_name: String, paths: PackedStringArray) -> Dictionary:
	ensure_loaded()
	var collected_values: Dictionary = {}
	for path in paths:
		if path.is_empty():
			continue
		var raw_value: Variant = get_value(table_name, path, null)
		if raw_value != null:
			collected_values[path] = raw_value
	return collected_values

static func _lookup_path_in_table(table: Variant, path: String) -> Variant:
	var current_node: Variant = table
	for part in _split_path(path):
		if current_node is Dictionary and current_node.has(part):
			current_node = current_node[part]
		elif current_node is Array and part.is_valid_int():
			var array_index := part.to_int()
			if array_index >= 0 and array_index < (current_node as Array).size():
				current_node = (current_node as Array)[array_index]
			else:
				return null
		else:
			return null
	return current_node

## 领域文案统一读取：表 = narratives.<domain_id>，未命中回退键名本身。
## 各领域 `_msg(key)` 私有助手一律一行委托到此（语义单点化，改动只需改这一处）；
## 键名为运行期变量，属动态键，不参与 TC-ARCH-06 的静态键校验（键清单由文案表维护）。
static func msg(domain_id: String, key: String) -> String:
	return get_string("narratives." + domain_id, key, key)

## 领域文案统一格式化读取：表 = narratives.<domain_id>，获取模板后经 TemplateFormatter 执行 {param} 填充。
## 支持大小写键名自适应容错，未命中配置键回退 fallback 或 key 本身。
static func msg_fmt(domain_id: String, key: String, params: Dictionary = {}, fallback: String = "") -> String:
	var default_text := fallback if not fallback.is_empty() else key
	var template_text := get_string("narratives." + domain_id, key, default_text)
	return TemplateFormatter.format(template_text, params)

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
		for cache_key in _path_cache:
			oldest = String(cache_key)
			break
		if not oldest.is_empty():
			_path_cache.erase(oldest)
	_path_cache[path] = parts
	return parts
