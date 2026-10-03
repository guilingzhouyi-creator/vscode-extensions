# ==============================================================================
# 模块归属: 业务领域层 (Domains · 治理、权限与持久化集群 (Governance & Persistence))
# 文件路径: res://backend/domains/persistence_protocol/preload_window_governor.gd
# 架构定位: Spatial & Scene Preload Window Governor
# 跨域依赖: 上游: SpatialMovement, ViewRouter | 下游: GameConfig, BoundedResourceCache
# 职责说明: 动态预加载滑动窗口管理器：基于玩家所在场景与空间坐标计算有限预加载范围，
#           禁止一次性无界全量读取整个世界，配合 BoundedResourceCache 实现内存与 IO
#           有界控制。
# 设计依据: 双域储存架构有限预加载窗口与流式拉取规范
# ==============================================================================

class_name PreloadWindowGovernor extends RefCounted

const DEFAULT_WINDOW_RADIUS: float = 100.0

static var _instance = null

var _current_position: Vector2 = Vector2.ZERO
var _current_scene_id: String = ""
var _window_radius: float = DEFAULT_WINDOW_RADIUS

static func get_instance() -> RefCounted:
	if _instance == null:
		_instance = new()
	return _instance

func _init() -> void:
	_current_position = Vector2.ZERO
	_current_scene_id = ""
	_window_radius = GameConfig.get_float("infrastructure.storage", "auxiliary/preload_window/radius_meters", DEFAULT_WINDOW_RADIUS)

## 更新当前焦点位置与场景
func update_focus(position: Vector2, scene_id: String) -> void:
	_current_position = position
	_current_scene_id = scene_id
	_window_radius = GameConfig.get_float("infrastructure.storage", "auxiliary/preload_window/radius_meters", DEFAULT_WINDOW_RADIUS)

## 获取当前滑动窗口半径
func get_window_radius() -> float:
	return _window_radius

## 判定目标资源是否落在当前预加载窗口内
func is_within_window(target_pos: Vector2, target_scene_id: String) -> bool:
	if not _current_scene_id.is_empty() and not target_scene_id.is_empty():
		if _current_scene_id != target_scene_id:
			return false
	var dist := _current_position.distance_to(target_pos)
	return dist <= _window_radius

## 批量过滤出落在窗口内部的候选资源列表
func filter_candidates(candidates: Array) -> Array:
	var filtered := []
	for item in candidates:
		if not item is Dictionary:
			continue
		var d: Dictionary = item
		var pos: Vector2 = d.get("position", _current_position)
		var s_id: String = String(d.get("scene_id", _current_scene_id))
		if is_within_window(pos, s_id):
			filtered.append(d)
	return filtered

## 获取当前窗口运行摘要
func get_summary() -> Dictionary:
	return {
		"position": _current_position,
		"scene_id": _current_scene_id,
		"radius": _window_radius
	}

## 测试重置
static func reset_for_tests() -> void:
	_instance = null
