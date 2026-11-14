# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_world_service.gd
# 架构定位: Domain Boundary Adapter / Real World & Gateway Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游:
#           UnifiedProtocolDispatcher, WorldSessionRuntimeService
# 职责说明: 实现 IWorldService 接口，封装真实世界网关与大地图探索协议动作，
#           通过统一信封向 UnifiedProtocolDispatcher 分发进入、探测、选档与退出指令。
# 退出语义与设计依据: 业务领域第一性原理 / 表现层零计算纪律 / 统一协议信封解耦
# ==============================================================================

## RealWorldService：直连后端世界网关与主页 HUD 状态协议的真实边界服务实现
class_name RealWorldService
extends "res://frontend/domain_boundary/interfaces/i_world_service.gd"

const RealProtocolBridge = preload("res://frontend/domain_boundary/services/real_protocol_bridge.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")

## 获取 HUD 权威状态快照
func get_hud_snapshot_async(character_id: String, callback: Callable) -> void:
	var hud_context := WorldSessionRuntimeService.build_live_hud_context() if WorldSessionRuntimeService.has_active_world() else {}
	if not character_id.is_empty():
		hud_context["character_id"] = character_id
	var authoritative_snapshot := AuthoritativeHudSyncService.get_authoritative_snapshot(hud_context)
	if callback.is_valid():
		callback.call({
			"success": true,
			"snapshot": authoritative_snapshot.to_dto()
		})

## 获取小地图地标与行军路线
func get_map_landmarks_async(callback: Callable) -> void:
	var landmarks: Array = GameConfig.get_array("domains.world_map", "landmarks", [])
	if callback.is_valid():
		callback.call({
			"success": true,
			"landmarks": landmarks.duplicate(true)
		})

func _dispatch_gateway_action(
	action_type: String,
	account_id: String,
	token: String,
	extra_payload: Dictionary,
	callback: Callable,
	result_key: String = "data",
	fallback_value: Variant = {}
) -> void:
	var payload := {"account_id": account_id}
	if not extra_payload.is_empty():
		payload.merge(extra_payload, true)
	RealProtocolBridge.dispatch_and_reply("world_gateway", action_type, payload, account_id, token, callback, result_key, fallback_value)

## 异步进入网关契约实现
func enter_gateway_async(account_id: String, token: String, callback: Callable) -> void:
	_dispatch_gateway_action("ENTER_GATEWAY", account_id, token, {}, callback)

## 异步探针就绪度探测契约实现
func probe_modes_async(account_id: String, token: String, callback: Callable) -> void:
	_dispatch_gateway_action("PROBE_MODES", account_id, token, {}, callback, "probe_reports", {})

## 异步世界档案列表查询契约实现
func list_worlds_async(account_id: String, token: String, callback: Callable) -> void:
	_dispatch_gateway_action("LIST_WORLDS", account_id, token, {}, callback, "worlds", [])

## 异步模式与槽位选择契约实现
func select_mode_async(account_id: String, token: String, mode_id: int, account_slots: Array, callback: Callable, options: Dictionary = {}) -> void:
	var payload := {"target_mode": mode_id, "account_slots": account_slots}
	if not options.is_empty():
		payload.merge(options, true)
	_dispatch_gateway_action("SELECT_MODE", account_id, token, payload, callback)

## 异步选档/建档进入世界契约实现
func select_or_create_world_async(account_id: String, token: String, world_id: String, mode_id: int, callback: Callable, options: Dictionary = {}) -> void:
	var payload := {
		"world_id": world_id,
		"target_mode": mode_id,
		"create_if_missing": bool(options.get("create_if_missing", true))
	}
	if not options.is_empty():
		payload.merge(options, true)
	_dispatch_gateway_action("SELECT_OR_CREATE_WORLD", account_id, token, payload, callback)

## 异步关联就绪角色至网关契约实现
func attach_ready_character_async(account_id: String, token: String, character_id: String, callback: Callable) -> void:
	_dispatch_gateway_action("ATTACH_READY_CHARACTER", account_id, token, {"character_id": character_id}, callback)

## 异步正式进入指定世界档案契约实现
func enter_world_async(account_id: String, token: String, world_id: String, allow_safe_degrade: bool, callback: Callable) -> void:
	_dispatch_gateway_action("ENTER_WORLD", account_id, token, {"world_id": world_id, "allow_safe_degrade": allow_safe_degrade}, callback)

## 异步发现并预检单机显性命途 MOD 契约实现
func discover_mods_async(account_id: String, token: String, enabled_pack_ids: Array, callback: Callable) -> void:
	_dispatch_gateway_action("DISCOVER_MODS", account_id, token, {"enabled_pack_ids": enabled_pack_ids}, callback)

## 异步查询联机界域只读卡片列表契约实现
func list_remote_realms_async(account_id: String, token: String, callback: Callable) -> void:
	_dispatch_gateway_action("LIST_REMOTE_REALMS", account_id, token, {}, callback, "realms", [])

## 异步删除指定世界档案契约实现
func delete_world_async(account_id: String, token: String, world_id: String, callback: Callable) -> void:
	_dispatch_gateway_action("DELETE_WORLD", account_id, token, {"world_id": world_id}, callback)

## 异步切换网关模式契约实现
func switch_gateway_mode_async(account_id: String, token: String, target_mode: int, callback: Callable, options: Dictionary = {}) -> void:
	var payload := {"target_mode": target_mode}
	if not options.is_empty():
		payload.merge(options, true)
	_dispatch_gateway_action("SWITCH_GATEWAY_MODE", account_id, token, payload, callback)

## 异步退出世界退回网关契约实现
func exit_world_to_gateway_async(account_id: String, token: String, callback: Callable, options: Dictionary = {}) -> void:
	_dispatch_gateway_action("EXIT_WORLD_TO_GATEWAY", account_id, token, options, callback)
