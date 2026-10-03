# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/targeted_hot_reloader.gd
# 架构定位: Targeted Incremental Hot Reloader
# 跨域依赖: 上游: GameConfig, VersionGovernance | 下游: ResourceDependencyDAG, AuxiliaryWorkerPool, EventBusCore
# 职责说明: 定向增量热重载器：当某项配置、文案或资源发生变更时，依据资源依赖 DAG
#           精准计算受影响的失效子图，仅定向重载相关节点；加载失败时安全回退旧缓存，
#           杜绝因局部更新而粗暴重启整个存储或配置系统。
# 设计依据: 双域储存架构定向热更与容错回滚规范
# ==============================================================================

class_name TargetedHotReloader extends RefCounted

const ResourceDependencyDAG = preload("res://backend/domains/persistence_protocol/resource_dependency_dag.gd")

const ERR_EMPTY_NODE: String = "EMPTY_NODE"
const LOG_LEVEL_WARN: String = "warn"
const LOG_LEVEL_INFO: String = "info"
const LOG_RELOAD_FAIL: String = "TargetedHotReloader: 节点 %s 重载失败，执行安全回滚保留旧缓存"
const LOG_RELOAD_SUCCESS: String = "TargetedHotReloader: 节点 %s 定向热重载成功，共刷新 %d 个关联节点"

static var _instance = null

var _dag: ResourceDependencyDAG = null
var _cache_store: Dictionary = {} # node_id -> Variant (最新有效缓存备份)

static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = new()
	return _instance

func _init() -> void:
	_dag = ResourceDependencyDAG.new()
	_cache_store = {}

## 获取内置依赖 DAG 引用
func get_dag() -> ResourceDependencyDAG:
	return _dag

## 设置某个节点的已知缓存备份（用于失败回退）
func set_cached_backup(node_id: String, data: Variant) -> void:
	if not node_id.is_empty():
		_cache_store[node_id] = data

## 获取指定节点的有效备份
func get_cached_backup(node_id: String) -> Variant:
	return _cache_store.get(node_id, null)

## 触发定向增量热重载
## changed_node: 发生物理变动的根源节点标识
## reload_resolver: Callable(node_id: String) -> Dictionary {"success": bool, "data": Variant}
func trigger_reload(changed_node: String, reload_resolver: Callable = Callable()) -> Dictionary:
	if changed_node.is_empty():
		return {"success": false, "affected_nodes": [], "reloaded_count": 0, "error": ERR_EMPTY_NODE}

	# 1. 依据 DAG 计算失效影响范围
	var invalidation_list: Array[String] = _dag.get_invalidation_subgraph(changed_node)
	var reloaded_count := 0
	var rollback_performed := false
	var failed_node := ""

	# 2. 依次定向重载失效节点
	for node in invalidation_list:
		if reload_resolver.is_valid():
			var step_res: Dictionary = reload_resolver.call(node)
			if not bool(step_res.get("success", false)):
				failed_node = node
				rollback_performed = true
				EventBusCore.get_instance().emit_log(LOG_LEVEL_WARN, LOG_RELOAD_FAIL % node)
				break
			else:
				_cache_store[node] = step_res.get("data", null)
				reloaded_count += 1
		else:
			# 无解析器时仅完成子图受影响标记并推进计数
			reloaded_count += 1

	if rollback_performed:
		return {
			"success": false,
			"affected_nodes": invalidation_list,
			"reloaded_count": reloaded_count,
			"failed_node": failed_node,
			"rollback_performed": true
		}

	EventBusCore.get_instance().emit_log(LOG_LEVEL_INFO, LOG_RELOAD_SUCCESS % [changed_node, reloaded_count])
	return {
		"success": true,
		"affected_nodes": invalidation_list,
		"reloaded_count": reloaded_count,
		"rollback_performed": false
	}

## 测试重置
static func reset_for_tests() -> void:
	if _instance != null:
		_instance._dag.clear()
		_instance._cache_store.clear()
	_instance = null
