# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_parser.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 统一解析 DTO 字段映射、EventBus 事件订阅路由、UI 命令分发校验三核心算法
# 设计依据: 业务域第一性原理 / 契约映射与路由解析规范
# ==============================================================================

class_name ContractParser
extends RefCounted

const EntryClass = preload("res://backend/domains/contract_registry/contract_registry_entry.gd")
const IndexClass = preload("res://backend/domains/contract_registry/contract_registry_index.gd")

static var _dispatched_events: Dictionary = {}
# 幂等事件表有界上限（超出逐出最旧，防长会话无界增长；Dictionary 保持插入序）
const DISPATCH_MEMO_MAX: int = 4096
static var _dispatch_seq: int = 0


## DTO 字段映射解析（Inv-CP-1 类型安全守卫，未知字段丢弃，缺失字段兜底）
static func resolve_dto_mapping(backend_dto: Dictionary, entry: Variant) -> Dictionary:
	if entry == null:
		return {"error": "CT_ERR_UNKNOWN_CONTRACT"}
	if entry.endpoint_kind != EntryClass.EndpointKind.DTO:
		return {"error": "CT_ERR_SCHEMA_INVALID"}
	if backend_dto == null:
		return {}

	var result: Dictionary = {}
	for fm in entry.field_mapping:
		if not fm is Dictionary:
			continue
		var src_field: String = String(fm.get("backend_field", ""))
		var tgt_field: String = String(fm.get("view_field", src_field))
		var trans_kind: String = String(fm.get("transform_kind", "identity"))
		var trans_cfg: Dictionary = fm.get("transform_config", {}) if fm.get("transform_config", {}) is Dictionary else {}

		# 按点分或直接取值
		var raw_val: Variant = _get_nested_field(backend_dto, src_field)

		# 类型转换与安全守卫
		var transformed_val: Variant = _apply_transform(raw_val, trans_kind, trans_cfg)
		result[tgt_field] = transformed_val

	return result


## 嵌套字段读取
static func _get_nested_field(dict: Dictionary, path: String) -> Variant:
	if path.is_empty():
		return null
	var parts: PackedStringArray = path.split(".")
	var cur: Variant = dict
	for p in parts:
		if cur is Dictionary and cur.has(p):
			cur = cur[p]
		else:
			return null
	return cur


static func _cast_int_with_clamp(val: Variant, cfg: Dictionary) -> Variant:
	if val is String and not val.is_valid_int():
		return null
	var num: int = int(val)
	if cfg.has("clamp_min") and num < int(cfg["clamp_min"]):
		num = int(cfg["clamp_min"])
	if cfg.has("clamp_max") and num > int(cfg["clamp_max"]):
		num = int(cfg["clamp_max"])
	return num


static func _apply_cast_transform(val: Variant, cfg: Dictionary) -> Variant:
	var target_type: String = String(cfg.get("to", "string")).to_lower()
	match target_type:
		"int":
			return _cast_int_with_clamp(val, cfg)
		"float":
			if val is String and not val.is_valid_float():
				return null
			return float(val)
		"string":
			return String(val)
		"bool":
			return bool(val)
		_:
			return val


## 应用 transform
static func _apply_transform(val: Variant, kind: String, cfg: Dictionary) -> Variant:
	if val == null or kind == "identity":
		return val
	if kind == "cast":
		return _apply_cast_transform(val, cfg)
	return val


## 校验事件载荷是否满足前置过滤器条件
static func _matches_event_filter(filter: Dictionary, payload: Dictionary) -> bool:
	for k in filter.keys():
		if payload.get(k) != filter[k]:
			return false
	return true


static func _is_channel_matching(channel: String, event_name: String) -> bool:
	if event_name.is_empty():
		return false
	return channel == event_name or channel.ends_with("." + event_name) or event_name == "*"


static func _record_dispatched_event_id(event_id: String) -> void:
	if _dispatched_events.size() >= DISPATCH_MEMO_MAX:
		var oldest_key: String = String(_dispatched_events.keys()[0])
		_dispatched_events.erase(oldest_key)
	_dispatched_events[event_id] = true


