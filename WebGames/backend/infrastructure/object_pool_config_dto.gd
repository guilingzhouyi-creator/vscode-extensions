# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · High Pressure Pooling)
# 文件路径: res://backend/infrastructure/object_pool_config_dto.gd
# 架构定位: Object Pool Configuration Data Transfer Object
# 跨域依赖: 上游: ObjectPoolManager, ObjectPool | 下游: GameConfig | 配置: config/infrastructure/object_pool.json | 信号: 无
# 职责说明: 对象池配置传输模型：封装单池预分配容量、上限水位、溢出策略与告警阈值参数。
# 设计依据: 演进 03 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

class_name ObjectPoolConfigDTO extends RefCounted

var pool_name: String = "generic_pool"
var preallocate_size: int = 32
var max_capacity: int = 512
var allow_overflow_alloc: bool = true
var overflow_warning_threshold: int = 256

func to_dto() -> Dictionary:
	return {
		"pool_name": pool_name,
		"preallocate_size": preallocate_size,
		"max_capacity": max_capacity,
		"allow_overflow_alloc": allow_overflow_alloc,
		"overflow_warning_threshold": overflow_warning_threshold
	}

static func from_dto(data: Dictionary) -> RefCounted:
	var dto: RefCounted = new()
	dto.pool_name = str(data.get("pool_name", "generic_pool"))
	dto.preallocate_size = maxi(0, int(data.get("preallocate_size", 32)))
	dto.max_capacity = maxi(dto.preallocate_size, int(data.get("max_capacity", 512)))
	dto.allow_overflow_alloc = bool(data.get("allow_overflow_alloc", true))
	dto.overflow_warning_threshold = maxi(1, int(data.get("overflow_warning_threshold", 256)))
	return dto
