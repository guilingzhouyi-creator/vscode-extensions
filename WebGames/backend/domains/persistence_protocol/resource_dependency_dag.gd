# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/resource_dependency_dag.gd
# 架构定位: Resource Dependency Directed Acyclic Graph (DAG)
# 跨域依赖: 上游: TargetedHotReloader, GameConfig | 下游: EventBusCore, BoundedResourceCache
# 职责说明: 资源依赖有向无环图：管理配置、文案、场景与数据模型之间的双向依赖关系，
#           提供环路检测与局部失效子图计算（Invalidation Subgraph），支持热重载时
#           仅精准重算并刷新受影响分支，杜绝粗暴全量重载。
# 设计依据: 双域储存架构局部失效与定向热更规范
# ==============================================================================

class_name ResourceDependencyDAG extends RefCounted

## 邻接表：源节点 -> 其直接下游依赖它的节点集合（Array[String]）
var _downstream_edges: Dictionary = {}

## 反向邻接表：节点 -> 其直接依赖的上游节点集合（Array[String]）
var _upstream_edges: Dictionary = {}

func _init() -> void:
	_downstream_edges = {}
	_upstream_edges = {}

## 注册依赖关系：dependent 依赖于 dependency
## 即 dependency 发生变动时，dependent 需要被重载
func add_dependency(dependent: String, dependency: String) -> bool:
	if dependent.is_empty() or dependency.is_empty() or dependent == dependency:
		return false

	if not _downstream_edges.has(dependency):
		_downstream_edges[dependency] = []
	var downstream: Array = _downstream_edges[dependency]
	if not downstream.has(dependent):
		downstream.append(dependent)

	if not _upstream_edges.has(dependent):
		_upstream_edges[dependent] = []
	var upstream: Array = _upstream_edges[dependent]
	if not upstream.has(dependency):
		upstream.append(dependency)

	if _detect_cycle():
		# 存在环路，回滚刚才的添加
		downstream.erase(dependent)
		upstream.erase(dependency)
		return false

	return true

const COLOR_UNVISITED: int = 0
const COLOR_VISITING: int = 1
const COLOR_VISITED: int = 2

## 环路检测（DFS 拓扑染色法：0=未访问, 1=访问中, 2=已完成）
func _detect_cycle() -> bool:
	var color: Dictionary = {}
	for node in _downstream_edges.keys():
		color[node] = COLOR_UNVISITED
	for node in _upstream_edges.keys():
		color[node] = COLOR_UNVISITED

	for node in color.keys():
		if color[node] == COLOR_UNVISITED:
			if _dfs_cycle(node, color):
				return true
	return false

func _dfs_cycle(node: String, color: Dictionary) -> bool:
	color[node] = COLOR_VISITING # 访问中
	var downstream: Array = _downstream_edges.get(node, [])
	for next_node in downstream:
		var c: int = color.get(next_node, COLOR_UNVISITED)
		if c == COLOR_VISITING:
			return true # 环路命中
		if c == COLOR_UNVISITED and _dfs_cycle(next_node, color):
			return true
	color[node] = COLOR_VISITED # 已完成
	return false

## 计算指定节点变更时的受影响失效子图（BFS / 拓扑序展开）
## 返回受影响节点列表（包含 changed_node 自身在首位，后随下游拓扑受影响节点）
func get_invalidation_subgraph(changed_node: String) -> Array[String]:
	var result: Array[String] = []
	if changed_node.is_empty():
		return result

	result.append(changed_node)
	var queue: Array[String] = [changed_node]
	var visited: Dictionary = {changed_node: true}

	while not queue.is_empty():
		var cur: String = queue.pop_front()
		_expand_downstream_nodes(cur, visited, queue, result)

	return result

func _expand_downstream_nodes(cur: String, visited: Dictionary, queue: Array[String], result: Array[String]) -> void:
	var downstream: Array = _downstream_edges.get(cur, [])
	for dep in downstream:
		var dep_str := String(dep)
		if not visited.has(dep_str):
			visited[dep_str] = true
			queue.append(dep_str)
			result.append(dep_str)

## 清除所有依赖记录
func clear() -> void:
	_downstream_edges.clear()
	_upstream_edges.clear()
