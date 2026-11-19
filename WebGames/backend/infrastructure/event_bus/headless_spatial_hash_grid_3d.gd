# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · EventBus)
# 文件路径: res://backend/infrastructure/event_bus/headless_spatial_hash_grid_3d.gd
# 架构定位: Event Broker / Decoupling Foundation
# 依赖与触发: 上游: 全域 47 业务域服务、GM追缴、网络层 | 下游: EventChannel, EventSubscriberToken
# 配置与信号: 配置 config/infrastructure/event_bus_config.json | 信号: 全域领域事件中心分发
# 职责说明: 事件总线三维空间格网，基于结构化连续数组（SoA）与单元格桶映射为视觉线索空间裁剪提供快速距离测算。
# 退出语义与设计依据: 事件总线空间裁剪解耦规范 / 前后端通信隔离契约
# ==============================================================================

## HeadlessSpatialHashGrid3D：Event Broker / Decoupling Foundation
class_name HeadlessSpatialHashGrid3D
extends RefCounted

const DEFAULT_CELL_SIZE: float = 16.0
const DEFAULT_MAX_DISPATCH_RADIUS: float = 256.0
const MIN_SPATIAL_VALUE: float = 1.0
const MAX_POOLED_CELL_BUCKETS: int = 256
const SMALL_LINEAR_THRESHOLD: int = 64
const HASH_PRIME_X: int = 73856093
const HASH_PRIME_Y: int = 19349663
const HASH_PRIME_Z: int = 83492791

var _cell_size: float = DEFAULT_CELL_SIZE
var _max_dispatch_radius: float = DEFAULT_MAX_DISPATCH_RADIUS # 派发半径钳制上限（防超大半径立方遍历冻结总线）
var _grid: Dictionary = {} # cell_key(int) -> Array[int]（存储 token_id，零嵌套字典包装）
var _token_to_dense: Dictionary = {} # token_id(int) -> dense_index(int)
var _dense_tokens: PackedInt32Array = PackedInt32Array()
var _dense_positions: PackedVector3Array = PackedVector3Array()
var _dense_radii: PackedFloat32Array = PackedFloat32Array()
var _dense_callbacks: Array[Callable] = []
var _called_scratch: Dictionary = {} # 去重字典复用（非重入路径零堆分配）
var _targets_scratch: Array = [] # 派发目标暂存复用（遍历隔离防跳项，零堆分配）
var _dead_tokens_scratch: Array = [] # 死亡监听器回收暂存复用（零堆分配）
var _free_cell_buckets: Array = [] # 空闲单元格数组池，避免增删监听器触发瞬态堆分配
var _spatial_reentrancy: int = 0 # 空间派发重入计数（回调内再派发时回退局部容器保正确性）

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

func _acquire_cell_bucket() -> Array[int]:
	if _free_cell_buckets.is_empty():
		var created: Array[int] = []
		return created
	var bucket: Array[int] = _free_cell_buckets.pop_back()
	bucket.clear()
	return bucket

func _insert_token_z_column(cell_x: int, cell_y: int, z_bounds: Vector2i, token_id: int) -> void:
	for cell_z in range(z_bounds.x, z_bounds.y + 1):
		var cell_hash: int = _hash_cell_indices(cell_x, cell_y, cell_z)
		if not _grid.has(cell_hash):
			_grid[cell_hash] = _acquire_cell_bucket()
		(_grid[cell_hash] as Array[int]).append(token_id)

func _insert_token_y_column(cell_x: int, min_cell: Vector3i, max_cell: Vector3i, token_id: int) -> void:
	var z_bounds := Vector2i(min_cell.z, max_cell.z)
	for cell_y in range(min_cell.y, max_cell.y + 1):
		_insert_token_z_column(cell_x, cell_y, z_bounds, token_id)

## 在空间哈希网格中注册三维局部侦听器
func register_listener(token_id: int, center: Vector3, radius: float, callback: Callable) -> void:
	if _token_to_dense.has(token_id):
		unregister_listener(token_id)
	var clamped_radius: float = maxf(0.0, radius)
	var dense_index: int = _dense_tokens.size()
	_token_to_dense[token_id] = dense_index
	_dense_tokens.append(token_id)
	_dense_positions.append(center)
	_dense_radii.append(clamped_radius)
	_dense_callbacks.append(callback)

	var min_cell: Vector3i = _compute_cell_bound(center, -clamped_radius)
	var max_cell: Vector3i = _compute_cell_bound(center, clamped_radius)
	for cell_x in range(min_cell.x, max_cell.x + 1):
		_insert_token_y_column(cell_x, min_cell, max_cell, token_id)

