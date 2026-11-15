# ==============================================================================
# 模块归属: Frontend / UIInfrastructure
# 文件路径: res://frontend/ui_infrastructure/red_dot_tree_manager.gd
# 架构定位: UI 基础设施树状红点管理器，维护点分路径红点计数并自底向上聚合广播
# 依赖与触发: 纯内存引用计数树，由邮件、社交或系统通知桥接更新并驱动红点控件订阅
# 职责说明: 管理树状层级红点（如 main_hud.social.mail），叶子变更自底向上聚合传播
# 退出语义与设计依据: 重置或清除路径后全量重算并仅针对计数值发生变化的路径广播信号，防止订阅方残留旧态
# ==============================================================================
## RedDotTreeManager：树状红点通知管理器，负责叶子计数维护、祖先聚合与变更差异广播
class_name RedDotTreeManager
extends RefCounted

signal red_dot_changed(path: String, count: int)

static var _instance: RedDotTreeManager
## 获取树状红点管理器全局单例
static func get_instance() -> RedDotTreeManager:
	if _instance == null:
		_instance = RedDotTreeManager.new()
	return _instance

## 重置树状红点管理器静态单例并清空节点计数字典
static func reset_instance() -> void:
	if _instance != null:
		_instance._leaf_counts.clear()
		_instance._counts.clear()
	_instance = null

# 存储各节点的计数值: path -> int
var _counts: Dictionary = {}
# 存储叶子节点的计数值: leaf_path -> int
var _leaf_counts: Dictionary = {}

## 设置叶子节点红点计数值
func set_count(path: String, count: int) -> void:
	var safe_count: int = maxi(0, count)
	_leaf_counts[path] = safe_count
	_recalculate_tree()

## 获取指定路径红点计数
func get_count(path: String) -> int:
	return _counts.get(path, 0)

## 是否存在有效红点
func has_red_dot(path: String) -> bool:
	return get_count(path) > 0

## 清除指定路径及其所有子项
func clear_path(path: String) -> void:
	var to_remove: Array[String] = []
	for leaf_key in _leaf_counts.keys():
		var leaf_path: String = str(leaf_key)
		if leaf_path == path or leaf_path.begins_with(path + "."):
			to_remove.append(leaf_path)
	for remove_path in to_remove:
		_leaf_counts.erase(remove_path)
	_recalculate_tree()

## 清空所有红点数据（广播归零差异，避免订阅方残留陈旧红点）
func reset() -> void:
	_leaf_counts.clear()
	_recalculate_tree()

## 将单个叶子计数值沿着点分祖先链自底向上累加（零字符串切片与循环堆拼接）
static func _accumulate_ancestors(leaf: String, delta_value: int, counts: Dictionary) -> void:
	counts[leaf] = counts.get(leaf, 0) + delta_value
	var dot_index: int = leaf.rfind(".")
	while dot_index > 0:
		var prefix: String = leaf.substr(0, dot_index)
		counts[prefix] = counts.get(prefix, 0) + delta_value
		dot_index = leaf.rfind(".", dot_index - 1)

## 自底向上重新聚合全树节点计数值
func _recalculate_tree() -> void:
	var old_counts: Dictionary = _counts.duplicate()
	var new_counts: Dictionary = {}

	for raw_leaf in _leaf_counts.keys():
		var leaf: String = str(raw_leaf)
		var leaf_value: int = int(_leaf_counts[leaf])
		if leaf_value <= 0:
			continue
		_accumulate_ancestors(leaf, leaf_value, new_counts)

	_counts = new_counts

	# 广播所有发生变动的路径
	var all_paths: Dictionary = {}
	for path_key in old_counts.keys():
		all_paths[str(path_key)] = true
	for path_key in new_counts.keys():
		all_paths[str(path_key)] = true

	for raw_path in all_paths.keys():
		var dot_path: String = str(raw_path)
		var old_value: int = old_counts.get(dot_path, 0)
		var new_value: int = new_counts.get(dot_path, 0)
		if old_value != new_value:
			red_dot_changed.emit(dot_path, new_value)
