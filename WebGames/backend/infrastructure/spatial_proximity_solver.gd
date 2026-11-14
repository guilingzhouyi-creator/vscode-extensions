# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · 空间与几何计算基底)
# 文件路径: res://backend/infrastructure/spatial_proximity_solver.gd
# 架构定位: Headless Numerical Solver / Spatial Math Utility
# 依赖与触发: 无状态纯静态数学算子；由无头空间查询、AI 感知与战斗触发管线按需调用
# 职责说明: 提供高性能空间邻近检定算子，采用平方距离避免开方开销
# 退出语义与设计依据: 无状态瞬态工具类，零资源持有与退出清理负担；非正半径退化为精确重合判定以防浮点误差吞没边界
# ==============================================================================
## SpatialProximitySolver：提供 2D 与 3D 空间无开方平方距离邻近判定算子
class_name SpatialProximitySolver
extends RefCounted

## 2D 圆形空间邻近判定（采用 distance_squared_to 避免开方开销）
static func is_within_radius_2d(origin: Vector2, target: Vector2, radius: float) -> bool:
	# 非正半径不存在合法邻近区间，直接退化为坐标点重合判定以规避负半径平方失真
	if radius <= 0.0:
		return origin == target
	return origin.distance_squared_to(target) <= radius * radius

## 3D 球形空间邻近判定（采用 distance_squared_to 避免开方开销）
static func is_within_radius_3d(origin: Vector3, target: Vector3, radius: float) -> bool:
	# 非正半径不存在合法邻近区间，直接退化为坐标点重合判定以规避负半径平方失真
	if radius <= 0.0:
		return origin == target
	return origin.distance_squared_to(target) <= radius * radius
