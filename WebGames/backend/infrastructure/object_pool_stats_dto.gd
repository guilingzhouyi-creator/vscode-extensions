# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · High Pressure Pooling)
# 文件路径: res://backend/infrastructure/object_pool_stats_dto.gd
# 架构定位: Object Pool Telemetry Snapshot Data Transfer Object
# 跨域依赖: 上游: ObjectPool, ObjectPoolManager | 下游: EventBusCore | 配置: config/infrastructure/object_pool.json | 信号: 无
# 职责说明: 对象池运行指标快照模型：记录累计分配数、活跃在用数、池内空闲数、峰值占用与溢出计数。
# 设计依据: 演进 03 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

class_name ObjectPoolStatsDTO extends RefCounted

var pool_name: String = ""
var total_allocated: int = 0
var active_in_use: int = 0
var idle_in_pool: int = 0
var peak_active: int = 0
var total_acquires: int = 0
var total_releases: int = 0
var total_overflows: int = 0

func to_dto() -> Dictionary:
	return {
		"pool_name": pool_name,
		"total_allocated": total_allocated,
		"active_in_use": active_in_use,
		"idle_in_pool": idle_in_pool,
		"peak_active": peak_active,
		"total_acquires": total_acquires,
		"total_releases": total_releases,
		"total_overflows": total_overflows
	}

static func from_dto(data: Dictionary) -> RefCounted:
	var dto: RefCounted = new()
	dto.pool_name = str(data.get("pool_name", ""))
	dto.total_allocated = int(data.get("total_allocated", 0))
	dto.active_in_use = int(data.get("active_in_use", 0))
	dto.idle_in_pool = int(data.get("idle_in_pool", 0))
	dto.peak_active = int(data.get("peak_active", 0))
	dto.total_acquires = int(data.get("total_acquires", 0))
	dto.total_releases = int(data.get("total_releases", 0))
	dto.total_overflows = int(data.get("total_overflows", 0))
	return dto
