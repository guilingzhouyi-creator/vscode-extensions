# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 模拟系统存档服务
# 文件路径: res://frontend/domain_boundary/mocks/mock_save_service.gd
# 职责: 回放帧/倍率/进度规则与存档槽位写清（视图只做状态同步与渲染）
# ==============================================================================
class_name MockSaveService
extends ISaveService

const REPLAY_SPEEDS: Array[float] = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0]

func get_replay_speeds() -> Array:
	return REPLAY_SPEEDS.duplicate()

func advance_replay(current: int, total: int, step: int) -> int:
	return clampi(current + step, 0, maxi(0, total))

func change_replay_speed(current: float, direction: int) -> float:
	var idx := REPLAY_SPEEDS.find(current)
	if idx < 0:
		return current
	return REPLAY_SPEEDS[clampi(idx + direction, 0, REPLAY_SPEEDS.size() - 1)]

func frame_from_ratio(ratio: float, total: int) -> int:
	return int(clampf(ratio, 0.0, 1.0) * float(maxi(0, total)))

func write_slot(slot: Dictionary, payload: Dictionary) -> Dictionary:
	var updated: Dictionary = slot.duplicate(true)
	updated["empty"] = false
	updated["char_name_key"] = str(payload.get("char_name_key", "ui.fe16.mock.char.artoria"))
	updated["level"] = int(payload.get("level", 45))
	updated["playtime_sec"] = int(payload.get("playtime_sec", 86400))
	updated["save_date"] = str(payload.get("save_date", "2026-09-01 00:00"))
	return updated

func clear_slot(slot: Dictionary) -> Dictionary:
	var updated: Dictionary = slot.duplicate(true)
	updated["empty"] = true
	updated["char_name"] = ""
	updated["level"] = 0
	updated["playtime_sec"] = 0
	updated["save_date"] = ""
	return updated
