# ==============================================================================
# 模块归属: 基础设施层 (Infrastructure · Logging & Telemetry)
# 文件路径: res://backend/infrastructure/log_query_dto.gd
# 架构定位: Log Collector & Stream Processor
# 跨域依赖: 上游: 全域业务模块与异常拦截器 | 下游: RingBuffer, FileAccess | 配置: config/infrastructure/logging.json | 信号: FATAL/ERROR 级别告警信号
# 职责说明: 承载结构化日志多维检索入参与分页查询结果 DTO（Inv-LS-5 检索只读不变量）。
# 设计依据: Phase 52 统一结构化日志规范 / Phase 60 性能基准审计
# ==============================================================================

class_name LogQueryDTO extends RefCounted

# ==============================================================================
# 一、检索条件（Criteria）
# ==============================================================================

class Criteria extends RefCounted:
	## 起始时刻（秒，含；0 表示不限）
	var from_utc: int = 0
	
	## 结束时刻（秒，含；0 表示至今）
	var to_utc: int = 0
	
	## 日志级别过滤集合（如 ["warn", "error"]；空表示不过滤）
	var levels: Array[String] = []
	
	## 来源通道/领域过滤集合（空表示不过滤）
	var channels: Array[String] = []
	
	## 链路追踪 ID 精确匹配（空表示不过滤）
	var trace_id: String = ""
	
	## 错误码精确匹配（空表示不过滤）
	var error_code: String = ""
	
	## 消息内容关键字模糊匹配（空表示不过滤）
	var keyword: String = ""
	
	## 页码（从 1 起始）
	var page: int = 1:
		set(val):
			page = maxi(1, val)
			
	## 每页大小（钳制在 [1, 500] 区间）
	var page_size: int = 100:
		set(val):
			page_size = clampi(val, 1, 500)

# ==============================================================================
# 二、查询结果（Result）
# ==============================================================================

class Result extends RefCounted:
	## 命中记录总条数
	var total: int = 0
	
	## 当前所在页码
	var page: int = 1
	
	## 命中日志记录列表（Dictionary 序列化形态）
	var records: Array[Dictionary] = []
	
	## 是否因超过检索上限截断
	var truncated: bool = false

	func to_dto() -> Dictionary:
		return {
			"total": total,
			"page": page,
			"records": records.duplicate(true),
			"truncated": truncated,
		}
