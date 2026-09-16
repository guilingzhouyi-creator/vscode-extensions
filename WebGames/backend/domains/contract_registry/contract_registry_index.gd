# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_registry_index.gd
# 架构定位: Domain Registry / Specification Catalog
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 集中加载、持有并提供全域 46 域 ↔ 17 视图契约条目的只读检索与审计接口
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ContractRegistryIndex
extends RefCounted

const EntryClass = preload("res://backend/domains/contract_registry/contract_registry_entry.gd")

const SUPPORTED_SCHEMA_VERSION: int = 1
const CONTRACT_CONFIG_PATH_PRIMARY: String = "res://config/infrastructure/contracts.json"
const CONTRACT_CONFIG_PATH_FALLBACK: String = "res://backend/config/contracts.json"

static var _instance: ContractRegistryIndex = null
static var _entries: Array = []
static var _loaded: bool = false
static var _schema_version: int = 0
static var _infra_domains: Array[String] = []
static var _reverse_orphans: Array[Dictionary] = []
# 预建多键索引（Inv-CP-6）：装载期构建，查询 O(1)，避免热路径全表线性扫描
static var _by_id: Dictionary = {}
static var _by_domain: Dictionary = {}
static var _by_view: Dictionary = {}
static var _by_domain_view: Dictionary = {}
static var _by_endpoint: Dictionary = {}


## 单例访问（懒加载：首次调用触发 ensure_loaded 装载契约配置）
static func get_instance() -> ContractRegistryIndex:
	ensure_loaded()
	return _instance


## 懒加载确保已装载（幂等）：首次调用实例化并经 _load_from_config 读取契约配置
static func ensure_loaded() -> void:
	if _loaded and _instance != null:
		return
	_instance = (load("res://backend/domains/contract_registry/contract_registry_index.gd") as GDScript).new()
	_instance._load_from_config()


## 从 contracts.json 装载契约条目：主/备路径探测、JSON 解析、schema 版本校验、
## infra_domains 与 entries 装配；任一步失败 emit_error 并置 _loaded 防重复装载
func _load_from_config() -> void:
	_entries.clear()
	_infra_domains.clear()
	_reverse_orphans.clear()
	# P3-11 修复：失败路径（缺文件/解析失败/schema 不匹配/validate_config 拒绝）同样
	# 清空预建索引，避免 find_all 返回空而 find_by_*/get_contract 仍返回陈旧条目的状态分裂
	_by_id.clear()
	_by_domain.clear()
	_by_view.clear()
	_by_domain_view.clear()
	_by_endpoint.clear()

	var path := CONTRACT_CONFIG_PATH_PRIMARY
	if not FileAccess.file_exists(path):
		path = CONTRACT_CONFIG_PATH_FALLBACK
		# I5：主路径缺失回退后备副本时显式告警，防双配置源静默漂移
		ErrorReporter.emit_error("contract_registry_index", "CONFIG_FALLBACK_USED", "ContractRegistryIndex: 主配置缺失 %s，回退后备路径 %s（请收敛双配置源）" % [CONTRACT_CONFIG_PATH_PRIMARY, CONTRACT_CONFIG_PATH_FALLBACK])

	if not FileAccess.file_exists(path):
		ErrorReporter.emit_error("contract_registry_index", "CONFIG_FILE_NOT_FOUND", "ContractRegistryIndex: 未找到配置文件: %s" % path)
		_loaded = true
		return

	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		ErrorReporter.emit_error("contract_registry_index", "CONFIG_FILE_READ_FAIL", "ContractRegistryIndex: 无法读取配置文件: %s" % path)
		_loaded = true
		return

	var text := file.get_as_text()
	file.close()

	var json := JSON.new()
	var err := json.parse(text)
	if err != OK:
		ErrorReporter.emit_error("contract_registry_index", "CONFIG_JSON_PARSE_FAIL", "ContractRegistryIndex: JSON 解析失败: %s" % json.get_error_message())
		_loaded = true
		return

	var data = json.get_data()
	if not (data is Dictionary):
		ErrorReporter.emit_error("contract_registry_index", "CONFIG_ROOT_NOT_DICT", "ContractRegistryIndex: 配置根节点必须为 Dictionary")
		_loaded = true
		return

	var dict: Dictionary = data as Dictionary
	_schema_version = int(dict.get("$schema_version", 0))
	if _schema_version != SUPPORTED_SCHEMA_VERSION:
		ErrorReporter.emit_error("contract_registry_index", "CONFIG_SCHEMA_UNSUPPORTED", "ContractRegistryIndex: schema_version %d 不受支持 (期望 %d)" % [_schema_version, SUPPORTED_SCHEMA_VERSION])
		_loaded = true
		return

	var raw_infra = dict.get("infra_domains", [])
	if raw_infra is Array:
		for item in raw_infra:
			_infra_domains.append(String(item))

	# 结构校验（门禁阻断：损坏配置拒绝装载并 emit_error，杜绝半装载状态）
	var vres := validate_config(dict)
	if not bool(vres.get("valid", false)):
		var errs: Array = vres.get("errors", [])
		ErrorReporter.emit_error("contract_registry_index", "CONFIG_VALIDATION_FAILED", "ContractRegistryIndex: 契约配置结构校验失败: %s" % "; ".join(errs))
		_loaded = true
		return

	var raw_entries = dict.get("entries", [])
	if raw_entries is Array:
		for item in raw_entries:
			if item is Dictionary:
				var entry = EntryClass.from_dto(item as Dictionary)
				_entries.append(entry)

	var raw_orphans = dict.get("reverse_orphans", [])
	if raw_orphans is Array:
		for item in raw_orphans:
			if item is Dictionary:
				_reverse_orphans.append((item as Dictionary).duplicate(true))

	_rebuild_indexes()
	_loaded = true


