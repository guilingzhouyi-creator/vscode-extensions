# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · High Pressure Pooling)
# 文件路径: res://backend/infrastructure/object_pool_config_dto.gd
# 架构定位: Object Pool Configuration Data Transfer Object
# 依赖与触发: 上游: ObjectPoolManager, ObjectPool | 下游: GameConfig | 配置: config/infrastructure/object_pool.json | 信号: 无
# 职责说明: 对象池配置传输模型：封装单池预分配容量、上限水位、溢出策略与告警阈值参数。
# 退出语义与设计依据: 高承压对象池与数据导向无头处理器架构规范
# ==============================================================================

## ObjectPoolConfigDTO：Object Pool Configuration Data Transfer Object
class_name ObjectPoolConfigDTO extends RefCounted

var pool_name: String = "generic_pool"
var preallocate_size: int = 32
var max_capacity: int = 512
var allow_overflow_alloc: bool = true
var overflow_warning_threshold: int = 256

## 序列化当前对象为通用字典传输结构
func to_dto() -> Dictionary:
	return {
		"pool_name": pool_name,
		"preallocate_size": preallocate_size,
		"max_capacity": max_capacity,
		"allow_overflow_alloc": allow_overflow_alloc,
		"overflow_warning_threshold": overflow_warning_threshold
	}

## 从输入字典反序列化还原传输对象
static func from_dto(config_payload: Dictionary) -> RefCounted:
	var config_dto: RefCounted = new()
	config_dto.pool_name = str(config_payload.get("pool_name", "generic_pool"))
	config_dto.preallocate_size = maxi(0, int(config_payload.get("preallocate_size", 32)))
	config_dto.max_capacity = maxi(config_dto.preallocate_size, int(config_payload.get("max_capacity", 512)))
	config_dto.allow_overflow_alloc = bool(config_payload.get("allow_overflow_alloc", true))
	config_dto.overflow_warning_threshold = maxi(1, int(config_payload.get("overflow_warning_threshold", 256)))
	return config_dto
