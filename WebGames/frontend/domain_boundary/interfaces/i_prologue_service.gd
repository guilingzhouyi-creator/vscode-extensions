# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Interfaces)
# 文件路径: res://frontend/domain_boundary/interfaces/i_prologue_service.gd
# 架构定位: Domain Boundary Interface / Prologue Story Contract
# 依赖与触发: 上游: ServiceContainer, 未来序章视图 | 下游: RealPrologueService, MockPrologueService
# 职责说明: 规范序章剧情启动、状态查询、阶段推进、跳过与完结交接大世界探索的标准交互接口。
# 退出语义与设计依据: 前端零业务逻辑契约与未接线接口预留规范
# ==============================================================================

## IPrologueService：创角序章剧情演进与大世界交接边界服务抽象接口
class_name IPrologueService
extends RefCounted

## 异步启动当前激活角色的序章上下文
func start_prologue_async(_account_id: String, _token: String, _payload: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IPrologueService.start_prologue_async: not implemented")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步只读查询当前序章阶段与文本快照
func get_prologue_state_async(_account_id: String, _token: String, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IPrologueService.get_prologue_state_async: not implemented")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步推进序章单步选择（choice_id -> 阶段演进与事件数据包）
func advance_prologue_async(_account_id: String, _token: String, _choice_id: String, _payload: Dictionary, callback: Callable) -> void:
	EventBusCore.get_instance().emit_log("error", "IPrologueService.advance_prologue_async: not implemented")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})

## 异步完结或跳过序章并触发大世界探索交接与首帧 HUD 同步
func complete_prologue_async(_account_id: String, _token: String, _cutscene_id: String = "", _skip: bool = false, callback: Callable = Callable()) -> void:
	EventBusCore.get_instance().emit_log("error", "IPrologueService.complete_prologue_async: not implemented")
	if callback.is_valid():
		callback.call({"success": false, "error_code": "NOT_IMPLEMENTED"})