## 配置字典结构校验（B2 门禁阻断）：schema 版本/必填字段/重复 ID/INFRA 豁免一致性逐项检查，
## 返回 {valid, errors}；损坏配置由 _load_from_config 拒绝装载
static func validate_config(data: Dictionary) -> Dictionary:
	var errors: Array[String] = []
	if int(data.get("$schema_version", -1)) != SUPPORTED_SCHEMA_VERSION:
		errors.append("SCHEMA_VERSION_MISMATCH")

	var infra_list: Array = data.get("infra_domains", []) if data.get("infra_domains", []) is Array else []
	var raw_entries: Array = data.get("entries", []) if data.get("entries", []) is Array else []
	var seen_ids: Dictionary = {}
	for item in raw_entries:
		if not item is Dictionary:
			errors.append("ENTRY_NOT_DICTIONARY")
			continue
		var cid := String(item.get("contract_id", ""))
		var dname := String(item.get("domain_name", ""))
		var vname := String(item.get("view_name", ""))
		if cid.is_empty() or dname.is_empty() or vname.is_empty():
			errors.append("MISSING_REQUIRED_FIELD:" + cid)
		if seen_ids.has(cid):
			errors.append("DUPLICATE_CONTRACT_ID:" + cid)
		seen_ids[cid] = true
		var exempt := bool(item.get("infra_exempt", false))
		if exempt and not infra_list.has(dname):
			errors.append("INFRA_EXEMPT_VIOLATION:" + cid)
		elif not exempt and infra_list.has(dname):
			errors.append("INFRA_EXEMPT_INCONSISTENT:" + cid)

	return {"valid": errors.is_empty(), "errors": errors}


## 装载期重建多键索引（_by_id/_by_domain/_by_view/_by_domain_view/_by_endpoint）
func _rebuild_indexes() -> void:
	_by_id.clear()
	_by_domain.clear()
	_by_view.clear()
	_by_domain_view.clear()
	_by_endpoint.clear()
	for e in _entries:
		_by_id[e.contract_id] = e
		if not _by_domain.has(e.domain_name):
			_by_domain[e.domain_name] = []
		_by_domain[e.domain_name].append(e)
		if not _by_view.has(e.view_name):
			_by_view[e.view_name] = []
		_by_view[e.view_name].append(e)
		var dv := "%s|%s" % [e.domain_name, e.view_name]
		if not _by_domain_view.has(dv):
			_by_domain_view[dv] = []
		_by_domain_view[dv].append(e)
		var ek := int(e.endpoint_kind)
		if not _by_endpoint.has(ek):
			_by_endpoint[ek] = []
		_by_endpoint[ek].append(e)


