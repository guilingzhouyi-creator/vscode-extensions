# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/dto/session_flow_context_dto.gd
# 架构定位: Value Object / Snapshot DTO
# 依赖与触发: 纯数据载体，零跨域业务类依赖
# 职责说明: 跨十阶段会话上下文数据快照载体，提供零依赖纯标量与字典快照传输及未接线插槽跟踪
# 退出语义与设计依据: 业务域第一性原理 / 分层解耦无头架构
# ==============================================================================

## SessionFlowContextDTO：Value Object / Snapshot DTO
class_name SessionFlowContextDTO
extends PoolableDtoBase

const POOL_CONFIG_TABLE: String = "infrastructure.lifecycle"
const POOL_CONFIG_PATH: String = "session_context_pool/max_free"

static var _free_pool: Array[SessionFlowContextDTO] = []
static var _borrowed_count: int = 0

var _is_borrowed: bool = false

var session_token: String = ""
var account_id: String = ""
var username: String = ""
var current_slot_id: String = ""
var character_id: String = ""
var character_name: String = ""
var gender: String = ""
var race_id: String = ""
var current_world_id: String = ""
var game_mode: int = 0
var current_stage_index: int = 0
var is_esc_menu_open: bool = false
var is_active: bool = true

# 领域快照字典（解耦所有领域 Aggregate 强引用）
var account_snapshot: Dictionary = {}
var gateway_slot_states: Array = []
var physiology_snapshot: Dictionary = {}
var wallet_snapshot: Dictionary = {}
var opening_event_snapshot: Dictionary = {}
var hud_snapshot: Dictionary = {}
var shutdown_snapshot: Dictionary = {}
var stage_results: Dictionary = {}

# 显式未接线插槽跟踪
var unwired_slots: Array[String] = []

## 从对象池获取可用实例
static func acquire() -> SessionFlowContextDTO:
	var context: SessionFlowContextDTO = _free_pool.pop_back() if not _free_pool.is_empty() else SessionFlowContextDTO.new()
	context._is_borrowed = true
	_borrowed_count += 1
	return context

## 将实例归还重置至对象池
static func release(context: SessionFlowContextDTO) -> bool:
	if context == null or not context._is_borrowed:
		return false
	context.reset_state()
	_borrowed_count = maxi(0, _borrowed_count - 1)
	var max_free: int = maxi(0, GameConfig.get_int(POOL_CONFIG_TABLE, POOL_CONFIG_PATH, 0))
	if _free_pool.size() < max_free:
		_free_pool.append(context)
	return true

## 获取对象池当前空闲实例容量
static func get_pool_size() -> int:
	if _free_pool.is_empty():
		return 0
	return _free_pool.size()

## 获取当前借出使用的实例数量
static func get_borrowed_count() -> int:
	return _borrowed_count

## 清空对象池实例缓存
static func clear_pool() -> int:
	var count: int = _free_pool.size()
	_free_pool.clear()
	return count

## 重置内部数据状态，供对象池无堆分配复用
func reset_state() -> void:
	super.reset_state()
	session_token = ""
	account_id = ""
	username = ""
	current_slot_id = ""
	character_id = ""
	character_name = ""
	gender = ""
	race_id = ""
	current_world_id = ""
	game_mode = 0
	current_stage_index = 0
	is_esc_menu_open = false
	is_active = true
	account_snapshot = {}
	gateway_slot_states = []
	physiology_snapshot = {}
	wallet_snapshot = {}
	opening_event_snapshot = {}
	hud_snapshot = {}
	shutdown_snapshot = {}
	stage_results = {}
	unwired_slots = []
	_is_borrowed = false

## 修剪清理会话流上下文中的中间过程快照
func prune_intermediate_snapshots() -> int:
	if current_stage_index < 6:
		return 0
	var pruned: int = 0
	if not opening_event_snapshot.is_empty():
		opening_event_snapshot.clear()
		pruned += 1
	if not physiology_snapshot.is_empty():
		physiology_snapshot.clear()
		pruned += 1
	return pruned

## 标记指定生命周期插槽为未接线状态
func mark_slot_unwired(slot_name: String) -> void:
	if slot_name.is_empty():
		return
	if not unwired_slots.has(slot_name):
		unwired_slots.append(slot_name)

## 查询是否存在未接线的指定生命周期插槽
func has_unwired_slot(slot_name: String) -> bool:
	if slot_name.is_empty():
		return false
	return unwired_slots.has(slot_name)

