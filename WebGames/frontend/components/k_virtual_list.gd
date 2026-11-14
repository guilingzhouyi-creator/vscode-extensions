# ==============================================================================
# 模块归属: 前端通用组件层 (Frontend · Reusable UI Components)
# 文件路径: res://frontend/components/k_virtual_list.gd
# 架构定位: High-Performance Virtualized List & Row Pool (KVirtualList)
# 依赖与触发: 上游: 大规模背包/日志/列表视图 | 下游: KVirtualRow
# 职责说明: 计算视口可视元素索引闭区间并提供行节点对象池（acquire/release 与 reset_state 复位契约）。
# 退出语义与设计依据: 对象池零瞬态分配契约 (ADV-POOL-001 / ADV-PRF-002) 与池容量硬上限约束
# ==============================================================================

## KVirtualList：支持行节点对象池复用的虚拟滚动列表容器
class_name KVirtualList
extends ScrollContainer

signal range_changed(start_index: int, end_index: int)

## 行对象池硬上限（ADV-POOL-001：防止极端大视口下空闲行池无界膨胀）
const POOL_HARD_CAP: int = 128
const METHOD_RESET_STATE: String = "reset_state"

## ------------------------------------------------------------------------------
## 池化行节点具体实现（ADV-POOL-001 契约：复位一切跨复用残留）
## ① 断开上一行数据绑定（i18n 键 / 文本 / 进度 / 选中态清零）；
## ② 复位内部状态（可见性由消费方经 acquire_row 复位）；
## ③ 不得销毁自身（严禁 queue_free）；④ 幂等（多次调用结果一致）。
## 早期 release_row 仅对消费方 Control 做 `has_method("reset_state")` 鸭子调用，
## 无具体实现可供契约校验；本类提供可实例化、可直接验证复位行为的具体实现。
## ------------------------------------------------------------------------------
## KVirtualRow：内置于 KVirtualList 的池化行控件基类实现
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
## 当前活跃行映射: index -> Control 与反向查找表: Control -> index
var _active_rows: Dictionary = {}
var _row_to_index: Dictionary = {}

func _ready() -> void:
	get_v_scroll_bar().value_changed.connect(_on_scroll_changed)

## 核心算法：基于滚动偏移量求解可视单元格索引闭区间 [start_index, end_index]
static func calculate_visible_range(scroll_y: float, view_height: float, cell_height: float, total: int, buffer: int = 2) -> Vector2i:
	if total <= 0 or cell_height <= 0.0:
		return Vector2i(-1, -1)

	var safe_view_height: float = maxf(view_height, cell_height)
	var raw_start: int = int(floor(scroll_y / cell_height)) - buffer
	var raw_end: int = int(ceil((scroll_y + safe_view_height) / cell_height)) + buffer

	var start_index: int = clampi(raw_start, 0, total - 1)
	var end_index: int = clampi(raw_end, 0, total - 1)

	if start_index > end_index:
		return Vector2i(-1, -1)

	return Vector2i(start_index, end_index)

## 更新总数据项
func set_total_count(count: int) -> void:
	var safe_count: int = maxi(0, count)
	if safe_count < _total_count:
		# 缩容：仅将越界活跃行回收到池，保留池内可复用节点
		if safe_count == 0:
			_recycle_rows_for_range(-1, -2)
		else:
			_recycle_rows_for_range(_current_start, mini(_current_end, safe_count - 1))
	_total_count = safe_count
	_refresh_range()

func _on_scroll_changed(_value: float) -> void:
	_refresh_range()

func _refresh_range() -> void:
	var scroll_y: float = float(get_v_scroll_bar().value)
	var view_height: float = size.y
	if view_height <= 0.0:
		view_height = 400.0

	var visible_range := calculate_visible_range(scroll_y, view_height, item_height, _total_count, buffer_count)
	if visible_range.x != _current_start or visible_range.y != _current_end:
		_current_start = visible_range.x
		_current_end = visible_range.y
		# 回收时机：可视区间变化时收回离区行（入区行由消费方经 acquire_row_for_index 取用）
		_recycle_rows_for_range(_current_start, _current_end)
		range_changed.emit(_current_start, _current_end)

