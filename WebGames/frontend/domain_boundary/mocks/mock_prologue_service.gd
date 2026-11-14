# ==============================================================================
# 模块归属: 前端领域边界层 (Frontend · Domain Boundary Mocks)
# 文件路径: res://frontend/domain_boundary/mocks/mock_prologue_service.gd
# 架构定位: Domain Boundary Mock / Simulated Prologue Story Service
# 依赖与触发: 上游: ServiceContainer, 未来序章视图 | 下游: MockBaseService
# 职责说明: 提供无头可证伪的 4 阶段序章启动、推进、跳过与探索交接模拟服务实现。
# 退出语义与设计依据: 领域边界前后同构测试隔离契约
# ==============================================================================

## MockPrologueService：序章剧情阶段推进与探索交接模拟服务
class_name MockPrologueService
extends "res://frontend/domain_boundary/interfaces/i_prologue_service.gd"

var simulate_delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS
var _stage: int = 1
var _completed: bool = false

func _init(delay_ms: int = MockBaseService.DEFAULT_SIMULATE_DELAY_MS) -> void:
	simulate_delay_ms = delay_ms

## 模拟异步初始化序章进度至第 1 阶段并重置完结标志
func start_prologue_async(_account_id: String, _token: String, _payload: Dictionary, callback: Callable) -> void:
	_stage = 1
	_completed = false
	MockBaseService.delayed_call(callback, {"success": true, "data": {"current_stage": 1, "is_completed": false}}, simulate_delay_ms)

## 模拟异步查询当前序章阶段号与完结状态
func get_prologue_state_async(_account_id: String, _token: String, callback: Callable) -> void:
	MockBaseService.delayed_call(callback, {"success": true, "data": {"current_stage": _stage, "is_completed": _completed}}, simulate_delay_ms)

## 模拟异步推进单步序章阶段并在抵达第 4 阶段时标记完结
func advance_prologue_async(_account_id: String, _token: String, _choice_id: String, _payload: Dictionary, callback: Callable) -> void:
	_stage = mini(4, _stage + 1)
	_completed = (_stage >= 4)
	MockBaseService.delayed_call(callback, {"success": true, "data": {"current_stage": _stage, "is_completed": _completed}}, simulate_delay_ms)

## 模拟异步直接完结或跳过序章并输出空交接快照载荷
func complete_prologue_async(_account_id: String, _token: String, _cutscene_id: String = "", _skip: bool = false, callback: Callable = Callable()) -> void:
	_stage = 4
	_completed = true
	MockBaseService.delayed_call(callback, {"success": true, "data": {"completed": true, "handoff": {}, "initial_hud_snapshot": {}}}, simulate_delay_ms)
