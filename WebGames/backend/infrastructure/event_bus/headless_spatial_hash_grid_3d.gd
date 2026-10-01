# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/headless_spatial_hash_grid_3d.gd
# 架构定位: Event Broker / Decoupling Foundation
# 跨域依赖: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken | 配置: config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 事件总线专用三维空间格网：专门为视觉线索空间裁剪与视锥体过滤提供极速碰撞与距离测算，杜绝高频事件遍历全场景。
# 设计依据: 事件总线空间裁剪解耦规范 / 前后端通信隔离契约
# ==============================================================================

class_name HeadlessSpatialHashGrid3D
extends RefCounted

var _cell_size: float = 16.0
var _max_dispatch_radius: float = 256.0 # 派发半径钳制上限（防超大半径立方遍历冻结总线）
var _grid: Dictionary = {} # cell_key(int) -> Array[Dictionary]（含 token_id 与 callback）
var _listeners: Dictionary = {} # token_id(int) -> {center: Vector3, radius: float}
var _called_scratch: Dictionary = {} # 去重字典复用（非重入路径零堆分配）
var _targets_scratch: Array = [] # 派发目标暂存复用（遍历隔离防跳项，零堆分配）
var _spatial_reentrancy: int = 0 # 空间派发重入计数（回调内再派发时回退局部字典保正确性）

func _init(cell_size: float = 16.0, max_dispatch_radius: float = 256.0) -> void:
	_cell_size = maxf(1.0, cell_size)
	_max_dispatch_radius = maxf(1.0, max_dispatch_radius)

func _hash_cell_indices(cx: int, cy: int, cz: int) -> int:
	return (cx * 73856093) ^ (cy * 19349663) ^ (cz * 83492791)

func _hash_cell(pos: Vector3) -> int:
	return _hash_cell_indices(int(floor(pos.x / _cell_size)), int(floor(pos.y / _cell_size)), int(floor(pos.z / _cell_size)))

func _compute_min_cell(center: Vector3, radius: float) -> Vector3i:
	return Vector3i(
		int(floor((center.x - radius) / _cell_size)),
		int(floor((center.y - radius) / _cell_size)),
		int(floor((center.z - radius) / _cell_size))
	)

func _compute_max_cell(center: Vector3, radius: float) -> Vector3i:
	return Vector3i(
		int(floor((center.x + radius) / _cell_size)),
		int(floor((center.y + radius) / _cell_size)),
		int(floor((center.z + radius) / _cell_size))
	)

func _insert_entry_z_column(cx: int, cy: int, min_cz: int, max_cz: int, entry: Dictionary) -> void:
	for cz in range(min_cz, max_cz + 1):
		var h: int = _hash_cell_indices(cx, cy, cz)
		if not _grid.has(h):
			_grid[h] = []
		_grid[h].append(entry)

func _insert_entry_xy_plane(min_cell: Vector3i, max_cell: Vector3i, entry: Dictionary) -> void:
	for cx in range(min_cell.x, max_cell.x + 1):
		for cy in range(min_cell.y, max_cell.y + 1):
			_insert_entry_z_column(cx, cy, min_cell.z, max_cell.z, entry)

func register_listener(token_id: int, center: Vector3, radius: float, callback: Callable) -> void:
	# 幂等：同 token_id 重复注册时先注销旧挂载，杜绝网格残留重复条目
	if _listeners.has(token_id):
		unregister_listener(token_id)
	var r: float = maxf(0.0, radius)
	_listeners[token_id] = {"center": center, "radius": r}
	var min_cell: Vector3i = _compute_min_cell(center, r)
	var max_cell: Vector3i = _compute_max_cell(center, r)
	var entry: Dictionary = {"token_id": token_id, "callback": callback}
	_insert_entry_xy_plane(min_cell, max_cell, entry)

func register_listener_2d(token_id: int, center_2d: Vector2, radius: float, callback: Callable, is_isometric_xz: bool = false) -> void:
	var pos_3d: Vector3 = Vector3(center_2d.x, 0.0, center_2d.y) if is_isometric_xz else Vector3(center_2d.x, center_2d.y, 0.0)
	register_listener(token_id, pos_3d, radius, callback)

func update_listener_position(token_id: int, new_center: Vector3, radius: float, callback: Callable) -> void:
	unregister_listener(token_id)
	register_listener(token_id, new_center, radius, callback)

func _remove_token_from_cell(h: int, token_id: int) -> void:
	if not _grid.has(h):
		return
	var cell_arr: Array = _grid[h]
	for i in range(cell_arr.size() - 1, -1, -1):
		if cell_arr[i]["token_id"] == token_id:
			cell_arr.remove_at(i)
	if cell_arr.is_empty():
		_grid.erase(h)

