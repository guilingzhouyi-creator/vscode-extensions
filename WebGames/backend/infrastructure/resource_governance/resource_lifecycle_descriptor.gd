# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Resource Governance)
# 文件路径: res://backend/infrastructure/resource_governance/resource_lifecycle_descriptor.gd
# 架构定位: Memory Governor / Bounded Cache
# 依赖与触发: 上游: GameBootstrap, ViewRouter, 资源消费方 | 下游: BoundedResourceCache, CachePolicySpec | 配置: config/infrastructure/resource.json | 信号: 缓存淘汰 / 内存预警事件
# 职责说明: 资源生命周期状态描述符：记录资源的加载阶段（UNLOADED/LOADING/READY/DIRTY/EVICTED）、引用计数与最后访问时间戳。
# 退出语义与设计依据: 有界资源与内存生命周期治理标准
# ==============================================================================

## ResourceLifecycleDescriptor：Memory Governor / Bounded Cache
class_name ResourceLifecycleDescriptor extends RefCounted

## 资源生命周期六阶段标准
enum LifecycleState {
	UNINITIALIZED = 0, # 已分配，未完成初始化
	INITIALIZED = 1,   # 初始化就绪
	IN_USE = 2,        # 正在被业务持有并使用
	IDLE = 3,          # 闲置态（等待复用或等待延迟释放）
	RELEASED = 4,      # 已解除业务引用与事件监听
	DISPOSED = 5       # 物理销毁（已调用 .free() / 关闭句柄）
}

## 资源分类标识
enum ResourceCategory {
	UI_CONTROL_NODE,       # 非 RefCounted UI 节点控件
	FILE_IO_HANDLE,        # 文件读写句柄与临时流
	EVENT_SUBSCRIPTION,    # EventBus 信号回调与闭包
	DATA_CACHE_COLLECTION, # 内存字典、哈希表与静态缓存
	TIMER_COROUTINE,       # 定时器、异步任务与 Tick 调度
	CUSTOM_OBJECT          # 其他通用非 RefCounted 对象
}

## 核心属性元数据
var resource_id: String = ""
var target_category: ResourceCategory = ResourceCategory.CUSTOM_OBJECT
var current_state: LifecycleState = LifecycleState.UNINITIALIZED
var owner_name: String = ""
var created_timestamp: float = 0.0
var last_transition_timestamp: float = 0.0

## 弱引用底层实例指针，防止描述符自身阻止垃圾回收
var _weak_target: WeakRef = null

func _init(
	initial_resource_id: String = "",
	target_object: Object = null,
	initial_category: ResourceCategory = ResourceCategory.CUSTOM_OBJECT,
	initial_owner_name: String = ""
) -> void:
	resource_id = initial_resource_id
	target_category = initial_category
	owner_name = initial_owner_name
	created_timestamp = Time.get_unix_time_from_system()
	last_transition_timestamp = created_timestamp
	if target_object != null:
		# 使用弱引用持有目标实例，防止生命周期描述符自身阻止垃圾回收
		_weak_target = weakref(target_object)

## 获取底层实例（若已被物理回收则返回 null）
func get_target_instance() -> Object:
	if _weak_target != null:
		return _weak_target.get_ref()
	return null

## 判定实例是否仍然存活
func is_alive() -> bool:
	var target: Object = get_target_instance()
	return target != null and is_instance_valid(target)

## 推进状态机单向流转（严格单向校验，防止逆流与非法跳跃）
func transition_to(next_state: LifecycleState) -> bool:
	if current_state == LifecycleState.DISPOSED:
		return false # 已销毁状态不可再转移

	var is_valid: bool = false
	match next_state:
		LifecycleState.INITIALIZED:
			is_valid = (current_state == LifecycleState.UNINITIALIZED)
		LifecycleState.IN_USE:
			is_valid = (current_state == LifecycleState.INITIALIZED or current_state == LifecycleState.IDLE)
		LifecycleState.IDLE:
			is_valid = (current_state == LifecycleState.IN_USE)
		LifecycleState.RELEASED:
			is_valid = (current_state == LifecycleState.IN_USE or current_state == LifecycleState.IDLE or current_state == LifecycleState.INITIALIZED)
		LifecycleState.DISPOSED:
			is_valid = (current_state == LifecycleState.RELEASED or current_state == LifecycleState.UNINITIALIZED or current_state == LifecycleState.INITIALIZED)
		_:
			is_valid = false

	if is_valid:
		current_state = next_state
		last_transition_timestamp = Time.get_unix_time_from_system()
		return true
	return false

## 标记直接进入销毁态
func mark_disposed() -> void:
	current_state = LifecycleState.DISPOSED
	last_transition_timestamp = Time.get_unix_time_from_system()
	_weak_target = null

## 导出为结构化字典
func to_dict() -> Dictionary:
	return {
		"resource_id": resource_id,
		"category": target_category,
		"state": current_state,
		"owner": owner_name,
		"created_at": created_timestamp,
		"last_transition_at": last_transition_timestamp,
		"is_alive": is_alive()
	}

## 从字典恢复描述符
static func from_dict(descriptor_payload: Dictionary) -> RefCounted:
	var descriptor := ResourceLifecycleDescriptor.new(
		str(descriptor_payload.get("resource_id", "")),
		null,
		int(descriptor_payload.get("category", ResourceCategory.CUSTOM_OBJECT)) as ResourceCategory,
		str(descriptor_payload.get("owner", ""))
	)
	descriptor.current_state = int(descriptor_payload.get("state", LifecycleState.UNINITIALIZED)) as LifecycleState
	descriptor.created_timestamp = float(descriptor_payload.get("created_at", 0.0))
	descriptor.last_transition_timestamp = float(descriptor_payload.get("last_transition_at", descriptor.created_timestamp))
	return descriptor
