# ==============================================================================
# 模块归属: 业务领域层 (Domains · 剧情、任务与社交集群 (Narrative & Social))
# 文件路径: res://backend/domains/notification_red_dot/red_dot_tree_fsm.gd
# 架构定位: Domain FSM / State Advancer (Phase 88 角色归位：对注入 registry 原地推进计数聚合)
# 跨域依赖: 上游: GameBootstrap, WorldGateway, 业务调度器 | 下游: GameConfig, EventBusCore | 配置: config/domains/notification_red_dot.json | 信号: EventBus 领域广播
# 职责说明: 递归更新叶子节点计数、自发向上冒泡汇总父级计数与清空同步。 六角色归位（Phase 88）：本文件对调用方注入的 registry 原地推进节点计数（含环检测守卫），属 fsm 语义（《后端逻辑处理标准 v1》存量渐进归位），不再声明为纯求解器。
# 设计依据: 业务域第一性原理 / Phase 04 施工细则规范
# ==============================================================================

class_name RedDotTreeFsm
extends RefCounted

## 递归汇总入口：从起始节点自下而上冒泡父级计数
static func recalculate_node_upwards(registry: Dictionary, start_node_path: String) -> void:
	if not registry.has(start_node_path):
		return
	_recalculate_upwards_impl(registry, start_node_path, {})

## L4（Phase 56）：递归带 visited 访问集（Inv-DF-2）——parent_path 成环/自指（脏数据）
## 不再无限递归栈溢出；命中环即终止并告警（现场可审计、不静默）
static func _recalculate_upwards_impl(registry: Dictionary, node_path: String, visited: Dictionary) -> void:
	if visited.has(node_path):
		push_warning("red_dot: 环检测命中于节点 %s（parent_path 成环/自指，脏数据）" % node_path)
		return
	visited[node_path] = true

	var node: RedDotTreeNode = registry[node_path]
	var sub_sum = node.direct_count
	for c_path in node.children_paths:
		var c_str = str(c_path)
		if registry.has(c_str):
			var child: RedDotTreeNode = registry[c_str]
			sub_sum += child.total_aggregated_count

	node.total_aggregated_count = sub_sum

	# 向上冒泡通知父节点（携带同一 visited）
	if node.parent_path != "" and registry.has(node.parent_path):
		_recalculate_upwards_impl(registry, node.parent_path, visited)

## 设置叶子节点直计数值并触发向上冒泡重算
static func set_node_direct_count(registry: Dictionary, node_path: String, new_count: int) -> void:
	if not registry.has(node_path):
		return
	var node: RedDotTreeNode = registry[node_path]
	node.direct_count = new_count
	recalculate_node_upwards(registry, node_path)
