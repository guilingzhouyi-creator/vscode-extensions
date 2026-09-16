# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 世界与主页状态服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_world_service.gd
# 职责: 规范主页 HUD 状态快照与世界环境数据接口，对齐 P71 规范
# ==============================================================================
class_name IWorldService
extends RefCounted

## 获取 HUD 权威状态快照 (对齐 P71 HudStatusSnapshotDTO)
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
