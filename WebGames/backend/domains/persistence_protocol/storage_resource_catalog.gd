# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/storage_resource_catalog.gd
# 架构定位: Unified Storage Resource Catalog & Index Orchestrator
# 跨域依赖: 上游: GameConfig, PrimaryStorageEngine, AuxiliaryWorkerPool | 下游: FileAccess, JSON
# 职责说明: 统一储存资源目录中心：管理全域配置表、美术网格、贴图、文案与预制体的逻辑键
#           到物理路径的映射索引，为双域存储提供 O(1) 复杂度资源检索与分级启动清单编排，
#           彻底消灭磁盘递归扫盘。
# 设计依据: 双域储存架构资源索引与寻址规范
# ==============================================================================

class_name StorageResourceCatalog extends StorageContractInterfaces.ResourceIndexProviderContract

const StorageContractInterfaces = preload("res://backend/domains/persistence_protocol/storage_contract_interfaces.gd")
const ResourceIndexEntryDTO = preload("res://backend/domains/persistence_protocol/dto/resource_index_entry_dto.gd")
const BatchLoadRequestDTO = preload("res://backend/domains/persistence_protocol/dto/batch_load_request_dto.gd")

const PATH_RESOURCE_CATALOG: String = "res://config/infrastructure/resource_catalog.json"
const PATH_DOMAINS_JSON: String = "res://config/infrastructure/domains.json"
const PREFIX_CONFIG_KEY: String = "config."
const PREFIX_CONFIG_DIR: String = "res://config/"
const CAT_CONFIG: String = "config"
const EXT_JSON: String = ".json"
const DEFAULT_MANIFEST_BATCH_ID: String = "manifest_boot"
const DEFAULT_ESTIMATED_BYTES: int = 4096

static var _instance = null

var _entries: Dictionary = {}                # resource_id -> ResourceIndexEntryDTO
var _table_to_entry: Dictionary = {}         # table_name -> ResourceIndexEntryDTO
var _entries_by_category: Dictionary = {}    # category -> Array[ResourceIndexEntryDTO]
var _entries_by_priority: Dictionary = {}    # priority -> Array[ResourceIndexEntryDTO]
var _critical_tables: Dictionary = {}        # table_name -> true
var _loaded: bool = false

static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = new()
	return _instance

func _init() -> void:
	_entries = {}
	_table_to_entry = {}
	_entries_by_category = {}
	_entries_by_priority = {}
	_critical_tables = {}
	_loaded = false
	ensure_catalog_loaded()

