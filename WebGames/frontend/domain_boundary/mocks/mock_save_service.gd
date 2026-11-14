# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_save_service.gd
# 架构定位: Domain Boundary Mock / Simulated Save & Replay Service
# 依赖与触发: 上游: MockServiceContainer, 存档与回放视图 | 下游: 无（纯逻辑模拟）
# 职责说明: 提供模拟回放帧推进、倍率切换、进度比例映射与存档槽位写入/清空逻辑。
# 退出语义与设计依据: 表现层零存档写逻辑与不可变槽位副本返回契约
# ==============================================================================

## MockSaveService：系统存档槽位与回放控制模拟服务
class_name MockSaveService
extends ISaveService

const REPLAY_SPEEDS: Array[float] = [0.25, 0.5, 1.0, 2.0, 4.0, 8.0]

## 返回只读的回放倍速档位列表副本
func get_replay_speeds() -> Array:
	return REPLAY_SPEEDS.duplicate()

## 按给定步长推进回放帧号并安全钳制到 [0, total] 区间
func advance_replay(current: int, total: int, step: int) -> int:
	return clampi(current + step, 0, maxi(0, total))

## 根据当前倍速与步进方向（-1/1）切换上一档或下一档回放速度
func change_replay_speed(current: float, direction: int) -> float:
	var current_index := REPLAY_SPEEDS.find(current)
	if current_index < 0:
		return current
	return REPLAY_SPEEDS[clampi(current_index + direction, 0, REPLAY_SPEEDS.size() - 1)]

## 将 [0.0, 1.0] 归一化进度条比例映射为离散帧序号
func frame_from_ratio(ratio: float, total: int) -> int:
	return int(clampf(ratio, 0.0, 1.0) * float(maxi(0, total)))

## 将角色元数据写入目标存档槽位副本并标记为非空
func write_slot(slot: Dictionary, payload: Dictionary) -> Dictionary:
	var updated: Dictionary = slot.duplicate(true)
	updated["empty"] = false
	updated["char_name_key"] = str(payload.get("char_name_key", "ui.fe16.mock.char.artoria"))
	updated["level"] = int(payload.get("level", 45))
	updated["playtime_sec"] = int(payload.get("playtime_sec", 86400))
	updated["save_date"] = str(payload.get("save_date", "2026-09-01 00:00"))
	return updated

## 清空目标存档槽位副本并重置等级与时长字段
func clear_slot(slot: Dictionary) -> Dictionary:
	var updated: Dictionary = slot.duplicate(true)
	updated["empty"] = true
	updated["char_name"] = ""
	updated["level"] = 0
	updated["playtime_sec"] = 0
	updated["save_date"] = ""
	return updated
