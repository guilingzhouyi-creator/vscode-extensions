# ==============================================================================
# 模块归属: 业务领域层 (Domains · 实体、物品与世界状态集群 (Entity & World State))
# 文件路径: res://backend/domains/world_gateway/dto/mode_readiness_report_dto.gd
# 架构定位: Value Object DTO / Data Transport Model
# 依赖与触发: 上游: ModeReadinessProbe, WorldGatewayFSM | 下游: 无 | 配置: config/domains/world_gateway/core.json | 信号: 无
# 职责说明: 承载单机与联机运行模式环境探针的探测报告与网络/存储能力诊断结果。
# 退出语义与设计依据: 业务域第一性原理 / 模式就绪探测与防越权隔离拓扑规范
# ==============================================================================

## ModeReadinessReportDTO：Value Object DTO / Data Transport Model
class_name ModeReadinessReportDTO
extends PoolableDtoBase

const PoolableDtoBase = preload("res://backend/domains/persistence_protocol/poolable_dto_base.gd")

var mode: int = 0
var is_ready: bool = false
var status_code: String = ""
var message: String = ""
var latency_ms: int = 0
var capabilities: Array = []

## 构造模式就绪探测报告 DTO
func _init(
	initial_mode: int = 0,
	initial_is_ready: bool = false,
	initial_status_code: String = "",
	initial_message: String = "",
	initial_latency_ms: int = 0,
	initial_capabilities: Array = []
) -> void:
	mode = initial_mode
	is_ready = initial_is_ready
	status_code = initial_status_code
	message = initial_message
	latency_ms = initial_latency_ms
	capabilities = initial_capabilities.duplicate()

## 对象状态复位（支持对象池复用，ADV-PRF-002）
func reset_state() -> void:
	super.reset_state()
	mode = 0
	is_ready = false
	status_code = ""
	message = ""
	latency_ms = 0
	capabilities.clear()

## 序列化为字典传输对象
func to_dto() -> Dictionary:
	return {
		"mode": mode,
		"is_ready": is_ready,
		"status_code": status_code,
		"message": message,
		"latency_ms": latency_ms,
		"capabilities": capabilities.duplicate()
	}

## 从字典还原构建 DTO 实例
static func from_dto(data: Dictionary) -> ModeReadinessReportDTO:
	if data.is_empty():
		return ModeReadinessReportDTO.new()
	var report := ModeReadinessReportDTO.new()
	report.mode = int(data.get("mode", 0))
	report.is_ready = bool(data.get("is_ready", false))
	report.status_code = String(data.get("status_code", ""))
	report.message = String(data.get("message", ""))
	report.latency_ms = int(data.get("latency_ms", 0))
	var raw_capabilities: Variant = data.get("capabilities", [])
	if raw_capabilities is Array:
		report.capabilities = (raw_capabilities as Array).duplicate()
	else:
		report.capabilities = []
	return report