static func _dup_dict_field(raw_field_value: Variant, should_deep_copy: bool) -> Dictionary:
	var copied_dictionary: Dictionary = Dictionary(raw_field_value) if raw_field_value != null else {}
	if should_deep_copy:
		return copied_dictionary.duplicate(true)
	return copied_dictionary

static func _dup_array_field(raw_field_value: Variant, should_deep_copy: bool) -> Array:
	var copied_array: Array = Array(raw_field_value) if raw_field_value != null else []
	if should_deep_copy:
		return copied_array.duplicate(true)
	return copied_array

## 序列化当前对象为通用字典传输结构
func to_dto(should_deep_copy: bool = false) -> Dictionary:
	return {
		"session_token": session_token,
		"account_id": account_id,
		"username": username,
		"current_slot_id": current_slot_id,
		"character_id": character_id,
		"character_name": character_name,
		"gender": gender,
		"race_id": race_id,
		"current_world_id": current_world_id,
		"game_mode": game_mode,
		"current_stage_index": current_stage_index,
		"is_esc_menu_open": is_esc_menu_open,
		"is_active": is_active,
		"account_snapshot": _dup_dict_field(account_snapshot, should_deep_copy),
		"gateway_slot_states": _dup_array_field(gateway_slot_states, should_deep_copy),
		"physiology_snapshot": _dup_dict_field(physiology_snapshot, should_deep_copy),
		"wallet_snapshot": _dup_dict_field(wallet_snapshot, should_deep_copy),
		"opening_event_snapshot": _dup_dict_field(opening_event_snapshot, should_deep_copy),
		"hud_snapshot": _dup_dict_field(hud_snapshot, should_deep_copy),
		"shutdown_snapshot": _dup_dict_field(shutdown_snapshot, should_deep_copy),
		"stage_results": _dup_dict_field(stage_results, should_deep_copy),
		"unwired_slots": unwired_slots.duplicate() if should_deep_copy else unwired_slots
	}

## 从输入字典反序列化还原传输对象
static func from_dto(serialized_payload: Dictionary, should_deep_copy: bool = false) -> SessionFlowContextDTO:
	var context := SessionFlowContextDTO.new()
	context.session_token = str(serialized_payload.get("session_token", ""))
	context.account_id = str(serialized_payload.get("account_id", ""))
	context.username = str(serialized_payload.get("username", ""))
	context.current_slot_id = str(serialized_payload.get("current_slot_id", ""))
	context.character_id = str(serialized_payload.get("character_id", ""))
	context.character_name = str(serialized_payload.get("character_name", ""))
	context.gender = str(serialized_payload.get("gender", ""))
	context.race_id = str(serialized_payload.get("race_id", ""))
	context.current_world_id = str(serialized_payload.get("current_world_id", ""))
	context.game_mode = int(serialized_payload.get("game_mode", 0))
	context.current_stage_index = int(serialized_payload.get("current_stage_index", 0))
	context.is_esc_menu_open = bool(serialized_payload.get("is_esc_menu_open", false))
	context.is_active = bool(serialized_payload.get("is_active", true))
	context.account_snapshot = _dup_dict_field(serialized_payload.get("account_snapshot", {}), should_deep_copy)
	context.gateway_slot_states = _dup_array_field(serialized_payload.get("gateway_slot_states", []), should_deep_copy)
	context.physiology_snapshot = _dup_dict_field(serialized_payload.get("physiology_snapshot", {}), should_deep_copy)
	context.wallet_snapshot = _dup_dict_field(serialized_payload.get("wallet_snapshot", {}), should_deep_copy)
	context.opening_event_snapshot = _dup_dict_field(serialized_payload.get("opening_event_snapshot", {}), should_deep_copy)
	context.hud_snapshot = _dup_dict_field(serialized_payload.get("hud_snapshot", {}), should_deep_copy)
	context.shutdown_snapshot = _dup_dict_field(serialized_payload.get("shutdown_snapshot", {}), should_deep_copy)
	context.stage_results = _dup_dict_field(serialized_payload.get("stage_results", {}), should_deep_copy)
	var slots: Array = Array(serialized_payload.get("unwired_slots", []))
	context.unwired_slots = []
	for slot_entry in slots:
		context.unwired_slots.append(str(slot_entry))
	return context
