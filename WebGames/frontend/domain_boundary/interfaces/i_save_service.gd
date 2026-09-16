# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 系统存档服务契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_save_service.gd
# 职责: 规范回放帧推进/倍率切换/进度拖动与存档槽位写清接口
# ==============================================================================
class_name ISaveService
extends RefCounted

## 回放速度档位表（只读）
func get_replay_speeds() -> Array:
	printerr("ISaveService.get_replay_speeds: 纯虚函数必须由子类实现")
	return []

## 回放帧推进（钳制到 [0, total]）
func advance_replay(current: int, total: int, step: int) -> int:
	printerr("ISaveService.advance_replay: 纯虚函数必须由子类实现")
	return current

## 回放速度档位切换（direction: -1 减速 / +1 加速）
func change_replay_speed(current: float, direction: int) -> float:
	printerr("ISaveService.change_replay_speed: 纯虚函数必须由子类实现")
	return current

## 进度条比例 → 当前帧
func frame_from_ratio(ratio: float, total: int) -> int:
	printerr("ISaveService.frame_from_ratio: 纯虚函数必须由子类实现")
	return 0

## 写入槽位（返回新槽位副本）
func write_slot(slot: Dictionary, payload: Dictionary) -> Dictionary:
	printerr("ISaveService.write_slot: 纯虚函数必须由子类实现")
	return slot

## 清空槽位（返回新槽位副本）
func clear_slot(slot: Dictionary) -> Dictionary:
	printerr("ISaveService.clear_slot: 纯虚函数必须由子类实现")
	return slot
