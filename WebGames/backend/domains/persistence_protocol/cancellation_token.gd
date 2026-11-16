# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/cancellation_token.gd
# 架构定位: Concurrency & Task Control Utility
# 依赖与触发: 上游: ViewRouter, WorldGateway | 下游: AuxiliaryWorkerPool, FrameBudgetDispatcher
# 职责说明: 异步任务取消令牌：用于跨线程/跨帧通知异步加载任务废弃，
#           在场景切换、快速移动或视口滑动时阻断陈旧任务的继续处理与主线程提交。
# 退出语义与设计依据: 双域储存架构并发控制契约
# ==============================================================================

## CancellationToken：Concurrency & Task Control Utility
class_name CancellationToken extends PoolableDtoBase

var _is_cancelled: bool = false
var _callbacks: Array[Callable] = []

func _init() -> void:
	_is_cancelled = false
	_callbacks = []

## 判定当前令牌是否已取消
func is_cancelled() -> bool:
	return _is_cancelled

## 触发取消通知
func cancel() -> void:
	if _is_cancelled:
		return
	_is_cancelled = true
	var callbacks_snapshot := _callbacks.duplicate()
	_callbacks.clear()
	for callback in callbacks_snapshot:
		if callback.is_valid():
			callback.call()

## 注册取消回调
func register_callback(callback: Callable) -> void:
	if not callback.is_valid():
		return
	if _is_cancelled:
		callback.call()
		return
	_callbacks.append(callback)

## 重置令牌状态（复用契约）
func reset_state() -> void:
	super.reset_state()
	_is_cancelled = false
	_callbacks.clear()
