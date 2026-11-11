# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 聊天命令补全会话契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_chat_command_session.gd
# 职责: 规范命令前缀查询、分页、最近使用补全与 Tab 手势判定接口
# ==============================================================================
class_name IChatCommandSession
extends RefCounted

## 重置分页游标
func reset_cursor() -> void:
	EventBusCore.get_instance().emit_log("error", "IChatCommandSession.reset_cursor: pure virtual method must be implemented by subclass")

## 按前缀查询首页（返回 entries / page_index / total_pages）
func query(prefix: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IChatCommandSession.query: pure virtual method must be implemented by subclass")
	return {}

## 下一页
func next_page(prefix: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IChatCommandSession.next_page: pure virtual method must be implemented by subclass")
	return {}

## 上一页
func prev_page(prefix: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IChatCommandSession.prev_page: pure virtual method must be implemented by subclass")
	return {}

## 最近使用补全（返回 success / command）
func apply_recent_completion(prefix: String) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IChatCommandSession.apply_recent_completion: pure virtual method must be implemented by subclass")
	return {}

## 记录命令使用（最近窗口）
func record_usage(command_name: String) -> void:
	EventBusCore.get_instance().emit_log("error", "IChatCommandSession.record_usage: pure virtual method must be implemented by subclass")

## 重置 Tab 手势判定
func reset_gesture() -> void:
	EventBusCore.get_instance().emit_log("error", "IChatCommandSession.reset_gesture: pure virtual method must be implemented by subclass")

## Tab 手势判定（返回 is_tab / is_single_tap / is_double_tap）
func feed_gesture(key_code: String, timestamp_msec: int) -> Dictionary:
	EventBusCore.get_instance().emit_log("error", "IChatCommandSession.feed_gesture: pure virtual method must be implemented by subclass")
	return {}
