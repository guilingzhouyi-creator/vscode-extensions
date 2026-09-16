# ==============================================================================
# 卡拉尔世界引擎 (Kalar World Engine) - 前端通用组件: 高性能虚拟滚动列表 (KVirtualList)
# 文件路径: res://frontend/components/k_virtual_list.gd
# 职责: 计算视口可视元素索引区间并提供行节点对象池（acquire/release + reset_state 契约）
# ==============================================================================
class_name KVirtualList
extends ScrollContainer

signal range_changed(start_idx: int, end_idx: int)

## 行对象池硬上限（R-31 / ADV-POOL-001：防池无界膨胀，魔法数字入常量）
const POOL_HARD_CAP: int = 128

## ------------------------------------------------------------------------------
## 池化行节点具体实现（ADV-POOL-001 契约：复位一切跨复用残留）
## ① 断开上一行数据绑定（i18n 键 / 文本 / 进度 / 选中态清零）；
## ② 复位内部状态（可见性由消费方经 acquire_row 复位）；
## ③ 不得销毁自身（严禁 queue_free）；④ 幂等（多次调用结果一致）。
## 收敛前 release_row 仅对消费方 Control 做 `has_method("reset_state")` 鸭子调用，
## 无具体实现可被断言；本类提供可实例化、可被契约测试直接断言的具体实现。
## ------------------------------------------------------------------------------
class KVirtualRow extends Control:
	## 上一行绑定的 i18n 键与业务数据（复用前必须清空，杜绝脏状态串行）
	var bound_key: String = ""
	var bound_data: Dictionary = {}

	## 复位一切跨复用残留（幂等，不销毁自身）
	## 注：focus_mode / modulate / 可见性属消费方样式基线，不由池负责改写
	## （对齐类契约「可见性由消费方经 acquire_row 复位」，避免覆盖消费方 tint/焦点配置）
	func reset_state() -> void:
		bound_key = ""
		bound_data = {}
		tooltip_text = ""
		for child in get_children():
			if child is Label:
				(child as Label).text = ""
			elif child is Button:
				(child as Button).text = ""
				(child as Button).disabled = false
			elif child is ProgressBar:
				(child as ProgressBar).value = 0.0

@export var item_height: float = 48.0
@export var buffer_count: int = 2

var _total_count: int = 0
var _current_start: int = -1
var _current_end: int = -1

## 空闲行节点栈（LIFO：热点行节点留在池中，对齐 ADV-POOL-001）
var _row_pool: Array[Control] = []
## 当前活跃行映射: index -> Control
var _active_rows: Dictionary = {}

func _ready() -> void:
	get_v_scroll_bar().value_changed.connect(_on_scroll_changed)

## 核心算法：基于滚动偏移量求解可视单元格索引闭区间 [start_idx, end_idx]
static func calculate_visible_range(scroll_y: float, view_height: float, cell_h: float, total: int, buffer: int = 2) -> Vector2i:
	if total <= 0 or cell_h <= 0.0:
		return Vector2i(-1, -1)

	var safe_view_h: float = maxf(view_height, cell_h)
	var raw_start: int = int(floor(scroll_y / cell_h)) - buffer
	var raw_end: int = int(ceil((scroll_y + safe_view_h) / cell_h)) + buffer

	var start_idx: int = clampi(raw_start, 0, total - 1)
	var end_idx: int = clampi(raw_end, 0, total - 1)

	if start_idx > end_idx:
		return Vector2i(-1, -1)

	return Vector2i(start_idx, end_idx)

## 更新总数据项
func set_total_count(count: int) -> void:
	var safe_count: int = maxi(0, count)
	if safe_count < _total_count:
		# 缩容：释放全部活跃行并清空行对象池，杜绝悬留脏行
		_clear_row_pool()
	_total_count = safe_count
	_refresh_range()

func _on_scroll_changed(_val: float) -> void:
	_refresh_range()

func _refresh_range() -> void:
	var scroll_y: float = float(get_v_scroll_bar().value)
	var view_h: float = size.y
	if view_h <= 0.0:
		view_h = 400.0

	var range_res := calculate_visible_range(scroll_y, view_h, item_height, _total_count, buffer_count)
	if range_res.x != _current_start or range_res.y != _current_end:
		_current_start = range_res.x
		_current_end = range_res.y
		# 回收时机：可视区间变化时收回离区行（入区行由消费方经 acquire_row_for_index 取用）
		_recycle_rows_for_range(_current_start, _current_end)
		range_changed.emit(_current_start, _current_end)

