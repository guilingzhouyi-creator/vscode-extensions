# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/frame_budget_dispatcher.gd
# 架构定位: Main Thread Slicing & Budget Dispatcher
# 依赖与触发: 上游: AuxiliaryWorkerPool, StorageMediator | 下游: GameConfig, EventBusCore
# 职责说明: 主线程切片预算调度器：严格按照配置的时间预算（默认 2.0ms/帧）向主线程
#           提交 GPU 资源创建、PackedScene 实例化与对象注册任务。当单帧耗时触达
#           预算阈值时，自动推迟剩余任务至后续循环，杜绝突发卡顿与丢帧。
# 退出语义与设计依据: 双域储存架构单帧切片预算提交规范
# ==============================================================================

## FrameBudgetDispatcher：Main Thread Slicing & Budget Dispatcher
class_name FrameBudgetDispatcher extends RefCounted

const MS_TO_USEC: float = 1000.0
const USEC_TO_MS: float = 1000.0

static var _instance: RefCounted = null

var _submission_queue: Array[Dictionary] = []

## 获取单例全局静态唯一实例
static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = FrameBudgetDispatcher.new()
	return _instance

func _init() -> void:
	_submission_queue = []

## 压入主线程切片执行任务
func enqueue_submission(action: Callable, priority: int = 1) -> void:
	if not action.is_valid():
		return
	var item := {
		"action": action,
		"priority": priority,
		"enqueued_at": Time.get_ticks_usec()
	}
	# 按优先级升序（数值小优先）插入
	var insert_index := 0
	while insert_index < _submission_queue.size() and _submission_queue[insert_index]["priority"] <= priority:
		insert_index += 1
	_submission_queue.insert(insert_index, item)

## 获取当前待执行任务总数
func get_pending_count() -> int:
	if _submission_queue.is_empty():
		return 0
	return _submission_queue.size()

var _clear_epoch: int = 0
static var _budget_config_cached: float = 2.0
static var _budget_config_version: int = -1

## 单帧预算切片执行
func pump_slice(budget_override_ms: float = -1.0) -> Dictionary:
	var max_budget: float = budget_override_ms
	if max_budget <= 0.0:
		var config_version: int = GameConfig.config_reload_version()
		if _budget_config_version != config_version:
			_budget_config_cached = GameConfig.get_float("infrastructure.storage", "auxiliary/frame_budget/max_ms_per_frame", 2.0)
			_budget_config_version = config_version
		max_budget = _budget_config_cached
	
	var budget_usec := int(max_budget * MS_TO_USEC)
	var start_ticks := Time.get_ticks_usec()
	var executed := 0
	var budget_exhausted := false
	var start_epoch: int = _clear_epoch
	var execution_index: int = 0
	var initial_count: int = _submission_queue.size()

	while execution_index < initial_count and execution_index < _submission_queue.size() and _clear_epoch == start_epoch:
		var now := Time.get_ticks_usec()
		var elapsed := now - start_ticks
		if elapsed >= budget_usec:
			budget_exhausted = true
			break

		var item: Dictionary = _submission_queue[execution_index]
		execution_index += 1
		var action: Callable = item["action"]
		if action.is_valid():
			action.call()
			executed += 1

	if _clear_epoch == start_epoch and execution_index > 0:
		if execution_index >= _submission_queue.size():
			_submission_queue.clear()
		else:
			_submission_queue = _submission_queue.slice(execution_index)

	var total_elapsed_ms := float(Time.get_ticks_usec() - start_ticks) / USEC_TO_MS

	return {
		"executed_count": executed,
		"elapsed_ms": total_elapsed_ms,
		"budget_exhausted": budget_exhausted,
		"remaining_count": _submission_queue.size()
	}

## 清理所有未执行队列
func clear() -> int:
	var count := _submission_queue.size()
	_submission_queue.clear()
	_clear_epoch += 1
	return count

## 测试重置
static func reset_for_tests() -> void:
	if _instance != null:
		_instance._submission_queue.clear()
	_instance = null