func _remove_token_z_column(cx: int, cy: int, min_cz: int, max_cz: int, token_id: int) -> void:
	for cz in range(min_cz, max_cz + 1):
		_remove_token_from_cell(_hash_cell_indices(cx, cy, cz), token_id)

func _remove_token_xy_plane(min_cell: Vector3i, max_cell: Vector3i, token_id: int) -> void:
	for cx in range(min_cell.x, max_cell.x + 1):
		for cy in range(min_cell.y, max_cell.y + 1):
			_remove_token_z_column(cx, cy, min_cell.z, max_cell.z, token_id)

func unregister_listener(token_id: int) -> void:
	if not _listeners.has(token_id):
		return
	var info: Dictionary = _listeners[token_id]
	var center: Vector3 = info["center"]
	var r: float = info["radius"]
	_listeners.erase(token_id)
	var min_cell: Vector3i = _compute_min_cell(center, r)
	var max_cell: Vector3i = _compute_max_cell(center, r)
	_remove_token_xy_plane(min_cell, max_cell, token_id)

func _collect_cell_targets(h: int, pos: Vector3, r: float, called_tokens: Dictionary, targets: Array) -> void:
	if not _grid.has(h):
		return
	var entries: Array = _grid[h]
	for entry in entries:
		var tid: int = entry["token_id"]
		if called_tokens.has(tid) or not _listeners.has(tid):
			continue
		called_tokens[tid] = true
		var listener_info: Dictionary = _listeners[tid]
		var center: Vector3 = listener_info["center"]
		var lr: float = listener_info["radius"]
		if pos.distance_to(center) <= r + lr:
			targets.append(entry["callback"])

func _collect_z_column_targets(cx: int, cy: int, min_cz: int, max_cz: int, pos: Vector3, r: float, called_tokens: Dictionary, targets: Array) -> void:
	for cz in range(min_cz, max_cz + 1):
		_collect_cell_targets(_hash_cell_indices(cx, cy, cz), pos, r, called_tokens, targets)

func _collect_targets_xy_plane(min_cell: Vector3i, max_cell: Vector3i, pos: Vector3, r: float, called_tokens: Dictionary, targets: Array) -> void:
	for cx in range(min_cell.x, max_cell.x + 1):
		for cy in range(min_cell.y, max_cell.y + 1):
			_collect_z_column_targets(cx, cy, min_cell.z, max_cell.z, pos, r, called_tokens, targets)

func _invoke_spatial_targets(targets: Array, packet: EventPacket) -> int:
	var dispatched: int = 0
	for cb in targets:
		var callback: Callable = cb as Callable
		if callback.is_valid():
			callback.call(packet)
			dispatched += 1
	return dispatched

## 空间事件派发：单元格粗裁剪 → 欧氏距离精确过滤（Inv-EB2-2）→ token_id 去重
func dispatch_spatial(pos: Vector3, radius: float, packet: EventPacket) -> int:
	# 半径钳制：防御性上限，防止异常半径触发 (2r/cell+1)^3 立方遍历冻结总线
	var r: float = minf(maxf(0.0, radius), _max_dispatch_radius)
	var min_cell: Vector3i = _compute_min_cell(pos, r)
	var max_cell: Vector3i = _compute_max_cell(pos, r)

	var prev_reentrancy: int = _spatial_reentrancy
	_spatial_reentrancy += 1
	var use_scratch: bool = (_spatial_reentrancy == 1)
	var called_tokens: Dictionary = _called_scratch if use_scratch else {}
	var targets: Array = _targets_scratch if use_scratch else []
	called_tokens.clear()
	targets.clear()

	_collect_targets_xy_plane(min_cell, max_cell, pos, r, called_tokens, targets)

	# 派发快照已在独立 targets 中，回调内增删订阅不影响本轮遍历（Inv-EB2-7 契约对齐）
	var dispatched: int = _invoke_spatial_targets(targets, packet)

	if use_scratch:
		called_tokens.clear()
		targets.clear()
	_spatial_reentrancy = prev_reentrancy
	return dispatched

## 便捷入口：按事件包自身空间头派发
func dispatch_packet(packet: EventPacket) -> int:
	if packet == null or not packet.is_spatial:
		return 0
	return dispatch_spatial(packet.world_position, packet.effect_radius, packet)

## 单元格尺寸只读访问器（供核心/遥测读取，避免跨类访问私有字段）
func get_cell_size() -> float:
	return _cell_size