## 获取当前可视单元格索引闭区间 [start_index, end_index]
func get_current_range() -> Vector2i:
	return Vector2i(_current_start, _current_end)

# ==============================================================================
# 行对象池（ADV-POOL-001：组件层提供池化实现与接口预留，不主动耦合业务消费方）
# ==============================================================================

## 统一复位单行池化节点内部状态（KVirtualRow 具体类优先，兼容外部鸭子实现）
static func _reset_row_state(row: Control) -> void:
	if row is KVirtualRow:
		(row as KVirtualRow).reset_state()
	elif row.has_method(METHOD_RESET_STATE):
		row.call(METHOD_RESET_STATE)

## 取用一枚行节点：优先复用池中空闲项（LIFO），池空则新建具体池化行
func acquire_row() -> Control:
	if not _row_pool.is_empty():
		var reused: Control = _row_pool.pop_back()
		_reset_row_state(reused)
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
	_row_to_index[row] = index
	return row

## 归还一枚行节点：同步移出活跃表 → 清态 → 入池；超池容量则直接释放（ADV-POOL-001）
func release_row(row: Control) -> void:
	if row == null or not is_instance_valid(row):
		return
	# O(1) 反查并取消活跃登记，保证「无重复入池」
	if _row_to_index.has(row):
		var mapped_index: int = int(_row_to_index[row])
		_row_to_index.erase(row)
		if _active_rows.get(mapped_index) == row:
			_active_rows.erase(mapped_index)
	# ADV-POOL-001 契约：归还前必须清态（优先具体实现，兼容消费方鸭子实现）
	_reset_row_state(row)
	row.visible = false
	if _row_pool.size() >= _pool_capacity():
		_detach_from_parent(row)
		_free_row_node(row)
		return
	_row_pool.append(row)

## 释放脱离场景树的行节点：树内走 queue_free，已脱树走即时 free 防无头退出泄漏
static func _free_row_node(row: Control) -> void:
	if row.is_inside_tree():
		row.queue_free()
	else:
		row.free()

## 释放前摘除父节点：池释放的行可能仍挂在消费方容器下且被其引用，
## 先脱父再销毁，明确所有权边界（组件只销毁自己池内的节点）
func _detach_from_parent(row: Control) -> void:
	var parent := row.get_parent()
	if parent != null:
		parent.remove_child(row)

## 池容量上界 = 可视区间容量 + 2*buffer，并受 POOL_HARD_CAP 硬约束
func _pool_capacity() -> int:
	var view_height: float = size.y
	if view_height <= 0.0:
		view_height = 400.0
	var visible_cap: int = int(ceil(view_height / maxf(item_height, 1.0))) + 2 * buffer_count
	return clampi(visible_cap, 0, POOL_HARD_CAP)

## 回收时机：可视区间变化时收回离区行
func _recycle_rows_for_range(start_index: int, end_index: int) -> void:
	var to_recycle: Array[Control] = []
	for row_index in _active_rows:
		if row_index < start_index or row_index > end_index:
			to_recycle.append(_active_rows[row_index] as Control)
	for row in to_recycle:
		release_row(row)

## 清空活跃行与行对象池（reset_state / 视图销毁时调用），逐项释放
func _clear_row_pool() -> void:
	for row_index in _active_rows.keys():
		var active_row: Control = _active_rows[row_index]
		if active_row != null and is_instance_valid(active_row):
			_reset_row_state(active_row)
			_detach_from_parent(active_row)
			_free_row_node(active_row)
	_active_rows.clear()
	_row_to_index.clear()
	for pooled_row in _row_pool:
		if pooled_row != null and is_instance_valid(pooled_row):
			_detach_from_parent(pooled_row)
			_free_row_node(pooled_row)
	_row_pool.clear()

## 组件级状态复位（幂等）：清空行对象池与活跃登记、归零可视区间与总量。
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
