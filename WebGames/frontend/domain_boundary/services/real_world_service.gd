# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_world_service.gd
# 架构定位: Domain Boundary Adapter / Real World & Gateway Service Bridge
# 依赖与触发: 上游: ServiceContainer, ServiceLocator | 下游:
#           UnifiedProtocolDispatcher, WorldSessionRuntimeService
# 职责说明: 实现 IWorldService 接口，封装真实世界网关与大地图探索协议动作，
#           通过统一信封向 UnifiedProtocolDispatcher 分发进入、探测、选档与退出指令。
# 设计依据: 业务领域第一性原理 / 表现层零计算纪律 / 统一协议信封解耦
# ==============================================================================

class_name RealWorldService
extends "res://frontend/domain_boundary/interfaces/i_world_service.gd"

const UnifiedProtocolFactory = preload("res://backend/domains/world_state/services/unified_protocol_factory.gd")
const UnifiedProtocolDispatcher = preload("res://backend/domains/world_state/services/unified_protocol_dispatcher.gd")
const WorldSessionRuntimeService = preload("res://backend/domains/world_state/services/world_session_runtime_service.gd")
const AuthoritativeHudSyncService = preload("res://backend/domains/world_state/services/authoritative_hud_sync_service.gd")

## 获取 HUD 权威状态快照
func get_hud_snapshot_async(character_id: String, callback: Callable) -> void:
	var snap := AuthoritativeHudSyncService.get_authoritative_snapshot({"character_id": character_id})
	if callback.is_valid():
		callback.call({
			"success": true,
			"snapshot": snap.to_dto()
		})

## 获取小地图地标与行军路线
func get_map_landmarks_async(callback: Callable) -> void:
	var landmarks: Array = GameConfig.get_array("domains.world_map", "landmarks", [])
	if callback.is_valid():
		callback.call({
			"success": true,
			"landmarks": landmarks.duplicate(true)
		})

## 寻路规划：起终点索引 → 候选路线数组
func plan_routes(from_idx: int, to_idx: int) -> Array:
	if from_idx < 0 or to_idx < 0 or from_idx == to_idx:
		return []
	return [
		{"label": "A", "hours": 6, "danger_key": "ui.fe10.pf.danger_low", "cost": 50},
		{"label": "B", "hours": 4, "danger_key": "ui.fe10.pf.danger_mid", "cost": 80},
		{"label": "C", "hours": 3, "danger_key": "ui.fe10.pf.danger_high", "cost": 120},
	]

## 领地升级：建设完成与驻军提升
func upgrade_territory(territory: Dictionary) -> Dictionary:
	var updated: Dictionary = territory.duplicate(true)
	updated["construction"] = 1.0
	updated["garrison"] = int(updated.get("garrison", 0)) + 10
	return {"success": true, "territory": updated}

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
	payload.merge(extra_payload, true)
	var req := UnifiedProtocolFactory.create_human_request("world_gateway", action_type, payload, token, account_id)
	var resp := UnifiedProtocolDispatcher.dispatch_request(req)
	if not callback.is_valid():
		return
	var out_val: Variant = resp.data
	if result_key != "data":
		out_val = resp.data.get(result_key, fallback_value) if resp.data is Dictionary else fallback_value
	callback.call({
		"success": resp.success,
		"error_code": resp.error_code,
		"message": resp.error_message,
		result_key: out_val
	})

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
func select_mode_async(account_id: String, token: String, mode_id: int, account_slots: Array, callback: Callable) -> void:
	_dispatch_gateway_action("SELECT_MODE", account_id, token, {"target_mode": mode_id, "account_slots": account_slots}, callback)

## 异步选档/建档进入世界契约实现
func select_or_create_world_async(account_id: String, token: String, world_id: String, mode_id: int, callback: Callable) -> void:
	_dispatch_gateway_action("SELECT_OR_CREATE_WORLD", account_id, token, {
		"world_id": world_id,
		"target_mode": mode_id,
		"create_if_missing": true
	}, callback)

## 异步切换网关模式契约实现
func switch_gateway_mode_async(account_id: String, token: String, target_mode: int, callback: Callable) -> void:
	_dispatch_gateway_action("SWITCH_GATEWAY_MODE", account_id, token, {"target_mode": target_mode}, callback)

## 异步退出世界退回网关契约实现
func exit_world_to_gateway_async(account_id: String, token: String, callback: Callable) -> void:
	_dispatch_gateway_action("EXIT_WORLD_TO_GATEWAY", account_id, token, {}, callback)