## 强制重载配置（清装载标志后重新 ensure_loaded，供配置热更新与测试隔离）
static func reload_from_config() -> void:
	_loaded = false
	ensure_loaded()


## 当前装载的契约配置 schema 版本（SUPPORTED_SCHEMA_VERSION=1）
static func get_schema_version() -> int:
	ensure_loaded()
	return _schema_version


## 返回 INFRA 后台服务域清单（副本数组，防外部突变内部 _infra_domains）
static func get_infra_domains() -> Array[String]:
	ensure_loaded()
	var arr: Array[String] = []
	for d in _infra_domains:
		arr.append(d)
	return arr


## 返回配置登记的 reverse_orphan 清单（副本，防外部突变；I1 审计数据化）
static func get_reverse_orphans() -> Array[Dictionary]:
	ensure_loaded()
	var out: Array[Dictionary] = []
	for o in _reverse_orphans:
		out.append(o.duplicate(true))
	return out


## 全量契约条目（懒装载后返回全部 entries 副本数组）
static func find_all() -> Array:
	ensure_loaded()
	return _entries.duplicate()


## 按域筛选契约条目（domain_name 精确匹配，走预建索引 O(1)）
static func find_by_domain(domain: String) -> Array:
	ensure_loaded()
	return (_by_domain.get(domain, []) as Array).duplicate()


## 按视图筛选契约条目（view_name 精确匹配，走预建索引 O(1)）
static func find_by_view(view: String) -> Array:
	ensure_loaded()
	return (_by_view.get(view, []) as Array).duplicate()


## 按 域+视图 组合筛选契约条目（domain_name 与 view_name 双键精确匹配，走预建索引 O(1)）
static func find_by_domain_view(domain: String, view: String) -> Array:
	ensure_loaded()
	return (_by_domain_view.get("%s|%s" % [domain, view], []) as Array).duplicate()


## 按端点类型筛选契约条目（endpoint_kind 精确匹配，走预建索引 O(1)）
static func find_by_endpoint(kind: int) -> Array:
	ensure_loaded()
	return (_by_endpoint.get(kind, []) as Array).duplicate()


## 按 contract_id 精确检索单条契约（走预建索引 O(1)，未命中返回 null）
static func get_contract(contract_id: String) -> Resource:
	ensure_loaded()
	return _by_id.get(contract_id, null)


## contract_id 是否已登记（get_contract 非空判定）
static func has_contract(contract_id: String) -> bool:
	return get_contract(contract_id) != null


## 完整性审计：对 coverage_marker=MISSING 的占位域返回缺失 DTO/事件/命令 三清单
## （数据驱动推导，不再硬编码目标域列表）
static func audit_completeness() -> Dictionary:
	ensure_loaded()
	var missing_dto: Array[String] = []
	var missing_event: Array[String] = []
	var missing_command: Array[String] = []
	for e in _entries:
		if e.coverage_marker == "MISSING":
			var dn: String = String(e.domain_name)
			if not missing_dto.has(dn):
				missing_dto.append(dn)
			if not missing_event.has(dn):
				missing_event.append(dn)
			if not missing_command.has(dn):
				missing_command.append(dn)

	return {
		"missing_dto": missing_dto,
		"missing_event": missing_event,
		"missing_command": missing_command
	}


## 破坏性变更判定：目标版本升高且携带 breaking_change_note 即视为破坏性
## （任一入参为空则保守判定为非破坏性）
static func is_breaking_change(from_entry: Variant, to_entry: Variant) -> bool:
	if from_entry == null or to_entry == null:
		return false
	if to_entry.contract_version > from_entry.contract_version and not to_entry.breaking_change_note.is_empty():
		return true
	return false
