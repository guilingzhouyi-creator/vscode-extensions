# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/primary_storage_engine.gd
# 架构定位: Primary Domain Storage Engine
# 跨域依赖: 上游: WorldGateway, AuthService | 下游: SaveManager, GameConfig, EventBusCore
# 职责说明: 主要数据储存引擎：负责影响游戏世界状态、用户身份与长期一致性的核心数据持久化，
#           提供基于毫秒级时限的“最小可运行世界状态”快速恢复（TTFI 优化），
#           严格落实三段式原子写、SHA-256 签名完整性与损坏自动回滚自愈。
# 设计依据: 双域储存架构主要数据域规范
# ==============================================================================

class_name PrimaryStorageEngine extends RefCounted

const StorageContractInterfaces = preload("res://backend/domains/persistence_protocol/storage_contract_interfaces.gd")
const MinimumWorldStateDTO = preload("res://backend/domains/persistence_protocol/dto/minimum_world_state_dto.gd")

const USEC_TO_MS: float = 1000.0
const STAGE_MINIMAL_RESTORE_READY: String = "MINIMAL_RESTORE_READY"
const LOG_LEVEL_WARN: String = "warn"
const LOG_LEVEL_ERROR: String = "error"
const LOG_LEVEL_INFO: String = "info"
const LOG_RESTORE_TIMEOUT: String = "PrimaryStorageEngine: 最小状态恢复耗时 (%.2fms) 超出预算 (%.2fms)"
const LOG_SAVE_FAIL: String = "PrimaryStorageEngine: 保存存档失败 [%s]: %s"
const LOG_LOAD_FAIL: String = "PrimaryStorageEngine: 加载存档失败 [%s]: %s"
const LOG_RESTORE_SUCCESS: String = "PrimaryStorageEngine: 从备份成功恢复存档 [%s]"
const LOG_RESTORE_FAIL: String = "PrimaryStorageEngine: 备份恢复失败 [%s]: %s"
const ERR_EMPTY_SLOT_ID: String = "EMPTY_SLOT_ID"
const ERR_EMPTY_PAYLOAD: String = "EMPTY_PAYLOAD"
const DEFAULT_ACCOUNT_ID: String = "ACC_DEFAULT"
const DEFAULT_WORLD_MODE: String = "SINGLE_PLAYER"
const DEFAULT_MAX_HP: float = 100.0

static var _instance = null

static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = new()
	return _instance

## 快速恢复最小可运行世界状态（极速达成 TTFI）
func quick_restore_minimal_state(slot_id: String) -> Dictionary:
	var clean_slot := slot_id.strip_edges()
	if clean_slot.is_empty():
		return {
			"success": false,
			"error_code": ERR_EMPTY_SLOT_ID,
			"duration_ms": 0.0,
			"state": null
		}
	var start_ticks := Time.get_ticks_usec()
	var load_result: Dictionary = SaveManager.load_game(clean_slot)
	
	if not bool(load_result.get("success", false)):
		var elapsed_fail := float(Time.get_ticks_usec() - start_ticks) / USEC_TO_MS
		return {
			"success": false,
			"error_code": load_result.get("error_code", "RESTORE_FAILED"),
			"duration_ms": elapsed_fail,
			"state": null
		}

	var data: Dictionary = load_result.get("data", {})
	var meta: Dictionary = load_result.get("meta", {})
	var min_state := _extract_minimal_state(clean_slot, data, meta)
	var elapsed_ms := float(Time.get_ticks_usec() - start_ticks) / USEC_TO_MS

	var max_budget := GameConfig.get_float("infrastructure.storage", "primary/minimal_state/max_restore_budget_ms", 5.0)
	if elapsed_ms > max_budget:
		EventBusCore.get_instance().emit_log(LOG_LEVEL_WARN, LOG_RESTORE_TIMEOUT % [elapsed_ms, max_budget])

	return {
		"success": true,
		"state": min_state,
		"duration_ms": elapsed_ms,
		"verified": bool(load_result.get("verified", true)),
		"stage": STAGE_MINIMAL_RESTORE_READY
	}

