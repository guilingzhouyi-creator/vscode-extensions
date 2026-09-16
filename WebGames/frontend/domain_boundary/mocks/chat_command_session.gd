# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端数据桩: 聊天命令补全会话
# 文件路径: res://frontend/domain_boundary/mocks/chat_command_session.gd
# 职责: 组合命令索引与 Tab 手势判定，向上暴露无实现细节的会话接口
# 边界: 作为前端边界适配层，内部可复用后端确定性求解器
# ==============================================================================
class_name ChatCommandSession
extends IChatCommandSession

var _command_index: GmCommandIndexSolver = GmCommandIndexSolver.new()
var _tab_detector: TabDoubleTapDetector = TabDoubleTapDetector.new()

func reset_cursor() -> void:
	_command_index.reset_cursor()

func query(prefix: String) -> Dictionary:
	return _command_index.query(prefix)

func next_page(prefix: String) -> Dictionary:
	return _command_index.next_page(prefix)

func prev_page(prefix: String) -> Dictionary:
	return _command_index.prev_page(prefix)

func apply_recent_completion(prefix: String) -> Dictionary:
	return _command_index.apply_recent_completion(prefix)

func record_usage(command_name: String) -> void:
	_command_index.record_usage(command_name)

func reset_gesture() -> void:
	_tab_detector.reset()

func feed_gesture(key_code: String, timestamp_msec: int) -> Dictionary:
	return _tab_detector.feed_key_press(key_code, timestamp_msec)