## EventBus 事件路由求解器（Inv-CP-2 幂等去重）
static func route_domain_event(event: Dictionary) -> Dictionary:
	if event == null or event.is_empty():
		return {"matched_contract_ids": [], "signals_to_emit": []}

	var event_id: String = String(event.get("event_id", ""))
	if event_id.is_empty():
		_dispatch_seq += 1
		event_id = "%s:%d:%d" % [String(event.get("channel", "")), Time.get_ticks_msec(), _dispatch_seq]

	if _dispatched_events.has(event_id):
		return {"already_dispatched": true, "matched_contract_ids": [], "signals_to_emit": []}

	_record_dispatched_event_id(event_id)

	var channel: String = String(event.get("channel", ""))
	var payload: Dictionary = event.get("payload", {}) if event.get("payload", {}) is Dictionary else {}
	var matched_ids: Array[String] = []
	var signals_to_emit: Array[Dictionary] = []

	for e in IndexClass.find_all():
		if _is_channel_matching(channel, e.event_name) and _matches_event_filter(e.event_filter, payload):
			matched_ids.append(e.contract_id)
			signals_to_emit.append({
				"view_name": e.view_name,
				"signal_name": e.signal_name,
				"payload": payload
			})

	return {
		"matched_contract_ids": matched_ids,
		"signals_to_emit": signals_to_emit
	}


## UI Command 分发与参数校验（Inv-CP-3 前置校验）
static func dispatch_ui_command(command: Dictionary) -> Dictionary:
	if command == null or command.is_empty():
		return {"accepted": false, "error_code": "CT_ERR_PARAMS_INVALID"}

	var view_name: String = String(command.get("view_name", ""))
	var command_id: String = String(command.get("command_id", ""))
	var params: Dictionary = command.get("params", {}) if command.get("params", {}) is Dictionary else {}

	var target_entry: Variant = _resolve_command_entry(view_name, command_id)
	if target_entry == null:
		return {"accepted": false, "error_code": "CT_ERR_UNKNOWN_COMMAND"}

	if not _validate_params_schema(target_entry.params_schema, params):
		return {"accepted": false, "error_code": "CT_ERR_SCHEMA_INVALID"}

	return {
		"accepted": true,
		"service_call_plan": {
			"service_path": target_entry.service_path,
			"method_name": target_entry.method_name,
			"params": params
		}
	}

## 解析 UI 命令目标条目（优先视图索引，回退全局索引）
static func _resolve_command_entry(view_name: String, command_id: String) -> Variant:
	var entries: Array = IndexClass.find_by_view(view_name)
	for e in entries:
		if e.endpoint_kind == EntryClass.EndpointKind.COMMAND and (e.contract_id == command_id or e.method_name == command_id):
			return e
	var direct: Variant = IndexClass.get_contract(command_id)
	if direct != null and direct.endpoint_kind == EntryClass.EndpointKind.COMMAND:
		return direct
	return null

## 校验调用参数是否符合契约 Schema 规范
static func _validate_params_schema(schema: Array, params: Dictionary) -> bool:
	for field_rule in schema:
		if not (field_rule is Dictionary):
			continue
		if not _validate_single_param_rule(field_rule, params):
			return false
	return true

## 校验单参数字段规则
static func _validate_single_param_rule(rule: Dictionary, params: Dictionary) -> bool:
	var f_name: String = String(rule.get("name", ""))
	var f_required: bool = bool(rule.get("required", false))
	var f_type: String = String(rule.get("type", ""))

	if f_required and not params.has(f_name):
		return false
	if params.has(f_name) and not f_type.is_empty():
		return _validate_field_type(params[f_name], f_type)
	return true

## 校验单字段类型匹配
static func _validate_field_type(val: Variant, expected_type: String) -> bool:
	match expected_type:
		"int":
			return val is int
		"float":
			return val is float
		"bool":
			return val is bool
		"string":
			return val is String
		_:
			return false