## 从完整或部分载荷提取最小状态 DTO
func _extract_minimal_state(slot_id: String, data: Dictionary, meta: Dictionary) -> MinimumWorldStateDTO:
	var account_data: Dictionary = data.get("account", {})
	var char_data: Dictionary = data.get("character", {})
	if char_data.is_empty():
		char_data = data.get("character_info", {})
	var life_data: Dictionary = data.get("lifecycle", {})
	var wallet_data: Dictionary = data.get("currency_economy", {})
	if wallet_data.is_empty():
		wallet_data = data.get("wallet", {})

	var account_id: String = String(account_data.get("account_id", data.get("account_id", DEFAULT_ACCOUNT_ID)))
	var char_name: String = String(char_data.get("name", char_data.get("character_name", slot_id)))
	var world_mode: String = String(data.get("world_mode", DEFAULT_WORLD_MODE))

	var dto := MinimumWorldStateDTO.new(account_id, slot_id, char_name, world_mode)
	dto.level = int(char_data.get("level", 1))
	dto.current_hp = float(life_data.get("hp", life_data.get("current_hp", DEFAULT_MAX_HP)))
	dto.max_hp = float(life_data.get("max_hp", DEFAULT_MAX_HP))
	dto.play_time_seconds = int(meta.get("play_time_seconds", data.get("play_time_seconds", 0)))
	dto.prologue_completed = bool(data.get("prologue_completed", false))
	dto.currency_summary = {
		"gold": int(wallet_data.get("gold", 0)),
		"crystals": int(wallet_data.get("crystals", 0))
	}
	dto.metadata = {
		"signature_sha256": meta.get("signature_sha256", ""),
		"created_timestamp": meta.get("created_timestamp", 0)
	}
	return dto

## 保存主要世界数据（强一致性原子写入）
func save_primary_data(slot_id: String, payload: Dictionary) -> Dictionary:
	var clean_slot := slot_id.strip_edges()
	if clean_slot.is_empty():
		return {"success": false, "error_code": ERR_EMPTY_SLOT_ID}
	if payload.is_empty():
		return {"success": false, "error_code": ERR_EMPTY_PAYLOAD}
	var res: Dictionary = SaveManager.save_game(clean_slot, payload)
	if not bool(res.get("success", false)):
		EventBusCore.get_instance().emit_log(LOG_LEVEL_ERROR, LOG_SAVE_FAIL % [clean_slot, res.get("error_code", "UNKNOWN")])
	return res

## 完整加载主要世界数据
func load_primary_data(slot_id: String) -> Dictionary:
	var clean_slot := slot_id.strip_edges()
	if clean_slot.is_empty():
		return {"success": false, "error_code": ERR_EMPTY_SLOT_ID, "data": {}}
	var res: Dictionary = SaveManager.load_game(clean_slot)
	if not bool(res.get("success", false)):
		EventBusCore.get_instance().emit_log(LOG_LEVEL_WARN, LOG_LOAD_FAIL % [clean_slot, res.get("error_code", "UNKNOWN")])
	return res

## 从备份恢复存档
func restore_backup(slot_id: String) -> Dictionary:
	var clean_slot := slot_id.strip_edges()
	if clean_slot.is_empty():
		return {"success": false, "error_code": ERR_EMPTY_SLOT_ID}
	var res: Dictionary = SaveManager.restore_backup(clean_slot)
	if bool(res.get("success", false)):
		EventBusCore.get_instance().emit_log(LOG_LEVEL_INFO, LOG_RESTORE_SUCCESS % clean_slot)
	else:
		EventBusCore.get_instance().emit_log(LOG_LEVEL_ERROR, LOG_RESTORE_FAIL % [clean_slot, res.get("error_code", "UNKNOWN")])
	return res

## 校验存档完整性与防伪签名
func verify_integrity(slot_id: String) -> bool:
	var clean_slot := slot_id.strip_edges()
	if clean_slot.is_empty():
		return false
	var res: Dictionary = SaveManager.load_game(clean_slot)
	return bool(res.get("success", false)) and bool(res.get("verified", false))

## 测试重置
static func reset_for_tests() -> void:
	_instance = null
