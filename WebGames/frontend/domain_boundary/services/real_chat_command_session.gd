# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Services)
# 文件路径: res://frontend/domain_boundary/services/real_chat_command_session.gd
# 架构定位: Domain Boundary Adapter / Real Chat Command Session
# 依赖与触发: 上游: RealChatCommandService, 聊天视图 | 下游: GmCommandIndexSolver, TabDoubleTapDetector
# 职责说明: 实现 IChatCommandSession，封装后端命令索引与双击 Tab 检测，隔离视图输入状态。
# 退出语义与设计依据: 跨视图命令状态隔离与后端索引求解器唯一真源契约
# ==============================================================================

## RealChatCommandSession：直连后端命令索引与手势检测的聊天命令会话
class_name RealChatCommandSession
extends "res://frontend/domain_boundary/interfaces/i_chat_command_session.gd"

var _solver: GmCommandIndexSolver = GmCommandIndexSolver.new()
var _gesture_detector: TabDoubleTapDetector = TabDoubleTapDetector.new()

func _page_action(prefix_text: String, direction_step: int) -> Dictionary:
	var trimmed_prefix: String = prefix_text.strip_edges()
	if direction_step < 0:
		return _solver.prev_page(trimmed_prefix)
	if direction_step > 0:
		return _solver.next_page(trimmed_prefix)
	return _solver.query(trimmed_prefix)

## 重置分页游标至初始页
func reset_cursor() -> void:
	_solver.reset_cursor()

## 按前缀检索首页候选命令
func query(prefix: String) -> Dictionary:
	return _page_action(prefix, 0)

## 向后翻页查询候选命令
func next_page(prefix: String) -> Dictionary:
	return _page_action(prefix, 1)

## 向前翻页查询候选命令
func prev_page(prefix: String) -> Dictionary:
	return _page_action(prefix, -1)

## 应用最近高频命中的命令补全
func apply_recent_completion(prefix: String) -> Dictionary:
	return _solver.apply_recent_completion(prefix.strip_edges())

## 记录有效命令使用历史
func record_usage(command_name: String) -> void:
	var sanitized_command: String = command_name.strip_edges()
	if not sanitized_command.is_empty():
		_solver.record_usage(sanitized_command)

## 重置双击手势检测状态
func reset_gesture() -> void:
	_gesture_detector.reset()

## 送入按键与毫秒时间点完成单击/双击 Tab 识别
func feed_gesture(key_code: String, timestamp_milliseconds: int) -> Dictionary:
	return _gesture_detector.feed_key_press(key_code, timestamp_milliseconds)
