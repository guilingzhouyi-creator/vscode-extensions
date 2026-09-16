# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Resource Governance)
# 文件路径: res://backend/infrastructure/resource_governance/resource_lifecycle_manager.gd
# 架构定位: Memory Governor / Bounded Cache
# 跨域依赖: 上游: GameBootstrap, ViewRouter, 资源消费方 | 下游: BoundedResourceCache, CachePolicySpec | 配置: config/infrastructure/resource.json | 信号: 缓存淘汰 / 内存预警事件
# 职责说明: 全域资源生命周期中心治理器：负责跨场景资源预加载、按需引用计数管理、异步流式解构与峰值内存主动 GC 协同触发。
# 设计依据: Phase 56 有界资源与内存生命周期治理标准
# ==============================================================================

class_name ResourceLifecycleManager extends RefCounted

const ResourceLifecycleDescriptor = preload("res://backend/infrastructure/resource_governance/resource_lifecycle_descriptor.gd")

## 已注册资源映射表: resource_id -> ResourceLifecycleDescriptor
var _tracked_resources: Dictionary = {}

## 注册非 RefCounted 对象进入生命周期治理
func track_resource(
	p_res_id: String,
	p_target: Object,
	p_category: ResourceLifecycleDescriptor.ResourceCategory = ResourceLifecycleDescriptor.ResourceCategory.CUSTOM_OBJECT,
	p_owner_name: String = ""
) -> ResourceLifecycleDescriptor:
	if p_res_id.is_empty() or p_target == null:
		return null
	if _tracked_resources.has(p_res_id):
		return _tracked_resources[p_res_id] as ResourceLifecycleDescriptor
	
	var desc := ResourceLifecycleDescriptor.new(p_res_id, p_target, p_category, p_owner_name)
	desc.transition_to(ResourceLifecycleDescriptor.LifecycleState.INITIALIZED)
	_tracked_resources[p_res_id] = desc
	return desc

## 获取指定资源的描述符
func get_descriptor(p_res_id: String) -> ResourceLifecycleDescriptor:
	if _tracked_resources.has(p_res_id):
		return _tracked_resources[p_res_id] as ResourceLifecycleDescriptor
	return null

## 标记资源使用开始
func mark_in_use(p_res_id: String) -> bool:
	if not _tracked_resources.has(p_res_id):
		return false
	var desc: ResourceLifecycleDescriptor = _tracked_resources[p_res_id]
	return desc.transition_to(ResourceLifecycleDescriptor.LifecycleState.IN_USE)

## 标记资源进入闲置
func mark_idle(p_res_id: String) -> bool:
	if not _tracked_resources.has(p_res_id):
		return false
	var desc: ResourceLifecycleDescriptor = _tracked_resources[p_res_id]
	return desc.transition_to(ResourceLifecycleDescriptor.LifecycleState.IDLE)

## 安全释放并物理销毁资源
func dispose_resource(p_res_id: String) -> bool:
	if not _tracked_resources.has(p_res_id):
		return false
	var desc: ResourceLifecycleDescriptor = _tracked_resources[p_res_id]
	_tracked_resources.erase(p_res_id)
	
	# 先转移至 RELEASED
	desc.transition_to(ResourceLifecycleDescriptor.LifecycleState.RELEASED)
	
	# 执行物理资源回收，双重校验防 Double Free
	var target: Object = desc.get_target_instance()
	if target != null and is_instance_valid(target):
		if target is Node:
			var node: Node = target as Node
			if node.get_parent() != null:
				node.get_parent().remove_child(node)
			node.free()
		elif not (target is RefCounted):
			target.free()
	
	desc.mark_disposed()
	return true

## 全量清理所有受控资源（退出、场景切换或测试重置时调用）
func dispose_all() -> int:
	var freed_count: int = 0
	var keys: Array = _tracked_resources.keys()
	for key in keys:
		if dispose_resource(str(key)):
			freed_count += 1
	_tracked_resources.clear()
	return freed_count

## 获取当前存活且受控的资源统计字典
func get_live_metrics() -> Dictionary:
	var active_nodes: int = 0
	var active_others: int = 0
	for res_id in _tracked_resources:
		var desc: ResourceLifecycleDescriptor = _tracked_resources[res_id]
		if desc.target_category == ResourceLifecycleDescriptor.ResourceCategory.UI_CONTROL_NODE:
			active_nodes += 1
		else:
			active_others += 1
	return {
		"total_tracked": _tracked_resources.size(),
		"active_ui_nodes": active_nodes,
		"active_other_resources": active_others
	}
