# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟世界/主页状态服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_world_service.gd
# 职责: 模拟主页 HUD 快照获取、小地图地标数据，严格遵循 P71 规范，经 MockBaseService 模拟网络延迟
# ==============================================================================
class_name MockWorldService
extends IWorldService

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms

func get_hud_snapshot_async(character_id: String, callback: Callable) -> void:
	var snapshot := MockDataCatalog.get_domain_data("hud_snapshot")
	MockBaseService.delayed_call(callback, { "success": true, "snapshot": snapshot.duplicate(true) }, simulate_delay_ms)

func get_map_landmarks_async(callback: Callable) -> void:
	var map_data := MockDataCatalog.get_domain_data("world_map")
	var landmarks: Array = map_data.get("landmarks", [])
	MockBaseService.delayed_call(callback, { "success": true, "landmarks": landmarks.duplicate(true) }, simulate_delay_ms)

func plan_routes(from_idx: int, to_idx: int) -> Array:
	if from_idx < 0 or to_idx < 0 or from_idx == to_idx:
		return []
	return [
		{"label": "A", "hours": 6, "danger_key": "ui.fe10.pf.danger_low", "cost": 50},
		{"label": "B", "hours": 4, "danger_key": "ui.fe10.pf.danger_mid", "cost": 80},
		{"label": "C", "hours": 3, "danger_key": "ui.fe10.pf.danger_high", "cost": 120},
	]

func upgrade_territory(territory: Dictionary) -> Dictionary:
	var updated: Dictionary = territory.duplicate(true)
	updated["construction"] = 1.0
	updated["garrison"] = int(updated.get("garrison", 0)) + 10
	return {"success": true, "territory": updated}