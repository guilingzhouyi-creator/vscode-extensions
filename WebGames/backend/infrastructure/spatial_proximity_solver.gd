# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 空间与几何计算基底)
# 文件路径: res://backend/infrastructure/spatial_proximity_solver.gd
# 架构定位: Headless Numerical Solver / Spatial Math Utility
# 职责说明: 提供高性能空间邻近检定算子，采用平方距离避免开方开销
# ==============================================================================
class_name SpatialProximitySolver
extends RefCounted

## 2D 圆形空间邻近判定（采用 distance_squared_to 避免开方开销）
static func is_within_radius_2d(a: Vector2, b: Vector2, radius: float) -> bool:
	if radius <= 0.0:
		return a == b
	return a.distance_squared_to(b) <= radius * radius

## 3D 球形空间邻近判定（采用 distance_squared_to 避免开方开销）
static func is_within_radius_3d(a: Vector3, b: Vector3, radius: float) -> bool:
	if radius <= 0.0:
		return a == b
	return a.distance_squared_to(b) <= radius * radius
