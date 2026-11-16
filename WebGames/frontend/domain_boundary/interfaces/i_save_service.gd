# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_save_service.gd
# 架构定位: Domain Boundary Interface / Save & Replay Service Contract
# 依赖与触发: 上游: 存档管理与确定性回放视图, ServiceContainer | 下游: MockSaveService
# 职责说明: 规范回放帧推进、倍率切换、进度比例映射及存档槽位写入与清空边界接口。
# 退出语义与设计依据: 表现层零存档持久化写逻辑与领域边界解耦契约
# ==============================================================================

## ISaveService：系统存档槽位与回放控制边界服务抽象接口
class_name ISaveService
extends RefCounted

## 回放速度档位表（只读）
func get_replay_speeds() -> Array:
	EventBusCore.get_instance().emit_log("error", "ISaveService.get_replay_speeds: pure virtual method must be implemented by subclass")
	return []

## 回放帧推进（钳制到 [0, total_frames]）
func advance_replay(current_frame: int, _total_frames: int, _frame_step: int) -> int:
	EventBusCore.get_instance().emit_log("error", "ISaveService.advance_replay: pure virtual method must be implemented by subclass")
	return current_frame

## 回放速度档位切换（direction: -1 减速 / +1 加速）
func change_replay_speed(current_speed: float, _direction: int) -> float:
	EventBusCore.get_instance().emit_log("error", "ISaveService.change_replay_speed: pure virtual method must be implemented by subclass")
	return current_speed

## 进度条比例 → 当前帧
func frame_from_ratio(_progress_ratio: float, _total_frames: int) -> int:
	EventBusCore.get_instance().emit_log("error", "ISaveService.frame_from_ratio: pure virtual method must be implemented by subclass")
	return 0

## 写入槽位（返回新槽位副本）
func write_slot(slot_record: Dictionary, _slot_payload: Dictionary) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "ISaveService.write_slot: pure virtual method must be implemented by subclass")
	return slot_record

## 清空槽位（返回新槽位副本）
func clear_slot(slot_record: Dictionary) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "ISaveService.clear_slot: pure virtual method must be implemented by subclass")
	return slot_record

## 分发存档写入、导出、云同步与兑换码核销协议动作（默认兼容回执）
func dispatch_save_action(action_type: String, payload_data: Dictionary = {}) -> Dictionary:
	return {"success": true, "action": action_type, "payload": payload_data}
