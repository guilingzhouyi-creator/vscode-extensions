# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 世界与主页状态服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_world_service.gd
# 职责: 规范主页 HUD 状态快照与世界环境数据接口，对齐 规范
# ==============================================================================
class_name IWorldService
extends RefCounted

## 获取 HUD 权威状态快照 (对齐 HudStatusSnapshotDTO)
func get_hud_snapshot_async(character_id: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.get_hud_snapshot_async: pure virtual method must be implemented by subclass")

## 获取小地图地标与行军路线
func get_map_landmarks_async(callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.get_map_landmarks_async: pure virtual method must be implemented by subclass")

## 寻路规划：起终点索引 → 候选路线数组（视图只渲染）
func plan_routes(from_idx: int, to_idx: int) -> Array:
	EventBusCore.get_instance().emit_log("error", "IWorldService.plan_routes: pure virtual method must be implemented by subclass")
	return []

## 领地升级：建设完成与驻军提升规则（返回新领地副本）
func upgrade_territory(territory: Dictionary) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IWorldService.upgrade_territory: pure virtual method must be implemented by subclass")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 异步进入网关契约 (对齐 ENTER_GATEWAY)
func enter_gateway_async(account_id: String, token: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.enter_gateway_async: pure virtual method must be implemented by subclass")

## 异步探针就绪度探测契约 (对齐 PROBE_MODES)
func probe_modes_async(account_id: String, token: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.probe_modes_async: pure virtual method must be implemented by subclass")

## 异步世界档案列表查询契约 (对齐 LIST_WORLDS)
func list_worlds_async(account_id: String, token: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.list_worlds_async: pure virtual method must be implemented by subclass")

## 异步模式与槽位选择契约 (对齐 SELECT_MODE)
func select_mode_async(account_id: String, token: String, mode_id: int, account_slots: Array, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.select_mode_async: pure virtual method must be implemented by subclass")

## 异步选档/建档进入世界契约 (对齐 SELECT_OR_CREATE_WORLD)
func select_or_create_world_async(account_id: String, token: String, world_id: String, mode_id: int, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.select_or_create_world_async: pure virtual method must be implemented by subclass")

## 异步切换网关模式契约 (对齐 SWITCH_GATEWAY_MODE)
func switch_gateway_mode_async(account_id: String, token: String, target_mode: int, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.switch_gateway_mode_async: pure virtual method must be implemented by subclass")

## 异步退出世界退回网关契约 (对齐 EXIT_WORLD_TO_GATEWAY)
func exit_world_to_gateway_async(account_id: String, token: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IWorldService.exit_world_to_gateway_async: pure virtual method must be implemented by subclass")
