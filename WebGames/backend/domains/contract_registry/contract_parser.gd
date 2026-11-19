# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/contract_registry/contract_parser.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/contract_registry.json | 信号: EventBus 领域广播
# 职责说明: 统一解析 DTO 字段映射、EventBus 事件订阅路由、UI 命令分发校验三核心算法
# 退出语义与设计依据: 业务域第一性原理 / 契约映射与路由解析规范
# ==============================================================================

## ContractParser：Domain Logic Component
class_name ContractParser
extends RefCounted

const EntryClass = preload("res://backend/domains/contract_registry/contract_registry_entry.gd")
const IndexClass = preload("res://backend/domains/contract_registry/contract_registry_index.gd")

static var _dispatched_events: Dictionary = {}
# 幂等事件表有界上限（超出逐出最旧，防长会话无界增长；Dictionary 保持插入序）
const DISPATCH_MEMO_MAX: int = 4096
static var _dispatch_sequence: int = 0


## DTO 字段映射解析（Inv-CP-1 类型安全守卫，未知字段丢弃，缺失字段安全回退）
static func resolve_dto_mapping(backend_dto: Dictionary, entry: Variant) -> Dictionary:
	if entry == null:
		return {"error_code": "CT_ERR_UNKNOWN_CONTRACT"}
	if entry.endpoint_kind != EntryClass.EndpointKind.DTO:
		return {"error_code": "CT_ERR_SCHEMA_INVALID"}
	if backend_dto == null:
		return {}

	var mapped_fields: Dictionary = {}
	var empty_config: Dictionary = {}
	for mapping_rule in entry.field_mapping:
		if not mapping_rule is Dictionary:
			continue
		var source_field: String = String(mapping_rule.get("backend_field", ""))
		var target_field: String = String(mapping_rule.get("view_field", source_field))
		var transform_kind: String = String(mapping_rule.get("transform_kind", "identity"))
		var raw_config: Variant = mapping_rule.get("transform_config")
		var transform_config: Dictionary = raw_config if raw_config is Dictionary else empty_config

		# 按点分或直接取值
		var raw_value: Variant = _get_nested_field(backend_dto, source_field)

		# 类型转换与安全守卫
		var transformed_value: Variant = _apply_transform(raw_value, transform_kind, transform_config)
		mapped_fields[target_field] = transformed_value

	return mapped_fields


## 嵌套字段读取
static func _get_nested_field(source_dictionary: Dictionary, path: String) -> Variant:
	if path.is_empty():
		return null
	var parts: PackedStringArray = path.split(".")
	var current_node: Variant = source_dictionary
	for segment in parts:
		if current_node is Dictionary and current_node.has(segment):
			current_node = current_node[segment]
		else:
			return null
	return current_node


static func _cast_int_with_clamp(raw_value: Variant, transform_config: Dictionary) -> Variant:
	if raw_value is String and not raw_value.is_valid_int():
		return null
	var parsed_integer: int = int(raw_value)
	if transform_config.has("clamp_min") and parsed_integer < int(transform_config["clamp_min"]):
		parsed_integer = int(transform_config["clamp_min"])
	if transform_config.has("clamp_max") and parsed_integer > int(transform_config["clamp_max"]):
		parsed_integer = int(transform_config["clamp_max"])
	return parsed_integer


static func _apply_cast_transform(raw_value: Variant, transform_config: Dictionary) -> Variant:
	var target_type: String = String(transform_config.get("to", "string")).to_lower()
	match target_type:
		"int":
			return _cast_int_with_clamp(raw_value, transform_config)
		"float":
			if raw_value is String and not raw_value.is_valid_float():
				return null
			return float(raw_value)
		"string":
			return String(raw_value)
		"bool":
			return bool(raw_value)
		_:
			return raw_value


## 应用 transform
static func _apply_transform(raw_value: Variant, kind: String, transform_config: Dictionary) -> Variant:
	if raw_value == null or kind == "identity":
		return raw_value
	if kind == "cast":
		return _apply_cast_transform(raw_value, transform_config)
	return raw_value


## 校验事件载荷是否满足前置过滤器条件
static func _matches_event_filter(filter: Dictionary, payload: Dictionary) -> bool:
	for filter_key in filter.keys():
		if payload.get(filter_key) != filter[filter_key]:
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
		_dispatch_sequence += 1
		event_id = "%s:%d:%d" % [String(event.get("channel", "")), Time.get_ticks_msec(), _dispatch_sequence]

	if _dispatched_events.has(event_id):
		return {"already_dispatched": true, "matched_contract_ids": [], "signals_to_emit": []}

	_record_dispatched_event_id(event_id)

	var channel: String = String(event.get("channel", ""))
	var payload: Dictionary = event.get("payload", {}) if event.get("payload", {}) is Dictionary else {}
	var matched_ids: Array[String] = []
	var signals_to_emit: Array[Dictionary] = []

	for entry in IndexClass.find_all():
		if _is_channel_matching(channel, entry.event_name) and _matches_event_filter(entry.event_filter, payload):
			matched_ids.append(entry.contract_id)
			signals_to_emit.append({
				"view_name": entry.view_name,
				"signal_name": entry.signal_name,
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
	var parameter_map: Dictionary = command.get("params", {}) if command.get("params", {}) is Dictionary else {}

	var target_entry: Variant = _resolve_command_entry(view_name, command_id)
	if target_entry == null:
		return {"accepted": false, "error_code": "CT_ERR_UNKNOWN_COMMAND"}

	if not _validate_params_schema(target_entry.params_schema, parameter_map):
		return {"accepted": false, "error_code": "CT_ERR_SCHEMA_INVALID"}

	return {
		"accepted": true,
		"service_call_plan": {
			"service_path": target_entry.service_path,
			"method_name": target_entry.method_name,
			"params": parameter_map
		}
	}

## 解析 UI 命令目标条目（优先视图索引，回退全局索引）
static func _resolve_command_entry(view_name: String, command_id: String) -> Variant:
	var entries: Array = IndexClass.find_by_view(view_name)
	for entry in entries:
		if entry.endpoint_kind == EntryClass.EndpointKind.COMMAND and (entry.contract_id == command_id or entry.method_name == command_id):
			return entry
	var direct: Variant = IndexClass.get_contract(command_id)
	if direct != null and direct.endpoint_kind == EntryClass.EndpointKind.COMMAND:
		return direct
	return null

## 校验调用参数是否符合契约 Schema 规范
static func _validate_params_schema(schema: Array, parameter_map: Dictionary) -> bool:
	for field_rule in schema:
		if not (field_rule is Dictionary):
			continue
		if not _validate_single_param_rule(field_rule, parameter_map):
			return false
	return true

## 校验单参数字段规则
static func _validate_single_param_rule(rule: Dictionary, parameter_map: Dictionary) -> bool:
	var field_name: String = String(rule.get("name", ""))
	var is_field_required: bool = bool(rule.get("required", false))
	var field_type: String = String(rule.get("type", ""))

	if is_field_required and not parameter_map.has(field_name):
		return false
	if parameter_map.has(field_name) and not field_type.is_empty():
		return _validate_field_type(parameter_map[field_name], field_type)
	return true

## 校验单字段类型匹配
static func _validate_field_type(field_value: Variant, expected_type: String) -> bool:
	match expected_type:
		"int":
			return field_value is int
		"float":
			return field_value is float
		"bool":
			return field_value is bool
		"string":
			return field_value is String
		_:
			return false