func get_current_range() -> Vector2i:
	return Vector2i(_current_start, _current_end)

# ==============================================================================
# 行对象池（R-31 / ADV-POOL-001：仅组件层落地 + 接口预留，不接线消费方）
# ==============================================================================

## 取用一枚行节点：优先复用池中空闲项（LIFO），池空则新建具体池化行
func acquire_row() -> Control:
	if not _row_pool.is_empty():
		var reused: Control = _row_pool.pop_back()
		if reused is KVirtualRow:
			(reused as KVirtualRow).reset_state()
		elif reused.has_method("reset_state"):
			reused.call("reset_state")
		reused.visible = true
		return reused
	var fresh := KVirtualRow.new()
	fresh.visible = true
	return fresh

## 按可视索引取用行节点：命中当前活跃行则复用，否则取池/新建并登记为活跃
func acquire_row_for_index(index: int) -> Control:
	var existing: Control = _active_rows.get(index)
	if existing != null and is_instance_valid(existing):
		return existing
	var row := acquire_row()
	_active_rows[index] = row
	return row

## 归还一枚行节点：同步移出活跃表 → 清态 → 入池；超池容量则直接释放（ADV-POOL-001）
func release_row(row: Control) -> void:
	if row == null or not is_instance_valid(row):
		return
	# 取消活跃登记（按节点反查下标），保证「无重复入池」
	for idx in _active_rows.keys():
		if _active_rows[idx] == row:
			_active_rows.erase(idx)
	# ADV-POOL-001 契约：归还前必须清态（优先具体实现，兼容消费方鸭子实现）
	if row is KVirtualRow:
		(row as KVirtualRow).reset_state()
	elif row.has_method("reset_state"):
		row.call("reset_state")
	row.visible = false
	if _row_pool.size() >= _pool_capacity():
		_detach_from_parent(row)
		row.queue_free()
		return
	_row_pool.append(row)

## 释放前摘除父节点：池释放的行可能仍挂在消费方容器下且被其引用，
## 先脱父再销毁，明确所有权边界（组件只销毁自己池内的节点）
func _detach_from_parent(row: Control) -> void:
	var parent := row.get_parent()
	if parent != null:
		parent.remove_child(row)

## 池容量上界 = 可视区间容量 + 2*buffer，并受 POOL_HARD_CAP 硬约束
func _pool_capacity() -> int:
	var view_h: float = size.y
	if view_h <= 0.0:
		view_h = 400.0
	var visible_cap: int = int(ceil(view_h / maxf(item_height, 1.0))) + 2 * buffer_count
	return clampi(visible_cap, 0, POOL_HARD_CAP)

## 回收时机：可视区间变化时收回离区行
func _recycle_rows_for_range(start_idx: int, end_idx: int) -> void:
	for idx in _active_rows.keys():
		if idx < start_idx or idx > end_idx:
			release_row(_active_rows[idx])
			_active_rows.erase(idx)

## 清空活跃行与行对象池（缩容 / 视图销毁时调用），逐项释放
func _clear_row_pool() -> void:
	for idx in _active_rows.keys():
		var active_row: Control = _active_rows[idx]
		if active_row != null and is_instance_valid(active_row):
			if active_row is KVirtualRow:
				(active_row as KVirtualRow).reset_state()
			elif active_row.has_method("reset_state"):
				active_row.call("reset_state")
			_detach_from_parent(active_row)
			active_row.queue_free()
	_active_rows.clear()
	for pooled_row in _row_pool:
		if pooled_row != null and is_instance_valid(pooled_row):
			_detach_from_parent(pooled_row)
			pooled_row.queue_free()
	_row_pool.clear()

## 组件级状态复位（R-31/S2-11/S4-13，幂等）：清空行对象池与活跃登记、归零可视区间与总量。
## 供视图销毁 / 重挂载时调用，确保复用前无脏状态；多次调用结果一致（幂等）。
func reset_state() -> void:
	_clear_row_pool()
	_total_count = 0
	_current_start = -1
	_current_end = -1

## 视图销毁钩子：清空行对象池，杜绝泄漏
func _notification(what: int) -> void:
	if what == NOTIFICATION_PREDELETE:
		_clear_row_pool()

## 当前空闲池深度（自测/诊断用）
func get_pool_size() -> int:
	return _row_pool.size()

## 当前活跃行数量（自测/诊断用）
func get_active_row_count() -> int:
	return _active_rows.size()
