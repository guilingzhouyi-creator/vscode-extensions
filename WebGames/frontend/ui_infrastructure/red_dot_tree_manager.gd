# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - UI基础设施: 树状红点通知管理器
# 文件路径: res://frontend/ui_infrastructure/red_dot_tree_manager.gd
# 职责: 管理树状层级红点（如 main_hud.social.mail），叶子变更自底向上聚合传播
# ==============================================================================
class_name RedDotTreeManager
extends RefCounted

signal red_dot_changed(path: String, count: int)

static var _instance: RedDotTreeManager
static func get_instance() -> RedDotTreeManager:
	if _instance == null:
		_instance = load("res://frontend/ui_infrastructure/red_dot_tree_manager.gd").new()
	return _instance

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
	for k in _leaf_counts.keys():
		var leaf_str: String = str(k)
		if leaf_str == path or leaf_str.begins_with(path + "."):
			to_remove.append(leaf_str)
	for r in to_remove:
		_leaf_counts.erase(r)
	_recalculate_tree()

## 清空所有红点数据（广播归零差异，避免订阅方残留陈旧红点）
func reset() -> void:
	_leaf_counts.clear()
	_recalculate_tree()

## 自底向上重新聚合全树节点计数值
func _recalculate_tree() -> void:
	var old_counts: Dictionary = _counts.duplicate()
	var new_counts: Dictionary = {}

	for raw_leaf in _leaf_counts.keys():
		var leaf: String = str(raw_leaf)
		var val: int = int(_leaf_counts[leaf])
		if val <= 0:
			continue

		# 自身
		new_counts[leaf] = new_counts.get(leaf, 0) + val

		# 向所有父前缀贡献值
		var parts: PackedStringArray = leaf.split(".")
		var prefix: String = ""
		for i in range(parts.size() - 1):
			if i == 0:
				prefix = parts[0]
			else:
				prefix += "." + parts[i]
			new_counts[prefix] = new_counts.get(prefix, 0) + val

	_counts = new_counts

	# 广播所有发生变动的路径
	var all_paths: Dictionary = {}
	for k in old_counts.keys():
		all_paths[str(k)] = true
	for k in new_counts.keys():
		all_paths[str(k)] = true

	for raw_p in all_paths.keys():
		var p: String = str(raw_p)
		var old_val: int = old_counts.get(p, 0)
		var new_val: int = new_counts.get(p, 0)
		if old_val != new_val:
			red_dot_changed.emit(p, new_val)
