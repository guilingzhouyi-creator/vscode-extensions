# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_save_service.gd
# 架构定位: Domain Boundary Adapter / Real Save & Replay Service Bridge
# 依赖与触发: 上游: SystemSaveView, ServiceContainer, ServiceLocator | 下游: GameConfig
# 职责说明: 实现 ISaveService 接口，基于确定性回放配置与槽位契约管理回放倍速、帧推进与槽位读写。
# 退出语义与设计依据: 表现层零存档状态直接突变与配置驱动回放契约
# ==============================================================================

## RealSaveService：管理存档槽位写清与确定性回放控制计算的真实存档服务
class_name RealSaveService
extends "res://frontend/domain_boundary/interfaces/i_save_service.gd"

const DEFAULT_REPLAY_SPEEDS: Array[float] = [0.5, 1.0, 2.0, 4.0]

## 返回配置声明或默认的回放倍速档位数组
func get_replay_speeds() -> Array:
	var configured_speeds: Array = GameConfig.get_array("domains.deterministic", "replay_defaults/speed_presets", DEFAULT_REPLAY_SPEEDS)
	return configured_speeds.duplicate() if not configured_speeds.is_empty() else DEFAULT_REPLAY_SPEEDS.duplicate()

## 将当前回放帧按步长推进并安全钳制在 [0, total_frames]
func advance_replay(current_frame: int, total_frames: int, frame_step: int) -> int:
	return clampi(current_frame + frame_step, 0, maxi(0, total_frames))

## 在可用倍速档位表内向上或向下切换倍速档位
func change_replay_speed(current_speed: float, direction: int) -> float:
	var available_speeds: Array = get_replay_speeds()
	var matched_index: int = 0
	var smallest_gap: float = INF
	for speed_index in range(available_speeds.size()):
		var distance_gap: float = absf(float(available_speeds[speed_index]) - current_speed)
		if distance_gap < smallest_gap:
			smallest_gap = distance_gap
			matched_index = speed_index
	var target_index: int = clampi(matched_index + clampi(direction, -1, 1), 0, available_speeds.size() - 1)
	return float(available_speeds[target_index])

## 将 [0.0, 1.0] 进度条比例映射为整数回放帧位置
func frame_from_ratio(progress_ratio: float, total_frames: int) -> int:
	return int(round(clampf(progress_ratio, 0.0, 1.0) * float(maxi(0, total_frames))))

## 写入存档槽位元数据并返回不可变新副本
func write_slot(slot_record: Dictionary, slot_payload: Dictionary) -> Dictionary:
	var next_record: Dictionary = slot_record.duplicate(true)
	next_record.merge(slot_payload, true)
	next_record["empty"] = false
	if str(next_record.get("save_date", "")).is_empty():
		next_record["save_date"] = Time.get_datetime_string_from_system(false, true)
	return next_record

## 清空存档槽位占用标记与角色摘要并返回不可变新副本
func clear_slot(slot_record: Dictionary) -> Dictionary:
	var cleared_record: Dictionary = slot_record.duplicate(true)
	cleared_record["empty"] = true
	cleared_record["char_name"] = ""
	cleared_record["save_date"] = ""
	cleared_record["playtime"] = ""
	cleared_record["location"] = ""
	return cleared_record