## 在空间哈希网格中注册二维局部侦听器
func register_listener_2d(token_id: int, center_2d: Vector2, radius: float, callback: Callable, is_isometric_xz: bool = false) -> void:
	var position_3d: Vector3 = Vector3(center_2d.x, 0.0, center_2d.y) if is_isometric_xz else Vector3(center_2d.x, center_2d.y, 0.0)
	register_listener(token_id, position_3d, radius, callback)

## 更新侦听器在空间网格中的空间坐标位置
func update_listener_position(token_id: int, new_center: Vector3, radius: float, callback: Callable) -> void:
	unregister_listener(token_id)
	register_listener(token_id, new_center, radius, callback)

func _remove_token_from_cell(cell_hash: int, token_id: int) -> void:
	if not _grid.has(cell_hash):
		return
	var cell_tokens: Array[int] = _grid[cell_hash]
	for entry_index in range(cell_tokens.size() - 1, -1, -1):
		if cell_tokens[entry_index] == token_id:
			cell_tokens.remove_at(entry_index)
	if cell_tokens.is_empty():
		_grid.erase(cell_hash)
		if _free_cell_buckets.size() < MAX_POOLED_CELL_BUCKETS:
			_free_cell_buckets.append(cell_tokens)

func _remove_token_z_column(cell_x: int, cell_y: int, z_bounds: Vector2i, token_id: int) -> void:
	for cell_z in range(z_bounds.x, z_bounds.y + 1):
		_remove_token_from_cell(_hash_cell_indices(cell_x, cell_y, cell_z), token_id)

func _remove_token_y_column(cell_x: int, min_cell: Vector3i, max_cell: Vector3i, token_id: int) -> void:
	var z_bounds := Vector2i(min_cell.z, max_cell.z)
	for cell_y in range(min_cell.y, max_cell.y + 1):
		_remove_token_z_column(cell_x, cell_y, z_bounds, token_id)

func _swap_remove_dense_slot(dense_index: int, token_id: int) -> void:
	var last_index: int = _dense_tokens.size() - 1
	if dense_index != last_index:
		var swapped_token: int = _dense_tokens[last_index]
		_dense_tokens[dense_index] = swapped_token
		_dense_positions[dense_index] = _dense_positions[last_index]
		_dense_radii[dense_index] = _dense_radii[last_index]
		_dense_callbacks[dense_index] = _dense_callbacks[last_index]
		_token_to_dense[swapped_token] = dense_index
	_dense_tokens.remove_at(last_index)
	_dense_positions.remove_at(last_index)
	_dense_radii.remove_at(last_index)
	_dense_callbacks.remove_at(last_index)
	_token_to_dense.erase(token_id)

## 从空间网格中注销指定令牌的侦听器
func unregister_listener(token_id: int) -> void:
	if not _token_to_dense.has(token_id):
		return
	var dense_index: int = int(_token_to_dense[token_id])
	var center: Vector3 = _dense_positions[dense_index]
	var clamped_radius: float = _dense_radii[dense_index]
	_swap_remove_dense_slot(dense_index, token_id)
	var min_cell: Vector3i = _compute_cell_bound(center, -clamped_radius)
	var max_cell: Vector3i = _compute_cell_bound(center, clamped_radius)
	for cell_x in range(min_cell.x, max_cell.x + 1):
		_remove_token_y_column(cell_x, min_cell, max_cell, token_id)

func _collect_linear_targets(
	origin: Vector3,
	query_radius: float,
	targets: Array,
	dead_tokens: Array
) -> void:
	var count: int = _dense_tokens.size()
	for dense_index in range(count):
		var combined_radius: float = query_radius + _dense_radii[dense_index]
		if origin.distance_squared_to(_dense_positions[dense_index]) <= combined_radius * combined_radius:
			var callback: Callable = _dense_callbacks[dense_index]
			if callback.is_valid():
				targets.append(callback)
			else:
				dead_tokens.append(_dense_tokens[dense_index])

