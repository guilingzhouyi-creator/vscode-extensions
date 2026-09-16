# ==============================================================================
# 模块归属: 业务领域层 (Domains · 通用业务集群 (General Domain))
# 文件路径: res://backend/domains/lifecycle/shutdown_resource_descriptor.gd
# 架构定位: Domain Logic Component
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/lifecycle.json | 信号: EventBus 领域广播
# 职责说明: 封装单项受控停机资源的释放优先级、超时保护与执行回调
# 设计依据: 业务域第一性原理 / Phase 01 施工细则规范
# ==============================================================================

class_name ShutdownResourceDescriptor
extends RefCounted

var resource_id: String = ""
var priority: int = 100
var timeout_ms: int = 2000
var is_critical: bool = true
var cleanup_action: Callable = Callable()

## 资源描述符构造（ID/优先级/关键性/回调/超时）
func _init(id: String = "", prio: int = 100, critical: bool = true, action: Callable = Callable(), timeout: int = 2000) -> void:
	resource_id = id
	priority = prio
	is_critical = critical
	cleanup_action = action
	timeout_ms = timeout

## 执行释放回调：无效 Callable 跳过；结果字典附加 resource_id
func execute_cleanup() -> Dictionary:
	if not cleanup_action.is_valid():
		return {"success": true, "skipped": true, "resource_id": resource_id}

	var res: Variant = cleanup_action.call()
	if res is Dictionary:
		var d: Dictionary = res
		d["resource_id"] = resource_id
		return d
	return {"success": true, "resource_id": resource_id}