## 底层纯字典 JSON 静态读取（平铺控制流）
static func _read_json_dict(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		return {}
	var text := file.get_as_text()
	file.close()
	var json := JSON.new()
	if json.parse(text) != OK or not (json.get_data() is Dictionary):
		return {}
	return json.get_data()

## 确保存档资源索引已加载
func ensure_catalog_loaded() -> void:
	if _loaded:
		return
	_loaded = true

	var root_cat := _read_json_dict(PATH_RESOURCE_CATALOG)
	for t in root_cat.get("critical_boot_tables", []):
		_critical_tables[String(t)] = true
	for c in root_cat.get("custom_entries", []):
		var cd: Dictionary = c if c is Dictionary else {}
		var dto := ResourceIndexEntryDTO.from_dict(cd) as ResourceIndexEntryDTO
		register_entry(dto)

	var root_dom := _read_json_dict(PATH_DOMAINS_JSON)
	for entry in root_dom.get("domains", []):
		_register_domain_entry(entry)

## 遍历单领域条目登记配置与子表
func _register_domain_entry(entry: Variant) -> void:
	var ed: Dictionary = entry if entry is Dictionary else {}
	var cfg_t: String = ed.get("config", "")
	if not cfg_t.is_empty():
		_register_inferred_table(cfg_t, StorageContractInterfaces.LoadPriority.NORMAL)
	var nar_t: String = ed.get("narrative", "")
	if not nar_t.is_empty():
		_register_inferred_table(nar_t, StorageContractInterfaces.LoadPriority.LOW)
	for sub_table in ed.get("sub_tables", []):
		var st_str := String(sub_table)
		if not st_str.is_empty():
			_register_inferred_table(st_str, StorageContractInterfaces.LoadPriority.NORMAL)

## 推导并注册配置表条目
func _register_inferred_table(table_name: String, default_prio: int) -> void:
	var res_id := PREFIX_CONFIG_KEY + table_name
	if _entries.has(res_id):
		return
	var parts := table_name.split(".")
	var rel_path := PREFIX_CONFIG_DIR + "/".join(parts) + EXT_JSON
	if not FileAccess.file_exists(rel_path):
		var core_path := PREFIX_CONFIG_DIR + "/".join(parts) + "/core" + EXT_JSON
		if FileAccess.file_exists(core_path):
			rel_path = core_path
	var prio := default_prio
	if _critical_tables.has(table_name) or _critical_tables.has(table_name + ".core"):
		prio = StorageContractInterfaces.LoadPriority.CRITICAL
	var entry := ResourceIndexEntryDTO.new(res_id, rel_path, CAT_CONFIG, prio)
	entry.estimated_bytes = DEFAULT_ESTIMATED_BYTES
	entry.metadata["table_name"] = table_name
	register_entry(entry)

## 注册单个资源索引条目
func register_entry(entry: ResourceIndexEntryDTO) -> void:
	if entry == null or entry.resource_id.is_empty():
		return
	_entries[entry.resource_id] = entry
	var t_name: String = String(entry.metadata.get("table_name", ""))
	if t_name.is_empty() and entry.resource_id.begins_with(PREFIX_CONFIG_KEY):
		t_name = entry.resource_id.substr(PREFIX_CONFIG_KEY.length())
	if not t_name.is_empty():
		_table_to_entry[t_name] = entry
		if t_name.ends_with(".core"):
			var base_name := t_name.substr(0, t_name.length() - 5)
			if not _table_to_entry.has(base_name):
				_table_to_entry[base_name] = entry
		elif not _table_to_entry.has(t_name + ".core"):
			_table_to_entry[t_name + ".core"] = entry

	if not _entries_by_category.has(entry.category):
		_entries_by_category[entry.category] = []
	_entries_by_category[entry.category].append(entry)

	if not _entries_by_priority.has(entry.priority):
		_entries_by_priority[entry.priority] = []
	_entries_by_priority[entry.priority].append(entry)

## 根据逻辑键获取资源条目
func resolve_entry(resource_id: String) -> RefCounted:
	ensure_catalog_loaded()
	return _entries.get(resource_id, null)

## 根据表名快速解析配置条目
func resolve_config_table_entry(table_name: String) -> ResourceIndexEntryDTO:
	ensure_catalog_loaded()
	if _table_to_entry.has(table_name):
		return _table_to_entry[table_name]
	var res_id := PREFIX_CONFIG_KEY + table_name
	if _entries.has(res_id):
		return _entries[res_id]
	# 未知动态表实时推导兜底
	_register_inferred_table(table_name, StorageContractInterfaces.LoadPriority.NORMAL)
	return _table_to_entry.get(table_name, null)

## 是否存在资源索引
func has_resource(resource_id: String) -> bool:
	return resolve_entry(resource_id) != null

## 获取指定分类所有条目
func get_entries_by_category(category: String) -> Array:
	ensure_catalog_loaded()
	return _entries_by_category.get(category, []).duplicate()

## 获取指定优先级所有条目
func get_entries_by_priority(priority: int) -> Array:
	ensure_catalog_loaded()
	return _entries_by_priority.get(priority, []).duplicate()

## 获取 L0 极速启动核心表清单
func get_critical_boot_entries() -> Array:
	ensure_catalog_loaded()
	var result: Array = []
	for entry in _entries.values():
		var e := entry as ResourceIndexEntryDTO
		if e != null and e.priority == StorageContractInterfaces.LoadPriority.CRITICAL:
			result.append(e)
	return result

## 依据世界状态构建异步批量装载请求清单
func build_manifest_for_state(_state: Variant) -> BatchLoadRequestDTO:
	ensure_catalog_loaded()
	var batch := BatchLoadRequestDTO.new(DEFAULT_MANIFEST_BATCH_ID)
	for entry in _entries.values():
		var e := entry as ResourceIndexEntryDTO
		if e != null and e.priority > StorageContractInterfaces.LoadPriority.CRITICAL:
			batch.add_entry(e)
	return batch

## 测试重置
static func reset_for_tests() -> void:
	if _instance != null:
		_instance._entries.clear()
		_instance._table_to_entry.clear()
		_instance._entries_by_category.clear()
		_instance._entries_by_priority.clear()
		_instance._critical_tables.clear()
		_instance._loaded = false
	_instance = null
