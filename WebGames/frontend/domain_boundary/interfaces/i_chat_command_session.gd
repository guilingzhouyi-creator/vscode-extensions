# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端领域边界: 聊天命令补全会话契约
# 文件路径: res://frontend/domain_boundary/interfaces/i_chat_command_session.gd
# 职责: 规范命令前缀查询、分页、最近使用补全与 Tab 手势判定接口
# ==============================================================================
class_name IChatCommandSession
extends RefCounted

## 重置分页游标
func reset_cursor() -> void:
	printerr("IChatCommandSession.reset_cursor: 纯虚函数必须由子类实现")

## 按前缀查询首页（返回 entries / page_index / total_pages）
func query(prefix: String) -> Dictionary:
	printerr("IChatCommandSession.query: 纯虚函数必须由子类实现")
	return {}

## 下一页
func next_page(prefix: String) -> Dictionary:
	printerr("IChatCommandSession.next_page: 纯虚函数必须由子类实现")
	return {}

## 上一页
func prev_page(prefix: String) -> Dictionary:
	printerr("IChatCommandSession.prev_page: 纯虚函数必须由子类实现")
	return {}

## 最近使用补全（返回 success / command）
func apply_recent_completion(prefix: String) -> Dictionary:
	printerr("IChatCommandSession.apply_recent_completion: 纯虚函数必须由子类实现")
	return {}

## 记录命令使用（最近窗口）
func record_usage(command_name: String) -> void:
	printerr("IChatCommandSession.record_usage: 纯虚函数必须由子类实现")

## 重置 Tab 手势判定
func reset_gesture() -> void:
	printerr("IChatCommandSession.reset_gesture: 纯虚函数必须由子类实现")

## Tab 手势判定（返回 is_tab / is_single_tap / is_double_tap）
func feed_gesture(key_code: String, timestamp_msec: int) -> Dictionary:
	printerr("IChatCommandSession.feed_gesture: 纯虚函数必须由子类实现")
	return {}
