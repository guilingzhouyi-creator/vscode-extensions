# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/shutdown_resource_descriptor.gd
# 架构定位: Domain Logic Component
# 依赖与触发: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 封装单项受控停机资源的释放优先级、超时保护与执行回调
# 退出语义与设计依据: 业务领域第一性原理与卡拉尔架构解耦契约
# ==============================================================================

## ShutdownResourceDescriptor：Domain Logic Component
class_name ShutdownResourceDescriptor
extends RefCounted

var resource_id: String = ""
var priority: int = 0
var timeout_ms: int = 2000
var is_critical: bool = false
var cleanup_action: Callable = Callable()

## 资源描述符构造（注册时由 lifecycle 配置覆盖策略字段）
func _init(initial_resource_id: String = "", initial_priority: int = 100, initial_is_critical: bool = true, initial_cleanup_action: Callable = Callable()) -> void:
	resource_id = initial_resource_id
	priority = initial_priority
	is_critical = initial_is_critical
	cleanup_action = initial_cleanup_action

## 执行释放回调：无效回调或非 Dictionary 结果均按失败处理
func execute_cleanup() -> Dictionary:
	if not cleanup_action.is_valid():
		return {"success": false, "error_code": "INVALID_CLEANUP_CALLABLE", "resource_id": resource_id}

	var cleanup_payload: Variant = cleanup_action.call()
	if not cleanup_payload is Dictionary:
		return {"success": false, "error_code": "INVALID_CLEANUP_RESULT", "resource_id": resource_id}
	var normalized_result: Dictionary = (cleanup_payload as Dictionary).duplicate()
	normalized_result["resource_id"] = resource_id
	return normalized_result
