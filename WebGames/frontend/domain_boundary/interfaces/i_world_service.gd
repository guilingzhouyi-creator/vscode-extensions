# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 世界与主页状态服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_world_service.gd
# 职责: 规范主页 HUD 状态快照与世界环境数据接口，对齐 规范
# ==============================================================================
class_name IWorldService
extends RefCounted

## 获取 HUD 权威状态快照 (对齐 HudStatusSnapshotDTO)
func get_hud_snapshot_async(character_id: String, callback: Callable) -> void:
	printerr("IWorldService.get_hud_snapshot_async: 纯虚函数必须由子类实现")

## 获取小地图地标与行军路线
func get_map_landmarks_async(callback: Callable) -> void:
	printerr("IWorldService.get_map_landmarks_async: 纯虚函数必须由子类实现")

## 寻路规划：起终点索引 → 候选路线数组（视图只渲染）
func plan_routes(from_idx: int, to_idx: int) -> Array:
	printerr("IWorldService.plan_routes: 纯虚函数必须由子类实现")
	return []

## 领地升级：建设完成与驻军提升规则（返回新领地副本）
func upgrade_territory(territory: Dictionary) -> Dictionary:
	printerr("IWorldService.upgrade_territory: 纯虚函数必须由子类实现")
	return {"success": false, "error_code": "NOT_IMPLEMENTED"}

## 异步进入网关契约 (对齐 ENTER_GATEWAY)
func enter_gateway_async(account_id: String, token: String, callback: Callable) -> void:
	printerr("IWorldService.enter_gateway_async: 纯虚函数必须由子类实现")

## 异步探针就绪度探测契约 (对齐 PROBE_MODES)
func probe_modes_async(account_id: String, token: String, callback: Callable) -> void:
	printerr("IWorldService.probe_modes_async: 纯虚函数必须由子类实现")

## 异步世界档案列表查询契约 (对齐 LIST_WORLDS)
func list_worlds_async(account_id: String, token: String, callback: Callable) -> void:
	printerr("IWorldService.list_worlds_async: 纯虚函数必须由子类实现")

## 异步模式与槽位选择契约 (对齐 SELECT_MODE)
func select_mode_async(account_id: String, token: String, mode_id: int, account_slots: Array, callback: Callable) -> void:
	printerr("IWorldService.select_mode_async: 纯虚函数必须由子类实现")

## 异步选档/建档进入世界契约 (对齐 SELECT_OR_CREATE_WORLD)
func select_or_create_world_async(account_id: String, token: String, world_id: String, mode_id: int, callback: Callable) -> void:
	printerr("IWorldService.select_or_create_world_async: 纯虚函数必须由子类实现")

## 异步切换网关模式契约 (对齐 SWITCH_GATEWAY_MODE)
func switch_gateway_mode_async(account_id: String, token: String, target_mode: int, callback: Callable) -> void:
	printerr("IWorldService.switch_gateway_mode_async: 纯虚函数必须由子类实现")

## 异步退出世界退回网关契约 (对齐 EXIT_WORLD_TO_GATEWAY)
func exit_world_to_gateway_async(account_id: String, token: String, callback: Callable) -> void:
	printerr("IWorldService.exit_world_to_gateway_async: 纯虚函数必须由子类实现")
