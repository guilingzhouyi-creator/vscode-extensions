# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/chat_command_session.gd
# 架构定位: Domain Boundary Adapter / Chat Command Session Implementation
# 依赖与触发: 上游: MockChatCommandService, 聊天视图 | 下游: GmCommandIndexSolver, TabDoubleTapDetector
# 职责说明: 组合命令索引与 Tab 手势判定，向上暴露无实现细节的模拟会话实例。
# 退出语义与设计依据: 跨视图命令状态隔离与模拟服务可替换契约
# ==============================================================================

## ChatCommandSession：聊天命令补全与 Tab 手势判定会话适配器
class_name ChatCommandSession
extends IChatCommandSession

var _command_index: GmCommandIndexSolver = GmCommandIndexSolver.new()
var _tab_detector: TabDoubleTapDetector = TabDoubleTapDetector.new()

## 重置命令分页游标至首页
func reset_cursor() -> void:
	_command_index.reset_cursor()

## 按前缀查询命令补全结果并返回首页分页视图
func query(prefix: String) -> Dictionary:
	return _command_index.query(prefix)

## 翻至命令补全列表的下一页
func next_page(prefix: String) -> Dictionary:
	return _command_index.next_page(prefix)

## 翻至命令补全列表的上一页
func prev_page(prefix: String) -> Dictionary:
	return _command_index.prev_page(prefix)

## 应用最近使用的匹配命令执行快速补全
func apply_recent_completion(prefix: String) -> Dictionary:
	return _command_index.apply_recent_completion(prefix)

## 记录最近使用过的命令以更新历史权重窗口
func record_usage(command_name: String) -> void:
	_command_index.record_usage(command_name)

## 重置 Tab 双击手势检测状态机
func reset_gesture() -> void:
	_tab_detector.reset()

## 输入按键码与毫秒时间戳，判定单次或双击 Tab 补全手势
func feed_gesture(key_code: String, timestamp_milliseconds: int) -> Dictionary:
	return _tab_detector.feed_key_press(key_code, timestamp_milliseconds)
