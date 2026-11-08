# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/headless_spatial_hash_grid_3d.gd
# 架构定位: Event Broker / Decoupling Foundation
# 依赖与触发: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken
# 配置与信号: 配置 config/infrastructure/event_bus.json | 信号: 全域领域事件中心分发
# 职责说明: 事件总线三维空间格网，为视觉线索空间裁剪与视锥过滤提供快速距离测算。
# 退出语义与设计依据: 事件总线空间裁剪解耦规范 / 前后端通信隔离契约
# ==============================================================================

## HeadlessSpatialHashGrid3D：Event Broker / Decoupling Foundation
class_name HeadlessSpatialHashGrid3D
extends RefCounted

const DEFAULT_CELL_SIZE: float = 16.0
const DEFAULT_MAX_DISPATCH_RADIUS: float = 256.0
const MIN_SPATIAL_VALUE: float = 1.0
const MAX_POOLED_CELL_BUCKETS: int = 256
const HASH_PRIME_X: int = 73856093
const HASH_PRIME_Y: int = 19349663
const HASH_PRIME_Z: int = 83492791

var _cell_size: float = DEFAULT_CELL_SIZE
var _max_dispatch_radius: float = DEFAULT_MAX_DISPATCH_RADIUS # 派发半径钳制上限（防超大半径立方遍历冻结总线）
var _grid: Dictionary = {} # cell_key(int) -> Array[Dictionary]（含 token_id 与 callback）
var _listeners: Dictionary = {} # token_id(int) -> {center: Vector3, radius: float}
var _called_scratch: Dictionary = {} # 去重字典复用（非重入路径零堆分配）
var _targets_scratch: Array = [] # 派发目标暂存复用（遍历隔离防跳项，零堆分配）
var _free_cell_buckets: Array = [] # 空闲单元格数组池，避免增删监听器触发瞬态堆分配
var _dispatch_query_scratch: Dictionary = {} # 查询上下文复用，消除循环内临时结构分配
var _spatial_reentrancy: int = 0 # 空间派发重入计数（回调内再派发时回退局部字典保正确性）

## 初始化三维空间哈希格网（钳制最小单元格尺寸与派发半径上限）
func _init(cell_size: float = DEFAULT_CELL_SIZE, max_dispatch_radius: float = DEFAULT_MAX_DISPATCH_RADIUS) -> void:
	_cell_size = maxf(MIN_SPATIAL_VALUE, cell_size)
	_max_dispatch_radius = maxf(MIN_SPATIAL_VALUE, max_dispatch_radius)

func _hash_cell_indices(cell_x: int, cell_y: int, cell_z: int) -> int:
	return (cell_x * HASH_PRIME_X) ^ (cell_y * HASH_PRIME_Y) ^ (cell_z * HASH_PRIME_Z)

func _compute_cell_bound(center: Vector3, signed_offset: float) -> Vector3i:
	return Vector3i(
		int(floor((center.x + signed_offset) / _cell_size)),
		int(floor((center.y + signed_offset) / _cell_size)),
		int(floor((center.z + signed_offset) / _cell_size))
	)

func _acquire_cell_bucket() -> Array:
	if _free_cell_buckets.is_empty():
		return []
	var bucket: Array = _free_cell_buckets.pop_back()
	bucket.clear()
	return bucket

func _insert_entry_z_column(cell_x: int, cell_y: int, z_bounds: Vector2i, entry: Dictionary) -> void:
	for cell_z in range(z_bounds.x, z_bounds.y + 1):
		var cell_hash: int = _hash_cell_indices(cell_x, cell_y, cell_z)
		if not _grid.has(cell_hash):
			_grid[cell_hash] = _acquire_cell_bucket()
		(_grid[cell_hash] as Array).append(entry)

func _insert_entry_y_column(cell_x: int, min_cell: Vector3i, max_cell: Vector3i, entry: Dictionary) -> void:
	var z_bounds := Vector2i(min_cell.z, max_cell.z)
	for cell_y in range(min_cell.y, max_cell.y + 1):
		_insert_entry_z_column(cell_x, cell_y, z_bounds, entry)

## 在空间哈希网格中注册三维局部侦听器
func register_listener(token_id: int, center: Vector3, radius: float, callback: Callable) -> void:
	# 幂等：同 token_id 重复注册时先注销旧挂载，杜绝网格残留重复条目
	if _listeners.has(token_id):
		unregister_listener(token_id)
	var clamped_radius: float = maxf(0.0, radius)
	_listeners[token_id] = {"center": center, "radius": clamped_radius}
	var min_cell: Vector3i = _compute_cell_bound(center, -clamped_radius)
	var max_cell: Vector3i = _compute_cell_bound(center, clamped_radius)
	var entry: Dictionary = {"token_id": token_id, "callback": callback}
	for cell_x in range(min_cell.x, max_cell.x + 1):
		_insert_entry_y_column(cell_x, min_cell, max_cell, entry)

## 在空间哈希网格中注册二维局部侦听器
func register_listener_2d(token_id: int, center_2d: Vector2, radius: float, callback: Callable, is_isometric_xz: bool = false) -> void:
	var pos_3d: Vector3 = Vector3(center_2d.x, 0.0, center_2d.y) if is_isometric_xz else Vector3(center_2d.x, center_2d.y, 0.0)
	register_listener(token_id, pos_3d, radius, callback)