func _collect_cell_targets(
	cell_hash: int,
	origin: Vector3,
	query_radius: float,
	called_tokens: Dictionary,
	targets: Array,
	dead_tokens: Array
) -> void:
	var cell_tokens_variant: Variant = _grid.get(cell_hash, null)
	if cell_tokens_variant == null:
		return
	var cell_tokens: Array[int] = cell_tokens_variant
	for token_id in cell_tokens:
		if called_tokens.has(token_id):
			continue
		var dense_variant: Variant = _token_to_dense.get(token_id, null)
		if dense_variant == null:
			continue
		called_tokens[token_id] = true
		var dense_index: int = int(dense_variant)
		var callback: Callable = _dense_callbacks[dense_index]
		if not callback.is_valid():
			dead_tokens.append(token_id)
			continue
		var combined_radius: float = query_radius + _dense_radii[dense_index]
		if origin.distance_squared_to(_dense_positions[dense_index]) <= combined_radius * combined_radius:
			targets.append(callback)

func _collect_grid_box_targets(
	origin: Vector3,
	query_radius: float,
	called_tokens: Dictionary,
	targets: Array,
	dead_tokens: Array
) -> void:
	var min_cell: Vector3i = _compute_cell_bound(origin, -query_radius)
	var max_cell: Vector3i = _compute_cell_bound(origin, query_radius)
	for cell_x in range(min_cell.x, max_cell.x + 1):
		for cell_y in range(min_cell.y, max_cell.y + 1):
			for cell_z in range(min_cell.z, max_cell.z + 1):
				_collect_cell_targets(
					_hash_cell_indices(cell_x, cell_y, cell_z),
					origin,
					query_radius,
					called_tokens,
					targets,
					dead_tokens
				)

func _invoke_spatial_targets(targets: Array, packet: EventPacket) -> int:
	var dispatched: int = 0
	for raw_callback in targets:
		var callback: Callable = raw_callback as Callable
		if callback.is_valid():
			callback.call(packet)
			dispatched += 1
	return dispatched

## 空间事件派发：小基数连续数组直扫 / 大基数单元格粗裁剪 → 欧氏距离平方精确过滤（Inv-EB2-2）→ token_id 去重与死亡自愈
func dispatch_spatial(spatial_position: Vector3, radius: float, packet: EventPacket) -> int:
	if _dense_tokens.is_empty():
		return 0
	# 半径钳制：防御性上限，防止异常半径触发超大范围立方遍历冻结总线
	var clamped_radius: float = minf(maxf(0.0, radius), _max_dispatch_radius)

	var previous_reentrancy: int = _spatial_reentrancy
	_spatial_reentrancy += 1
	var should_use_scratch: bool = (_spatial_reentrancy == 1)
	var targets: Array = _targets_scratch if should_use_scratch else []
	var dead_tokens: Array = _dead_tokens_scratch if should_use_scratch else []
	targets.clear()
	dead_tokens.clear()

	if _dense_tokens.size() <= SMALL_LINEAR_THRESHOLD:
		_collect_linear_targets(spatial_position, clamped_radius, targets, dead_tokens)
	else:
		var called_tokens: Dictionary = _called_scratch if should_use_scratch else {}
		called_tokens.clear()
		_collect_grid_box_targets(spatial_position, clamped_radius, called_tokens, targets, dead_tokens)
		if should_use_scratch:
			called_tokens.clear()

	# 派发快照已在独立 targets 中，回调内增删订阅不影响本轮遍历（Inv-EB2-7 契约对齐）
	var dispatched: int = _invoke_spatial_targets(targets, packet)

	# 死亡监听器惰性自愈剔除（防幽灵残留与内存泄漏）
	if not dead_tokens.is_empty():
		for dead_id in dead_tokens:
			unregister_listener(dead_id)

	if should_use_scratch:
		targets.clear()
		dead_tokens.clear()
	_spatial_reentrancy = previous_reentrancy
	return dispatched

## 便捷入口：按事件包自身空间头派发
func dispatch_packet(packet: EventPacket) -> int:
	if packet == null or not packet.is_spatial:
		return 0
	return dispatch_spatial(packet.world_position, packet.effect_radius, packet)

## 单元格尺寸只读访问器（供核心/遥测读取，避免跨类访问私有字段）
func get_cell_size() -> float:
	return _cell_size

## 获取当前注册的空间监听器总数（供遥测与测试断言）
func get_listener_count() -> int:
	return _dense_tokens.size()

## 清空空间哈希网格与所有临时池（供测试隔离与实例复位）
func clear() -> void:
	_grid.clear()
	_token_to_dense.clear()
	_dense_tokens.clear()
	_dense_positions.clear()
	_dense_radii.clear()
	_dense_callbacks.clear()
	_called_scratch.clear()
	_targets_scratch.clear()
	_dead_tokens_scratch.clear()
	_free_cell_buckets.clear()
	_spatial_reentrancy = 0
