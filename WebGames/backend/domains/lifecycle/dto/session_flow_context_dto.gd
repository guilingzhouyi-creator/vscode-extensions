# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/dto/session_flow_context_dto.gd
# 架构定位: Value Object / Snapshot DTO
# 跨域依赖: 纯数据载体，零跨域业务类依赖
# 职责说明: 跨十阶段会话上下文数据快照载体，提供零依赖纯标量与字典快照传输及未接线插槽跟踪
# 设计依据: 业务域第一性原理 / 分层解耦无头架构
# ==============================================================================

class_name SessionFlowContextDTO
extends RefCounted

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

static func acquire() -> SessionFlowContextDTO:
	var context: SessionFlowContextDTO = _free_pool.pop_back() if not _free_pool.is_empty() else SessionFlowContextDTO.new()
	context._is_borrowed = true
	_borrowed_count += 1
	return context

static func release(context: SessionFlowContextDTO) -> bool:
	if context == null or not context._is_borrowed:
		return false
	context.reset_state()
	_borrowed_count = maxi(0, _borrowed_count - 1)
	var max_free: int = maxi(0, GameConfig.get_int(POOL_CONFIG_TABLE, POOL_CONFIG_PATH, 0))
	if _free_pool.size() < max_free:
		_free_pool.append(context)
	return true

static func get_pool_size() -> int:
	if _free_pool.is_empty():
		return 0
	return _free_pool.size()

static func get_borrowed_count() -> int:
	return _borrowed_count

static func clear_pool() -> int:
	var count: int = _free_pool.size()
	_free_pool.clear()
	return count

func reset_state() -> void:
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

func mark_slot_unwired(slot_name: String) -> void:
	if slot_name.is_empty():
		return
	if not unwired_slots.has(slot_name):
		unwired_slots.append(slot_name)

func has_unwired_slot(slot_name: String) -> bool:
	if slot_name.is_empty():
		return false
	return unwired_slots.has(slot_name)

func to_dto(deep_copy: bool = false) -> Dictionary:
	if deep_copy:
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
			"account_snapshot": account_snapshot.duplicate(true),
			"gateway_slot_states": gateway_slot_states.duplicate(true),
			"physiology_snapshot": physiology_snapshot.duplicate(true),
			"wallet_snapshot": wallet_snapshot.duplicate(true),
			"opening_event_snapshot": opening_event_snapshot.duplicate(true),
			"hud_snapshot": hud_snapshot.duplicate(true),
			"shutdown_snapshot": shutdown_snapshot.duplicate(true),
			"stage_results": stage_results.duplicate(true),
			"unwired_slots": unwired_slots.duplicate()
		}
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
		"account_snapshot": account_snapshot,
		"gateway_slot_states": gateway_slot_states,
		"physiology_snapshot": physiology_snapshot,
		"wallet_snapshot": wallet_snapshot,
		"opening_event_snapshot": opening_event_snapshot,
		"hud_snapshot": hud_snapshot,
		"shutdown_snapshot": shutdown_snapshot,
		"stage_results": stage_results,
		"unwired_slots": unwired_slots
	}

static func from_dto(data: Dictionary, deep_copy: bool = false) -> SessionFlowContextDTO:
	var dto := SessionFlowContextDTO.new()
	dto.session_token = str(data.get("session_token", ""))
	dto.account_id = str(data.get("account_id", ""))
	dto.username = str(data.get("username", ""))
	dto.current_slot_id = str(data.get("current_slot_id", ""))
	dto.character_id = str(data.get("character_id", ""))
	dto.character_name = str(data.get("character_name", ""))
	dto.gender = str(data.get("gender", ""))
	dto.race_id = str(data.get("race_id", ""))
	dto.current_world_id = str(data.get("current_world_id", ""))
	dto.game_mode = int(data.get("game_mode", 0))
	dto.current_stage_index = int(data.get("current_stage_index", 0))
	dto.is_esc_menu_open = bool(data.get("is_esc_menu_open", false))
	dto.is_active = bool(data.get("is_active", true))
	if deep_copy:
		dto.account_snapshot = Dictionary(data.get("account_snapshot", {})).duplicate(true)
		dto.gateway_slot_states = Array(data.get("gateway_slot_states", [])).duplicate(true)
		dto.physiology_snapshot = Dictionary(data.get("physiology_snapshot", {})).duplicate(true)
		dto.wallet_snapshot = Dictionary(data.get("wallet_snapshot", {})).duplicate(true)
		dto.opening_event_snapshot = Dictionary(data.get("opening_event_snapshot", {})).duplicate(true)
		dto.hud_snapshot = Dictionary(data.get("hud_snapshot", {})).duplicate(true)
		dto.shutdown_snapshot = Dictionary(data.get("shutdown_snapshot", {})).duplicate(true)
		dto.stage_results = Dictionary(data.get("stage_results", {})).duplicate(true)
	else:
		dto.account_snapshot = Dictionary(data.get("account_snapshot", {}))
		dto.gateway_slot_states = Array(data.get("gateway_slot_states", []))
		dto.physiology_snapshot = Dictionary(data.get("physiology_snapshot", {}))
		dto.wallet_snapshot = Dictionary(data.get("wallet_snapshot", {}))
		dto.opening_event_snapshot = Dictionary(data.get("opening_event_snapshot", {}))
		dto.hud_snapshot = Dictionary(data.get("hud_snapshot", {}))
		dto.shutdown_snapshot = Dictionary(data.get("shutdown_snapshot", {}))
		dto.stage_results = Dictionary(data.get("stage_results", {}))
	var slots: Array = Array(data.get("unwired_slots", []))
	dto.unwired_slots = []
	for s in slots:
		dto.unwired_slots.append(str(s))
	return dto