## 更新侦听器在空间网格中的空间坐标位置
func update_listener_position(token_id: int, new_center: Vector3, radius: float, callback: Callable) -> void:
	unregister_listener(token_id)
	register_listener(token_id, new_center, radius, callback)

func _remove_token_from_cell(cell_hash: int, token_id: int) -> void:
	if not _grid.has(cell_hash):
		return
	var cell_arr: Array = _grid[cell_hash]
	for idx in range(cell_arr.size() - 1, -1, -1):
		if cell_arr[idx]["token_id"] == token_id:
			cell_arr.remove_at(idx)
	if cell_arr.is_empty():
		_grid.erase(cell_hash)
		if _free_cell_buckets.size() < MAX_POOLED_CELL_BUCKETS:
			_free_cell_buckets.append(cell_arr)

func _remove_token_z_column(cell_x: int, cell_y: int, z_bounds: Vector2i, token_id: int) -> void:
	for cell_z in range(z_bounds.x, z_bounds.y + 1):
		_remove_token_from_cell(_hash_cell_indices(cell_x, cell_y, cell_z), token_id)

func _remove_token_y_column(cell_x: int, min_cell: Vector3i, max_cell: Vector3i, token_id: int) -> void:
	var z_bounds := Vector2i(min_cell.z, max_cell.z)
	for cell_y in range(min_cell.y, max_cell.y + 1):
		_remove_token_z_column(cell_x, cell_y, z_bounds, token_id)

## 从空间网格中注销指定令牌的侦听器
func unregister_listener(token_id: int) -> void:
	if not _listeners.has(token_id):
		return
	var listener_record: Dictionary = _listeners[token_id]
	var center: Vector3 = listener_record["center"]
	var clamped_radius: float = listener_record["radius"]
	_listeners.erase(token_id)
	var min_cell: Vector3i = _compute_cell_bound(center, -clamped_radius)
	var max_cell: Vector3i = _compute_cell_bound(center, clamped_radius)
	for cell_x in range(min_cell.x, max_cell.x + 1):
		_remove_token_y_column(cell_x, min_cell, max_cell, token_id)

func _collect_cell_targets(cell_hash: int, query_ctx: Dictionary) -> void:
	if not _grid.has(cell_hash):
		return
	var origin: Vector3 = query_ctx["pos"]
	var query_radius: float = query_ctx["radius"]
	var called_tokens: Dictionary = query_ctx["called"]
	var targets: Array = query_ctx["targets"]
	var entries: Array = _grid[cell_hash]
	for entry in entries:
		var token_id: int = entry["token_id"]
		if called_tokens.has(token_id) or not _listeners.has(token_id):
			continue
		called_tokens[token_id] = true
		var listener_record: Dictionary = _listeners[token_id]
		var center: Vector3 = listener_record["center"]
		var listener_radius: float = listener_record["radius"]
		if origin.distance_to(center) <= query_radius + listener_radius:
			targets.append(entry["callback"])

func _collect_z_column_targets(cell_x: int, cell_y: int, z_bounds: Vector2i, query_ctx: Dictionary) -> void:
	for cell_z in range(z_bounds.x, z_bounds.y + 1):
		_collect_cell_targets(_hash_cell_indices(cell_x, cell_y, cell_z), query_ctx)

func _collect_y_column_targets(cell_x: int, min_cell: Vector3i, max_cell: Vector3i, query_ctx: Dictionary) -> void:
	var z_bounds := Vector2i(min_cell.z, max_cell.z)
	for cell_y in range(min_cell.y, max_cell.y + 1):
		_collect_z_column_targets(cell_x, cell_y, z_bounds, query_ctx)

func _invoke_spatial_targets(targets: Array, packet: EventPacket) -> int:
	var dispatched: int = 0
	for raw_callback in targets:
		var callback: Callable = raw_callback as Callable
		if callback.is_valid():
			callback.call(packet)
			dispatched += 1
	return dispatched

## 空间事件派发：单元格粗裁剪 → 欧氏距离精确过滤（Inv-EB2-2）→ token_id 去重
func dispatch_spatial(pos: Vector3, radius: float, packet: EventPacket) -> int:
	# 半径钳制：防御性上限，防止异常半径触发 (2r/cell+1)^3 立方遍历冻结总线
	var clamped_radius: float = minf(maxf(0.0, radius), _max_dispatch_radius)
	var min_cell: Vector3i = _compute_cell_bound(pos, -clamped_radius)
	var max_cell: Vector3i = _compute_cell_bound(pos, clamped_radius)

	var prev_reentrancy: int = _spatial_reentrancy
	_spatial_reentrancy += 1
	var use_scratch: bool = (_spatial_reentrancy == 1)
	var called_tokens: Dictionary = _called_scratch if use_scratch else {}
	var targets: Array = _targets_scratch if use_scratch else []
	called_tokens.clear()
	targets.clear()

	var query_ctx: Dictionary = _dispatch_query_scratch if use_scratch else {}
	query_ctx["pos"] = pos
	query_ctx["radius"] = clamped_radius
	query_ctx["called"] = called_tokens
	query_ctx["targets"] = targets

	for cell_x in range(min_cell.x, max_cell.x + 1):
		_collect_y_column_targets(cell_x, min_cell, max_cell, query_ctx)

	# 派发快照已在独立 targets 中，回调内增删订阅不影响本轮遍历（Inv-EB2-7 契约对齐）
	var dispatched: int = _invoke_spatial_targets(targets, packet)

	if use_scratch:
		called_tokens.clear()
		targets.clear()
		query_ctx.clear()
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
