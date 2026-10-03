# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/cancellation_token.gd
# 架构定位: Concurrency & Task Control Utility
# 跨域依赖: 上游: ViewRouter, WorldGateway | 下游: AuxiliaryWorkerPool, FrameBudgetDispatcher
# 职责说明: 异步任务取消令牌：用于跨线程/跨帧通知异步加载任务废弃，
#           在场景切换、快速移动或视口滑动时阻断陈旧任务的继续处理与主线程提交。
# 设计依据: 双域储存架构并发控制契约
# ==============================================================================

class_name CancellationToken extends RefCounted

var _cancelled: bool = false
var _callbacks: Array[Callable] = []

func _init() -> void:
	_cancelled = false
	_callbacks = []

## 判定当前令牌是否已取消
func is_cancelled() -> bool:
	return _cancelled

## 触发取消通知
func cancel() -> void:
	if _cancelled:
		return
	_cancelled = true
	var cbs := _callbacks.duplicate()
	_callbacks.clear()
	for cb in cbs:
		if cb.is_valid():
			cb.call()

## 注册取消回调
func register_callback(cb: Callable) -> void:
	if not cb.is_valid():
		return
	if _cancelled:
		cb.call()
		return
	_callbacks.append(cb)

## 重置令牌状态（复用契约）
func reset_state() -> void:
	_cancelled = false
	_callbacks.clear()
